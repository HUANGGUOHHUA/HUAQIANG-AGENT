using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("华强以太")]
[assembly: AssemblyDescription("本地 AI 编程与系统助手")]
[assembly: AssemblyProduct("华强以太")]
[assembly: AssemblyCompany("华强以太")]
[assembly: AssemblyCopyright("华强以太")]
[assembly: AssemblyVersion("1.0.1.0")]
[assembly: AssemblyFileVersion("1.0.1.0")]
[assembly: AssemblyInformationalVersion("1.0.1")]

namespace HuaqiangAgentLauncher
{
    internal static class Program
    {
        private const string AppVersion = "1.0.1";
        private const string PayloadName = "HuaqiangAgent.App.zip";
        private const string AppExeName = "HuaqiangAgent.exe";

        [STAThread]
        private static int Main(string[] args)
        {
            var extractOnly = Array.IndexOf(args, "--extract-only") >= 0;
            Probe("main extractOnly=" + extractOnly + " args=" + string.Join("|", args));
            try
            {
                if (!extractOnly)
                {
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                }
                Probe("gui-init-done");

                var root = ResolveRuntimeRoot();
                var marker = Path.Combine(root, ".ready");
                var exePath = Path.Combine(root, AppExeName);
                Probe("root=" + root);

                if (!File.Exists(marker) || !File.Exists(exePath))
                {
                    PrepareRuntime(root, !extractOnly);
                }
                Probe("prepare-done");
                if (extractOnly)
                {
                    Console.WriteLine("runtime ready: " + root);
                    return 0;
                }

                if (!File.Exists(exePath))
                {
                    throw new FileNotFoundException("运行时文件不完整，请重新下载华强以太。", exePath);
                }

                var startInfo = new ProcessStartInfo(exePath)
                {
                    WorkingDirectory = root,
                    UseShellExecute = false,
                    Arguments = QuoteArguments(BuildLaunchArguments(args, root))
                };
                using (var process = Process.Start(startInfo))
                {
                    if (process == null)
                    {
                        throw new InvalidOperationException("无法启动华强以太主程序。");
                    }
                    process.WaitForExit();
                    return process.ExitCode;
                }
            }
            catch (Exception error)
            {
                Probe("error: " + error);
                Log(error);
                if (!extractOnly)
                {
                    MessageBox.Show(
                        "华强以太启动失败：\n\n" + error.Message +
                        "\n\n如问题持续，可删除目录后重试：\n" + ResolveRuntimeRoot(),
                        "华强以太",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                }
                return 1;
            }
        }

        private static string ResolveRuntimeRoot()
        {
            var portable = Path.Combine(
                AppDomain.CurrentDomain.BaseDirectory,
                "HuaqiangAgent-runtime-" + AppVersion);
            try
            {
                Directory.CreateDirectory(portable);
                var probe = Path.Combine(portable, ".write-probe");
                File.WriteAllText(probe, "ok", new UTF8Encoding(false));
                File.Delete(probe);
                return portable;
            }
            catch
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "HuaqiangAgent",
                    "runtime-" + AppVersion);
            }
        }

