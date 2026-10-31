using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("华强以太 安装程序")]
[assembly: AssemblyDescription("华强以太本地 AI 编程助手安装程序")]
[assembly: AssemblyProduct("华强以太")]
[assembly: AssemblyCompany("华强以太")]
[assembly: AssemblyCopyright("华强以太")]
[assembly: AssemblyVersion("1.0.1.0")]
[assembly: AssemblyFileVersion("1.0.1.0")]
[assembly: AssemblyInformationalVersion("1.0.1")]

namespace HuaqiangAgentSetup
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            var silent = args.Any(a => a.Equals("/SILENT", StringComparison.OrdinalIgnoreCase) ||
                                       a.Equals("/S", StringComparison.OrdinalIgnoreCase));
            var target = ReadArgument(args, "/DIR=") ?? InstallEngine.DefaultInstallDir;
            var noDesktop = args.Any(a => a.Equals("/NODESKTOP", StringComparison.OrdinalIgnoreCase));

            if (silent)
            {
                try
                {
                    InstallEngine.Install(new InstallOptions
                    {
                        TargetDir = target,
                        CreateDesktopShortcut = !noDesktop
                    }, null);
                    InstallEngine.WriteLog("Silent install completed: " + target);
                    return 0;
                }
                catch (Exception error)
                {
                    InstallEngine.WriteLog("Silent install failed: " + error);
                    return 1;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm(target));
            return 0;
        }

        private static string ReadArgument(string[] args, string prefix)
        {
            foreach (var arg in args)
            {
                if (arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    return arg.Substring(prefix.Length).Trim('"');
                }
            }
            return null;
        }
    }

    internal sealed class InstallOptions
    {
        public string TargetDir;
        public bool CreateDesktopShortcut;
    }

    internal static class InstallEngine
    {
        public static string LastWarning;
        private const string PayloadResource = "HuaqiangAgent.App.zip";
        private const string UninstallerResource = "HuaqiangAgent.Uninstaller.exe";
        private const string AppVersion = "1.0.1";
        private const string UninstallRegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\HuaqiangAgent";

        public static string DefaultInstallDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "HuaqiangAgent"); }
        }

        public static bool IsAdministrator
        {
            get
            {
                using (var identity = WindowsIdentity.GetCurrent())
                {
                    return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
                }
            }
        }

        public static void Install(InstallOptions options, Action<int, int, string> progress)
        {
            if (options == null) throw new ArgumentNullException("options");
            if (string.IsNullOrWhiteSpace(options.TargetDir)) throw new ArgumentException("安装位置不能为空。");
            var target = Path.GetFullPath(options.TargetDir.Trim());
            ValidateTarget(target);
            Directory.CreateDirectory(target);
            LastWarning = null;
            WriteLog("Install target: " + target + " admin=" + IsAdministrator);

            ExtractPayload(target, progress);
            WriteLog("Payload extracted");
            var exe = Path.Combine(target, "HuaqiangAgent.exe");
            if (!File.Exists(exe)) throw new FileNotFoundException("安装包中缺少 HuaqiangAgent.exe。", exe);

            var profile = Path.Combine(target, "profile");
            Directory.CreateDirectory(profile);
            GrantUsersModify(profile);
            WriteLog("Profile prepared: " + profile);
            DeleteLegacyShortcuts();
            string desktopLink = null;
            string startLink = null;
            if (options.CreateDesktopShortcut)
            {
                try
                {
                    desktopLink = CreateShortcut(
                        Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                        "华强以太", exe, profile, target);
                }
                catch (Exception error)
                {
                    LastWarning = "桌面快捷方式创建失败：" + error.Message;
                    WriteLog("Desktop shortcut failed: " + error);
                }
            }
            try
            {
                startLink = CreateShortcut(
                    Path.Combine(
                        Environment.GetFolderPath(
                            IsAdministrator
                                ? Environment.SpecialFolder.CommonPrograms
                                : Environment.SpecialFolder.Programs),
                        "华强以太"),
                    "华强以太",
                    exe,
                    profile,
                    target);
            }
            catch (Exception error)
            {
                LastWarning = (LastWarning == null ? "" : LastWarning + "\n") +
                              "开始菜单快捷方式创建失败：" + error.Message;
                WriteLog("Start menu shortcut failed: " + error);
            }
            WriteLog("Shortcuts created: " + (desktopLink ?? "(none)") + " | " + (startLink ?? "(none)"));

            ExtractUninstaller(target);
            WriteLog("Uninstaller extracted");
            WriteUninstallInformation(target, profile, desktopLink, startLink);
        }

        private static void ValidateTarget(string target)
        {
            var root = Path.GetPathRoot(target);
            if (string.IsNullOrEmpty(root) || target.TrimEnd('\\').Length <= root.TrimEnd('\\').Length)
            {
                throw new InvalidOperationException("不能直接安装到磁盘根目录，请选择一个子文件夹。");
            }
            var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            if (target.TrimEnd('\\').Equals(windows.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase) ||
                target.StartsWith(windows + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("不能安装到 Windows 系统目录。");
            }
            if (Directory.Exists(target) &&
                Directory.EnumerateFileSystemEntries(target).Any() &&
                !File.Exists(Path.Combine(target, "HuaqiangAgent.exe")))
            {
                throw new InvalidOperationException("目标文件夹不是空目录，请选择其他位置。");
            }
        }

        private static void ExtractPayload(string target, Action<int, int, string> progress)
        {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResource))
            {
                if (stream == null) throw new InvalidOperationException("安装包损坏：找不到应用负载。");
                using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    var total = Math.Max(1, archive.Entries.Count);
                    var root = Path.GetFullPath(target) + Path.DirectorySeparatorChar;
                    var index = 0;
                    foreach (var entry in archive.Entries)
                    {
                        index++;
                        var destination = Path.GetFullPath(Path.Combine(target, entry.FullName));
                        if (!destination.StartsWith(root, StringComparison.OrdinalIgnoreCase))
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
                            if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                            entry.ExtractToFile(destination, true);
                        }
                        if (progress != null && (index % 4 == 0 || index == total))
                        {
                            progress(index, total, entry.FullName);
                        }
                    }
                }
            }
        }

        private static void ExtractUninstaller(string target)
        {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(UninstallerResource))
            {
                if (stream == null) throw new InvalidOperationException("安装包损坏：找不到卸载程序。");
                using (var file = File.Create(Path.Combine(target, "Uninstall.exe")))
                {
                    stream.CopyTo(file);
                }
            }
        }

        private static void GrantUsersModify(string path)
        {
            try
            {
                var info = new ProcessStartInfo("icacls.exe",
                    "\"" + path + "\" /grant *S-1-5-32-545:(OI)(CI)M /T /C /Q")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                using (var process = Process.Start(info))
                {
                    if (process != null) process.WaitForExit(15000);
                }
            }
            catch
            {
                // The chosen folder may already be writable by the current user.
            }
        }

        // 1.0.0 及更早版本的快捷方式叫「华强智码」，安装新版时顺手清理。
        private static void DeleteLegacyShortcuts()
        {
            var programs = IsAdministrator
                ? Environment.SpecialFolder.CommonPrograms
                : Environment.SpecialFolder.Programs;
            var legacyLinks = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "华强智码.lnk"),
                Path.Combine(Environment.GetFolderPath(programs), "华强智码", "华强智码.lnk"),
            };
            foreach (var link in legacyLinks)
            {
                try { if (File.Exists(link)) File.Delete(link); } catch { }
            }
            try
            {
                var legacyFolder = Path.Combine(Environment.GetFolderPath(programs), "华强智码");
                if (Directory.Exists(legacyFolder) &&
                    !Directory.EnumerateFileSystemEntries(legacyFolder).Any())
                {
                    Directory.Delete(legacyFolder);
                }
            }
            catch { }
        }

        private static string CreateShortcut(string folder, string name, string exe, string profile, string temporaryRoot)
        {
            Directory.CreateDirectory(folder);
            var link = Path.Combine(folder, name + ".lnk");
            var temporaryFolder = Path.Combine(temporaryRoot, ".hq-shortcut-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temporaryFolder);
            var temporaryLink = Path.Combine(temporaryFolder, name + ".lnk");
            try
            {
                var shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) throw new InvalidOperationException("系统未注册 WScript.Shell，无法创建快捷方式。");
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(temporaryLink);
                shortcut.TargetPath = exe;
                shortcut.Arguments = "--no-sandbox --disable-gpu --user-data-dir=\"" + profile + "\"";
                shortcut.WorkingDirectory = Path.GetDirectoryName(exe);
                shortcut.IconLocation = exe + ",0";
                shortcut.Description = "华强以太 · 本地 AI 编程助手";
                shortcut.Save();
                // Some redirected desktops are marked read-only or protected by
                // Controlled Folder Access. Copying through the signed PowerShell
                // host succeeds where a direct write from the setup process may not.
                try
                {
                    File.Copy(temporaryLink, link, true);
                }
                catch (UnauthorizedAccessException)
                {
                    CopyWithPowerShell(temporaryLink, link, temporaryRoot);
                }
                return link;
            }
            finally
            {
                try { Directory.Delete(temporaryFolder, true); } catch { }
            }
        }

        private static void CopyWithPowerShell(string source, string destination, string workRoot)
        {
            var powershell = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            if (!File.Exists(powershell)) powershell = "powershell.exe";
            var scriptPath = Path.Combine(workRoot, "hq-copy-" + Guid.NewGuid().ToString("N") + ".ps1");
            var resultPath = scriptPath + ".log";
            var script = "$ErrorActionPreference = 'Stop'\r\n" +
                         "try {\r\n" +
                         "  Copy-Item -LiteralPath '" + source.Replace("'", "''") +
                         "' -Destination '" + destination.Replace("'", "''") + "' -Force\r\n" +
                         "  'OK' | Set-Content -LiteralPath '" + resultPath.Replace("'", "''") + "' -Encoding UTF8\r\n" +
                         "  exit 0\r\n" +
                         "} catch {\r\n" +
                         "  $_.Exception.ToString() | Set-Content -LiteralPath '" + resultPath.Replace("'", "''") + "' -Encoding UTF8\r\n" +
                         "  exit 1\r\n" +
                         "}\r\n";
            File.WriteAllText(scriptPath, script, new UTF8Encoding(true));
            var info = new ProcessStartInfo(powershell,
                "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + scriptPath + "\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (var process = Process.Start(info))
            {
                if (process != null) process.WaitForExit(20000);
            }
            try
            {
                if (File.Exists(scriptPath)) File.Delete(scriptPath);
            }
            catch { }
            if (!File.Exists(destination))
            {
                var detail = "";
                try
                {
                    if (File.Exists(resultPath)) detail = File.ReadAllText(resultPath);
                    if (File.Exists(resultPath)) File.Delete(resultPath);
                }
                catch { }
                throw new UnauthorizedAccessException(
                    "无法在目标文件夹创建快捷方式：" + destination +
                    (string.IsNullOrEmpty(detail) ? "" : "\n" + detail));
            }
            try
            {
                if (File.Exists(resultPath)) File.Delete(resultPath);
            }
            catch { }
        }

        private static void WriteUninstallInformation(string target, string profile, string desktopLink, string startLink)
        {
            try
            {
                using (var baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                using (var key = baseKey.CreateSubKey(UninstallRegistryKey))
                {
                    if (key == null) return;
                    var exe = Path.Combine(target, "HuaqiangAgent.exe");
                    var uninstall = Path.Combine(target, "Uninstall.exe");
                    var size = 0L;
                    try
                    {
                        size = Directory.EnumerateFiles(target, "*", SearchOption.AllDirectories).Sum(f => new FileInfo(f).Length);
                    }
                    catch
                    {
                        size = 0;
                    }
                    key.SetValue("DisplayName", "华强以太");
                    key.SetValue("DisplayVersion", AppVersion);
                    key.SetValue("Publisher", "华强以太");
                    key.SetValue("InstallLocation", target);
                    key.SetValue("DisplayIcon", exe + ",0");
                    key.SetValue("UninstallString", "\"" + uninstall + "\"");
                    key.SetValue("QuietUninstallString", "\"" + uninstall + "\" /quiet");
                    key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    key.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, size / 1024), RegistryValueKind.DWord);
                    key.SetValue("DesktopShortcut", desktopLink ?? string.Empty);
                    key.SetValue("StartMenuShortcut", startLink ?? string.Empty);
                    key.SetValue("ProfileDir", profile);
                }
            }
            catch (Exception error)
            {
                WriteLog("Registry write failed: " + error.Message);
            }
        }

        public static void WriteLog(string text)
        {
            var line = DateTime.Now.ToString("s") + " " + text + Environment.NewLine;
            foreach (var folder in new[] { Path.GetTempPath(), AppDomain.CurrentDomain.BaseDirectory })
            {
                try
                {
                    File.AppendAllText(Path.Combine(folder, "HuaqiangAgent-setup.log"), line, new UTF8Encoding(false));
                    return;
                }
                catch
                {
                    // Try the next writable location.
                }
            }
        }
    }

    internal sealed class InstallerForm : Form
    {
        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            var dark = 1;
            // Immersive dark title bar on Windows 10 1809+ / Windows 11.
            if (DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int)) != 0)
            {
                DwmSetWindowAttribute(Handle, 19, ref dark, sizeof(int));
            }
        }

        private readonly string defaultPath;
        private readonly TextBox pathBox;
        private readonly CheckBox desktopBox;
        private readonly Button browseButton;
        private readonly Button installButton;
        private readonly Button cancelButton;
        private readonly ProgressBar progressBar;
        private readonly Label statusLabel;
        private readonly Label adminLabel;
        private readonly Panel header;
        private readonly Image logo;
        private readonly Panel contentPanel;
        private readonly Panel successPanel;
        private readonly Label successWarning;
        private bool installing;
        private bool finished;

        public InstallerForm(string initialPath)
        {
            defaultPath = string.IsNullOrWhiteSpace(initialPath) ? InstallEngine.DefaultInstallDir : initialPath;
            Text = "华强以太 安装程序";
            ClientSize = new Size(760, 574);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = true;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(5, 7, 11);
            Font = new Font("Microsoft YaHei UI", 9F);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            logo = LoadEmbeddedLogo();

            header = new Panel { Dock = DockStyle.Top, Height = 112 };
            header.Paint += PaintHeader;
            Controls.Add(header);

            var footer = new Panel { Dock = DockStyle.Bottom, Height = 64, BackColor = Color.FromArgb(11, 16, 24) };
            footer.Paint += (s, e) =>
            {
                using (var pen = new Pen(Color.FromArgb(16, 232, 240, 250)))
                {
                    e.Graphics.DrawLine(pen, 0, 0, footer.Width, 0);
                }
            };
            Controls.Add(footer);

            contentPanel = new Panel { Dock = DockStyle.Fill, BackColor = Color.FromArgb(5, 7, 11) };
            Controls.Add(contentPanel);
            contentPanel.BringToFront();

            var heading = new Label
            {
                Text = "选择安装位置",
                Font = new Font("Microsoft YaHei UI", 15F, FontStyle.Bold),
                ForeColor = Color.FromArgb(232, 240, 250),
                Bounds = new Rectangle(34, 22, 500, 32)
            };
            var sub = new Label
            {
                Text = "安装完成后，可从桌面快捷方式直接启动，无需再次运行安装程序。",
                Font = new Font("Microsoft YaHei UI", 9F),
                ForeColor = Color.FromArgb(139, 156, 176),
                Bounds = new Rectangle(35, 58, 680, 24)
            };
            var pathLabel = new Label
            {
                Text = "安装目录",
                Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold),
                ForeColor = Color.FromArgb(195, 210, 228),
                Bounds = new Rectangle(35, 96, 200, 22)
            };
            pathBox = new TextBox
            {
                Text = defaultPath,
                Font = new Font("Microsoft YaHei UI", 9.5F),
                BackColor = Color.FromArgb(11, 16, 24),
                ForeColor = Color.FromArgb(232, 240, 250),
                Bounds = new Rectangle(35, 120, 570, 30),
                BorderStyle = BorderStyle.FixedSingle
            };
            browseButton = MakeButton("浏览…", false);
            browseButton.Bounds = new Rectangle(616, 118, 108, 32);
            browseButton.Click += (s, e) => Browse();
            adminLabel = new Label
            {
                Text = InstallEngine.IsAdministrator
                    ? "已获得管理员权限，将写入程序文件并注册系统卸载信息。"
                    : "当前不是管理员权限。安装到 Program Files 或写入系统卸载信息可能失败。",
                Font = new Font("Microsoft YaHei UI", 8.5F),
                ForeColor = InstallEngine.IsAdministrator ? Color.FromArgb(143, 211, 192) : Color.FromArgb(224, 160, 160),
                Bounds = new Rectangle(40, 15, 620, 22)
            };
            var adminPanel = new Panel
            {
                Bounds = new Rectangle(35, 166, 689, 52),
                BackColor = Color.FromArgb(11, 16, 24)
            };
            adminPanel.Paint += (s, e) =>
            {
                using (var pen = new Pen(Color.FromArgb(16, 232, 240, 250)))
                    e.Graphics.DrawRectangle(pen, 0, 0, adminPanel.Width - 1, adminPanel.Height - 1);
                using (var brush = new SolidBrush(Color.FromArgb(168, 198, 245)))
                {
                    e.Graphics.DrawString("◈", new Font("Segoe UI Symbol", 12F), brush, 13, 13);
                }
            };
            adminPanel.Controls.Add(adminLabel);

            desktopBox = new CheckBox
            {
                Text = "创建桌面快捷方式",
                Checked = true,
                Bounds = new Rectangle(37, 238, 220, 25),
                ForeColor = Color.FromArgb(195, 210, 228)
            };
            progressBar = new ProgressBar
            {
                Bounds = new Rectangle(35, 276, 689, 12),
                Style = ProgressBarStyle.Continuous,
                Visible = false
            };
            statusLabel = new Label
            {
                Text = "",
                Font = new Font("Microsoft YaHei UI", 8.5F),
                ForeColor = Color.FromArgb(139, 156, 176),
                Bounds = new Rectangle(35, 296, 690, 22)
            };

            contentPanel.Controls.AddRange(new Control[]
            {
                heading, sub, pathLabel, pathBox, browseButton, adminPanel,
                desktopBox, progressBar, statusLabel
            });

            successPanel = new Panel
            {
                Bounds = new Rectangle(0, 0, 760, 340),
                BackColor = Color.FromArgb(5, 7, 11),
                Visible = false
            };
            var successTitle = new Label
            {
                Text = "安装完成",
                Font = new Font("Microsoft YaHei UI", 20F, FontStyle.Bold),
                ForeColor = Color.FromArgb(143, 211, 192),
                Bounds = new Rectangle(35, 52, 400, 42)
            };
            var successText = new Label
            {
                Text = "华强以太已安装到你的电脑。\n可以从桌面快捷方式或开始菜单启动。",
                Font = new Font("Microsoft YaHei UI", 10F),
                ForeColor = Color.FromArgb(195, 210, 228),
                Bounds = new Rectangle(37, 108, 660, 62)
            };
            var successPath = new Label
            {
                Font = new Font("Consolas", 9F),
                ForeColor = Color.FromArgb(139, 156, 176),
                Bounds = new Rectangle(37, 180, 680, 24)
            };
            successWarning = new Label
            {
                Font = new Font("Microsoft YaHei UI", 8.5F),
                ForeColor = Color.FromArgb(224, 160, 160),
                Bounds = new Rectangle(37, 218, 680, 62),
                Visible = false
            };
            successPanel.Controls.AddRange(new Control[] { successTitle, successText, successPath, successWarning });
            successPanel.Tag = successPath;
            contentPanel.Controls.Add(successPanel);

            installButton = MakeButton("开始安装", true);
            installButton.Bounds = new Rectangle(606, 21, 124, 36);
            installButton.Click += (s, e) =>
            {
                if (finished) { Close(); return; }
                if (!installing) StartInstall();
            };
            cancelButton = MakeButton("取消", false);
            cancelButton.Bounds = new Rectangle(512, 21, 84, 36);
            cancelButton.Click += (s, e) => { if (!installing) Close(); };
            var versionLabel = new Label
            {
                Text = "华强以太 v1.0.1",
                Font = new Font("KaiTi", 10F),
                ForeColor = Color.FromArgb(168, 198, 245),
                Bounds = new Rectangle(34, 22, 400, 22)
            };
            footer.Controls.AddRange(new Control[] { installButton, cancelButton, versionLabel });

            FormClosing += (s, e) =>
            {
                if (installing) e.Cancel = true;
            };
        }

        private static Image LoadEmbeddedLogo()
        {
            try
            {
                using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("HuaqiangAgent.Logo.png"))
                {
                    if (stream == null) return null;
                    using (var image = Image.FromStream(stream))
                    {
                        return new Bitmap(image);
                    }
                }
            }
            catch
            {
                return null;
            }
        }

        private static Button MakeButton(string text, bool primary)
        {
            var button = new Button
            {
                Text = text,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Microsoft YaHei UI", 9.5F),
                Cursor = Cursors.Hand,
                TextAlign = ContentAlignment.MiddleCenter
            };
            button.FlatAppearance.BorderSize = 1;
            if (primary)
            {
                button.BackColor = Color.FromArgb(216, 232, 255);
                button.ForeColor = Color.FromArgb(6, 16, 31);
                button.FlatAppearance.BorderColor = Color.FromArgb(216, 232, 255);
            }
            else
            {
                button.BackColor = Color.FromArgb(11, 16, 24);
                button.ForeColor = Color.FromArgb(195, 210, 228);
                button.FlatAppearance.BorderColor = Color.FromArgb(42, 58, 80);
            }
            return button;
        }

        private void PaintHeader(object sender, PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var brush = new LinearGradientBrush(header.ClientRectangle, Color.FromArgb(5, 7, 11), Color.FromArgb(11, 16, 24), 12F))
            {
                g.FillRectangle(brush, header.ClientRectangle);
            }
            using (var font = new Font("KaiTi", 112F))
            using (var brush = new SolidBrush(Color.FromArgb(12, 232, 240, 250)))
            {
                g.DrawString("强", font, brush, 584, -18);
            }
            using (var glow = new SolidBrush(Color.FromArgb(20, 168, 198, 245)))
            {
                g.FillEllipse(glow, 18, 20, 76, 76);
            }
            if (logo != null)
            {
                g.DrawImage(logo, new Rectangle(24, 24, 64, 64));
            }

            using (var schoolFont = new Font("Microsoft YaHei UI", 8.5F))
            using (var schoolBrush = new SolidBrush(Color.FromArgb(139, 156, 176)))
            {
                g.DrawString("深圳市福田区华强职业技术学校", schoolFont, schoolBrush, 104, 20);
            }
            using (var titleFont = new Font("Microsoft YaHei UI", 22F, FontStyle.Bold))
            using (var titleBrush = new SolidBrush(Color.FromArgb(232, 240, 250)))
            {
                g.DrawString("华强以太", titleFont, titleBrush, 101, 38);
            }
            using (var subFont = new Font("Segoe UI", 8.5F, FontStyle.Bold))
            using (var subBrush = new SolidBrush(Color.FromArgb(168, 198, 245)))
            {
                g.DrawString("HQ AETHEON  ·  INSTALLER", subFont, subBrush, 105, 78);
            }
        }

        private static GraphicsPath RoundedRect(Rectangle bounds, int radius)
        {
            var path = new GraphicsPath();
            var d = radius * 2;
            path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
            path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
            path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
            path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        private void Browse()
        {
            using (var dialog = new FolderBrowserDialog())
            {
                dialog.Description = "选择华强以太的安装位置";
                dialog.ShowNewFolderButton = true;
                dialog.SelectedPath = SafeFullPath(pathBox.Text);
                if (dialog.ShowDialog(this) == DialogResult.OK)
                {
                    pathBox.Text = Path.Combine(dialog.SelectedPath, "HuaqiangAgent");
                }
            }
        }

        private static string SafeFullPath(string value)
        {
            try { return Path.GetFullPath(value); }
            catch { return InstallEngine.DefaultInstallDir; }
        }

        private void StartInstall()
        {
            var target = SafeFullPath(pathBox.Text.Trim());
            if (string.IsNullOrWhiteSpace(pathBox.Text))
            {
                MessageBox.Show(this, "请填写安装位置。", "华强以太", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (Directory.Exists(target) &&
                Directory.EnumerateFileSystemEntries(target).Any() &&
                !File.Exists(Path.Combine(target, "HuaqiangAgent.exe")))
            {
                var answer = MessageBox.Show(this,
                    "目标文件夹不是空目录。继续安装可能覆盖同名文件，是否继续？",
                    "华强以太", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
                if (answer != DialogResult.Yes) return;
            }

            installing = true;
            SetControlsEnabled(false);
            progressBar.Visible = true;
            progressBar.Value = 0;
            statusLabel.Text = "正在准备安装…";
            Application.DoEvents();

            try
            {
                InstallEngine.Install(new InstallOptions
                {
                    TargetDir = target,
                    CreateDesktopShortcut = desktopBox.Checked
                }, (value, total, name) =>
                {
                    progressBar.Maximum = Math.Max(1, total);
                    progressBar.Value = Math.Min(value, progressBar.Maximum);
                    statusLabel.Text = "正在安装 · " + name;
                    Application.DoEvents();
                });

                installing = false;
                finished = true;
                progressBar.Visible = false;
                statusLabel.Text = "";
                pathBox.Visible = false;
                browseButton.Visible = false;
                desktopBox.Visible = false;
                adminLabel.Parent.Visible = false;
                successPanel.Visible = true;
                var successPath = successPanel.Tag as Label;
                if (successPath != null) successPath.Text = target;
                successWarning.Text = InstallEngine.LastWarning ?? string.Empty;
                successWarning.Visible = !string.IsNullOrEmpty(InstallEngine.LastWarning);
                cancelButton.Visible = false;
                installButton.Text = "完成";
                installButton.Enabled = true;
                adminLabel.Text = "";
                foreach (Control control in contentPanel.Controls)
                {
                    if (control != successPanel) control.Visible = false;
                }
                successPanel.Visible = true;
            }
            catch (Exception error)
            {
                installing = false;
                SetControlsEnabled(true);
                progressBar.Visible = false;
                statusLabel.Text = "";
                InstallEngine.WriteLog("Install failed: " + error);
                MessageBox.Show(this,
                    "安装未完成：\n\n" + error.Message + "\n\n可以清理安装目录后重试。",
                    "华强以太", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void SetControlsEnabled(bool enabled)
        {
            pathBox.Enabled = enabled;
            browseButton.Enabled = enabled;
            desktopBox.Enabled = enabled;
            installButton.Enabled = enabled;
            cancelButton.Enabled = enabled;
        }
    }
}
