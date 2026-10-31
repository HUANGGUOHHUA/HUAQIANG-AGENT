using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("华强以太 卸载程序")]
[assembly: System.Reflection.AssemblyDescription("卸载华强以太")]
[assembly: System.Reflection.AssemblyProduct("华强以太")]
[assembly: System.Reflection.AssemblyCompany("华强以太")]
[assembly: System.Reflection.AssemblyCopyright("华强以太")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.1.0")]
[assembly: System.Reflection.AssemblyVersion("1.0.1.0")]

namespace HuaqiangAgentUninstall
{
    internal static class Program
    {
        private const string UninstallRegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\HuaqiangAgent";

        [STAThread]
        private static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var quiet = args.Any(a => a.Equals("/quiet", StringComparison.OrdinalIgnoreCase));

            var appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            if (!quiet)
            {
                var answer = MessageBox.Show(
                    "确定要卸载华强以太吗？\n\n" +
                    "安装目录：" + appDir + "\n" +
                    "本地会话、API Key、MCP 配置和工作区数据也会一并删除。\n\n" +
                    "卸载完成后，程序文件会在几秒内清理。",
                    "卸载华强以太",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning,
                    MessageBoxDefaultButton.Button2);
                if (answer != DialogResult.Yes) return 0;
            }

            string desktopShortcut = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                "华强以太.lnk");
            string startShortcut = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms),
                "华强以太",
                "华强以太.lnk");

            try
            {
                using (var baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                using (var key = baseKey.OpenSubKey(UninstallRegistryKey))
                {
                    if (key != null)
                    {
                        var desktop = key.GetValue("DesktopShortcut") as string;
                        var start = key.GetValue("StartMenuShortcut") as string;
                        if (!string.IsNullOrWhiteSpace(desktop)) desktopShortcut = desktop;
                        if (!string.IsNullOrWhiteSpace(start)) startShortcut = start;
                    }
                    baseKey.DeleteSubKeyTree(UninstallRegistryKey, false);
                }
            }
            catch
            {
                // The uninstall should continue even if the registry key is missing.
            }

            TryDelete(desktopShortcut);
            TryDelete(startShortcut);
            // 1.0.0 及更早版本的快捷方式叫「华强智码」，卸载时一并清理。
            TryDelete(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                "华强智码.lnk"));
            TryDelete(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms),
                "华强智码", "华强智码.lnk"));
            try
            {
                var legacyFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms), "华强智码");
                if (Directory.Exists(legacyFolder) &&
                    !Directory.EnumerateFileSystemEntries(legacyFolder).Any())
                {
                    Directory.Delete(legacyFolder);
                }
            }
            catch
            {
                // Ignore legacy folder cleanup.
            }
            try
            {
                var startFolder = Path.GetDirectoryName(startShortcut);
                if (!string.IsNullOrEmpty(startFolder) &&
                    Path.GetFileName(startFolder).Equals("华强以太", StringComparison.OrdinalIgnoreCase) &&
                    Directory.Exists(startFolder) &&
                    !Directory.EnumerateFileSystemEntries(startFolder).Any())
                {
                    Directory.Delete(startFolder);
                }
            }
            catch
            {
                // Ignore shortcut folder cleanup.
            }

            try
            {
                var batch = Path.Combine(Path.GetTempPath(), "hq-uninstall-" + Guid.NewGuid().ToString("N") + ".cmd");
                var script = new StringBuilder()
                    .AppendLine("@echo off")
                    .AppendLine("taskkill /IM HuaqiangAgent.exe /F >nul 2>&1")
                    .AppendLine("ping 127.0.0.1 -n 4 >nul")
                    .AppendLine("rmdir /s /q \"" + appDir + "\" >nul 2>&1")
                    .AppendLine("del /f /q \"%~f0\" >nul 2>&1")
                    .ToString();
                File.WriteAllText(batch, script, Encoding.Default);
                var info = new ProcessStartInfo("cmd.exe", "/c \"" + batch + "\"")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                Process.Start(info);
            }
            catch
            {
                // The app folder can also be deleted manually.
            }

            if (!quiet)
            {
                MessageBox.Show(
                    "华强以太已卸载。\n\n程序文件会在几秒后清理完成。",
                    "卸载华强以太",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            return 0;
        }

        private static void TryDelete(string path)
        {
            try
            {
                if (File.Exists(path)) File.Delete(path);
            }
            catch
            {
                // Shortcut cleanup is best effort.
            }
        }
    }
}