        private static void PrepareRuntime(string root, bool showSplash)
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, true);
            }
            Directory.CreateDirectory(root);

            SplashForm splash = null;
            if (showSplash)
            {
                splash = new SplashForm();
                splash.Show();
                splash.Refresh();
                Application.DoEvents();
            }

            try
            {
                using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadName))
                {
                    if (stream == null)
                    {
                        throw new InvalidOperationException("安装包中缺少应用资源。");
                    }
                    using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
                    {
                        var total = Math.Max(1, archive.Entries.Count);
                        var index = 0;
                        foreach (var entry in archive.Entries)
                        {
                            index++;
                            var destination = Path.GetFullPath(Path.Combine(root, entry.FullName));
                            var rootFull = Path.GetFullPath(root) + Path.DirectorySeparatorChar;
                            if (!destination.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase))
                            {
                                throw new IOException("安装包包含非法路径：" + entry.FullName);
                            }

                            if (string.IsNullOrEmpty(entry.Name))
                            {
                                Directory.CreateDirectory(destination);
                            }
                            else
                            {
                                var parent = Path.GetDirectoryName(destination);
                                if (!string.IsNullOrEmpty(parent))
                                {
                                    Directory.CreateDirectory(parent);
                                }
                                entry.ExtractToFile(destination, true);
                            }

                            if (splash != null && (index % 4 == 0 || index == total))
                            {
                                splash.SetProgress(index, total, entry.FullName);
                            }
                        }
                    }
                }

                File.WriteAllText(
                    Path.Combine(root, ".ready"),
                    DateTime.UtcNow.ToString("o"),
                    new UTF8Encoding(false));
            }
            finally
            {
                if (splash != null) splash.Close();
            }
        }

        private static string QuoteArguments(string[] args)
        {
            if (args == null || args.Length == 0) return string.Empty;
            var builder = new StringBuilder();
            foreach (var argument in args)
            {
                if (builder.Length > 0) builder.Append(' ');
                if (argument.Length > 0 && argument.IndexOfAny(new[] { ' ', '\t', '"' }) < 0)
                {
                    builder.Append(argument);
                }
                else
                {
                    builder.Append('"');
                    var backslashes = 0;
                    foreach (var character in argument)
                    {
                        if (character == '\\')
                        {
                            backslashes++;
                        }
                        else if (character == '"')
                        {
                            builder.Append('\\', backslashes * 2 + 1);
                            builder.Append('"');
                            backslashes = 0;
                        }
                        else
                        {
                            builder.Append('\\', backslashes);
                            backslashes = 0;
                            builder.Append(character);
                        }
                    }
                    builder.Append('\\', backslashes * 2);
                    builder.Append('"');
                }
            }
            return builder.ToString();
        }

        private static string[] BuildLaunchArguments(string[] args, string root)
        {
            var result = new System.Collections.Generic.List<string>(args)
            {
                "--no-sandbox",
                "--disable-gpu",
                "--user-data-dir=" + ResolveSafeProfile(root)
            };
            return result.ToArray();
        }

        private static string ResolveSafeProfile(string root)
        {
            var local = Path.Combine(root, "profile");
            try
            {
                Directory.CreateDirectory(local);
                var probe = Path.Combine(local, ".write-probe");
                File.WriteAllText(probe, "ok", new UTF8Encoding(false));
                File.Delete(probe);
                return local;
            }
            catch
            {
                var fallback = Path.Combine(Path.GetTempPath(), "HuaqiangAgent", "data");
                Directory.CreateDirectory(fallback);
                return fallback;
            }
        }

        private static void Log(Exception error)
        {
            try
            {
                var dir = AppDomain.CurrentDomain.BaseDirectory;
                File.AppendAllText(
                    Path.Combine(dir, "HuaqiangAgent-launcher.log"),
                    DateTime.Now.ToString("s") + " " + error + Environment.NewLine,
                    new UTF8Encoding(false));
            }
            catch
            {
                // Logging must never mask the original error.
            }
        }

        private static void Probe(string message)
        {
            if (Environment.GetEnvironmentVariable("HQ_LAUNCHER_DEBUG") != "1") return;
            try
            {
                var dir = AppDomain.CurrentDomain.BaseDirectory;
                File.AppendAllText(
                    Path.Combine(dir, "HuaqiangAgent-launcher-debug.log"),
                    DateTime.Now.ToString("s") + " " + message + Environment.NewLine,
                    new UTF8Encoding(false));
            }
            catch
            {
                // Debug output only.
            }
        }
    }

    internal sealed class SplashForm : Form
    {
        private readonly Label statusLabel;
        private readonly ProgressBar progressBar;

        public SplashForm()
        {
            Text = "华强以太";
            ClientSize = new Size(480, 214);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(8, 36, 81);
            ForeColor = Color.FromArgb(246, 240, 225);
            ShowInTaskbar = true;
            try
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch
            {
                // Default icon is fine.
            }

            var title = new Label
            {
                Text = "华强以太",
                Font = new Font("Microsoft YaHei UI", 21F, FontStyle.Bold),
                ForeColor = Color.FromArgb(251, 246, 233),
                AutoSize = false,
                Bounds = new Rectangle(0, 38, 480, 42),
                TextAlign = ContentAlignment.MiddleCenter
            };
            var subtitle = new Label
            {
                Text = "HUAQIANG AGENT · 正在准备本地工作台",
                Font = new Font("Microsoft YaHei UI", 8.5F, FontStyle.Regular),
                ForeColor = Color.FromArgb(197, 161, 94),
                AutoSize = false,
                Bounds = new Rectangle(0, 80, 480, 22),
                TextAlign = ContentAlignment.MiddleCenter
            };
            var motto = new Label
            {
                Text = "华而实 · 善则强",
                Font = new Font("KaiTi", 12F, FontStyle.Regular),
                ForeColor = Color.FromArgb(230, 210, 168),
                AutoSize = false,
                Bounds = new Rectangle(0, 112, 480, 26),
                TextAlign = ContentAlignment.MiddleCenter
            };
            statusLabel = new Label
            {
                Text = "首次启动，正在解压运行文件…",
                Font = new Font("Microsoft YaHei UI", 8F),
                ForeColor = Color.FromArgb(180, 190, 205),
                AutoSize = false,
                Bounds = new Rectangle(48, 146, 384, 18),
                TextAlign = ContentAlignment.MiddleLeft
            };
            progressBar = new ProgressBar
            {
                Bounds = new Rectangle(48, 168, 384, 10),
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 28
            };
            Controls.Add(title);
            Controls.Add(subtitle);
            Controls.Add(motto);
            Controls.Add(statusLabel);
            Controls.Add(progressBar);
        }

        public void SetProgress(int value, int maximum, string name)
        {
            if (progressBar.Style != ProgressBarStyle.Continuous)
            {
                progressBar.Style = ProgressBarStyle.Continuous;
                progressBar.Maximum = Math.Max(1, maximum);
                progressBar.Value = Math.Min(value, progressBar.Maximum);
            }
            progressBar.Value = Math.Min(value, progressBar.Maximum);
            statusLabel.Text = "正在准备 · " + name;
            Refresh();
            Application.DoEvents();
        }
    }
}
