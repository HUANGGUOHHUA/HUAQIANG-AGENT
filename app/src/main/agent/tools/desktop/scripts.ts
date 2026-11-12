// Windows 桌面控制的 PowerShell/C# 源码。
// 这些脚本只负责系统调用，业务逻辑全部在 session.ts / tools.ts。

export const MOUSE_SCRIPT = String.raw`param(
  [string]$Action,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$X2 = 0,
  [int]$Y2 = 0,
  [string]$Button = 'left',
  [int]$Clicks = 1,
  [int]$Amount = 0,
  [int]$Duration = 320
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class HqMouse
{
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    const uint LEFTDOWN = 0x0002;
    const uint LEFTUP = 0x0004;
    const uint RIGHTDOWN = 0x0008;
    const uint RIGHTUP = 0x0010;
    const uint MIDDLEDOWN = 0x0020;
    const uint MIDDLEUP = 0x0040;
    const uint WHEEL = 0x0800;
    const uint MOVE = 0x0001;
    const uint ABSOLUTE = 0x8000;
    const uint VIRTUALDESK = 0x4000;

    static HqMouse()
    {
        try
        {
            // Per-monitor v2 keeps physical coordinates consistent across
            // monitors with different DPI settings.
            if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware();
        }
        catch { try { SetProcessDPIAware(); } catch { } }
    }

    static void SetAbsolute(int x, int y)
    {
        // SendInput/mouse_event absolute movement is marked as injected, so the
        // takeover mouse hook lets the agent move while physically locking the user.
        int vx = GetSystemMetrics(76);
        int vy = GetSystemMetrics(77);
        int vw = GetSystemMetrics(78);
        int vh = GetSystemMetrics(79);
        if (vw <= 1 || vh <= 1)
        {
            if (!SetCursorPos(x, y)) throw new InvalidOperationException("SetCursorPos failed");
            return;
        }
        int nx = (int)Math.Round((x - vx) * 65535.0 / (vw - 1));
        int ny = (int)Math.Round((y - vy) * 65535.0 / (vh - 1));
        nx = Math.Max(0, Math.Min(65535, nx));
        ny = Math.Max(0, Math.Min(65535, ny));
        mouse_event(MOVE | ABSOLUTE | VIRTUALDESK, (uint)nx, (uint)ny, 0, UIntPtr.Zero);
    }

    public static void MoveTo(int x, int y, int duration)
    {
        POINT start;
        GetCursorPos(out start);
        int steps = Math.Max(8, Math.Min(90, duration / 16));
        for (int i = 1; i <= steps; i++)
        {
            double t = (double)i / steps;
            t = t * t * (3.0 - 2.0 * t);
            int nx = start.X + (int)Math.Round((x - start.X) * t);
            int ny = start.Y + (int)Math.Round((y - start.Y) * t);
            SetAbsolute(nx, ny);
            Thread.Sleep(Math.Max(4, duration / steps));
        }
        SetAbsolute(x, y);
    }

    public static void Click(int x, int y, string button, int clicks, int duration)
    {
        MoveTo(x, y, duration);
        // Human-like settle before pressing, with a held click instead of a
        // nearly instant down/up pair.
        Thread.Sleep(140);
        uint down = LEFTDOWN, up = LEFTUP;
        if (string.Equals(button, "right", StringComparison.OrdinalIgnoreCase)) { down = RIGHTDOWN; up = RIGHTUP; }
        else if (string.Equals(button, "middle", StringComparison.OrdinalIgnoreCase)) { down = MIDDLEDOWN; up = MIDDLEUP; }
        for (int i = 0; i < clicks; i++)
        {
            mouse_event(down, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(90);
            mouse_event(up, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(i + 1 < clicks ? 110 : 100);
        }
    }

    public static void Drag(int x1, int y1, int x2, int y2, int duration)
    {
        MoveTo(x1, y1, duration);
        Thread.Sleep(160);
        mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(120);
        int steps = Math.Max(16, Math.Min(120, duration / 12));
        for (int i = 1; i <= steps; i++)
        {
            double t = (double)i / steps;
            t = t * t * (3.0 - 2.0 * t);
            int x = x1 + (int)Math.Round((x2 - x1) * t);
            int y = y1 + (int)Math.Round((y2 - y1) * t);
            SetAbsolute(x, y);
            Thread.Sleep(Math.Max(4, duration / steps));
        }
        SetAbsolute(x2, y2);
        Thread.Sleep(120);
        mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero);
    }

    public static void Wheel(int amount)
    {
        mouse_event(WHEEL, 0, 0, amount * 120, UIntPtr.Zero);
    }
}
'@

$Duration = [Math]::Max(80, [Math]::Min(1500, $Duration))
switch ($Action.ToLowerInvariant()) {
  'move' {
    [HqMouse]::MoveTo($X, $Y, $Duration)
  }
  'click' {
    [HqMouse]::Click($X, $Y, $Button, [Math]::Max(1, [Math]::Min(3, $Clicks)), $Duration)
  }
  'drag' {
    [HqMouse]::Drag($X, $Y, $X2, $Y2, $Duration)
  }
  'scroll' {
    if ($X -ne 0 -or $Y -ne 0) { [HqMouse]::MoveTo($X, $Y, $Duration) }
    [HqMouse]::Wheel([Math]::Max(-20, [Math]::Min(20, $Amount)))
  }
  default { throw "unknown mouse action: $Action" }
}
Write-Output 'ok'
`

export const CLIPBOARD_PASTE_SCRIPT = String.raw`param(
  [string]$EncodedPaths,
  [int]$WaitMs = 900
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($EncodedPaths))
$paths = @($json | ConvertFrom-Json)
$resolved = @()
foreach ($path in $paths) {
  if (Test-Path -LiteralPath $path) {
    $resolved += (Resolve-Path -LiteralPath $path).Path
  }
}
if ($resolved.Count -eq 0) { throw '没有找到要发送的文件' }

$oldFiles = $null
$oldText = ''
$oldImage = $null
$oldHtml = ''
$oldRtf = ''
try { $oldFiles = [System.Windows.Forms.Clipboard]::GetFileDropList() } catch { }
try { $oldText = [System.Windows.Forms.Clipboard]::GetText() } catch { }
try { $oldImage = [System.Windows.Forms.Clipboard]::GetImage() } catch { }
try { $oldHtml = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::Html) } catch { }
try { $oldRtf = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::Rtf) } catch { }

try {
  $data = New-Object System.Windows.Forms.DataObject
  $files = New-Object System.Collections.Specialized.StringCollection
  foreach ($path in $resolved) { [void]$files.Add($path) }
  $data.SetFileDropList($files)
  [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
  Start-Sleep -Milliseconds 180
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds ([Math]::Max(300, [Math]::Min(3000, $WaitMs)))
} finally {
  $restore = New-Object System.Windows.Forms.DataObject
  if ($oldFiles -and $oldFiles.Count -gt 0) {
    $restore.SetFileDropList($oldFiles)
  } elseif ($oldImage) {
    $restore.SetImage($oldImage)
  } elseif ($oldText) {
    $restore.SetText($oldText)
  } elseif ($oldHtml) {
    $restore.SetText($oldHtml, [System.Windows.Forms.TextDataFormat]::Html)
  } elseif ($oldRtf) {
    $restore.SetText($oldRtf, [System.Windows.Forms.TextDataFormat]::Rtf)
  }
  [System.Windows.Forms.Clipboard]::SetDataObject($restore, $true)
}
Write-Output 'ok'
`

export const CLIPBOARD_TEXT_SCRIPT = String.raw`param(
  [string]$EncodedText,
  [int]$WaitMs = 600
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($EncodedText))
$oldText = ''
$oldFiles = $null
$oldImage = $null
$oldHtml = ''
$oldRtf = ''
try { $oldFiles = [System.Windows.Forms.Clipboard]::GetFileDropList() } catch { }
try { $oldText = [System.Windows.Forms.Clipboard]::GetText() } catch { }
try { $oldImage = [System.Windows.Forms.Clipboard]::GetImage() } catch { }
try { $oldHtml = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::Html) } catch { }
try { $oldRtf = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::Rtf) } catch { }
try {
  [System.Windows.Forms.Clipboard]::SetText($text)
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds ([Math]::Max(150, [Math]::Min(3000, $WaitMs)))
} finally {
  $restore = New-Object System.Windows.Forms.DataObject
  if ($oldFiles -and $oldFiles.Count -gt 0) {
    $restore.SetFileDropList($oldFiles)
  } elseif ($oldImage) {
    $restore.SetImage($oldImage)
  } elseif ($oldText) {
    $restore.SetText($oldText)
  } elseif ($oldHtml) {
    $restore.SetText($oldHtml, [System.Windows.Forms.TextDataFormat]::Html)
  } elseif ($oldRtf) {
    $restore.SetText($oldRtf, [System.Windows.Forms.TextDataFormat]::Rtf)
  }
  [System.Windows.Forms.Clipboard]::SetDataObject($restore, $true)
}
Write-Output 'ok'
`

export const KEYBOARD_SCRIPT = String.raw`param(
  [string]$Action,
  [string]$EncodedText = '',
  [string]$Keys = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class HqKeyboard
{
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public InputUnion U; }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint count, INPUT[] inputs, int size);

    [DllImport("user32.dll")]
    static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;
    const byte VK_LWIN = 0x5B;

    public static void TypeText(string text)
    {
        foreach (char c in text)
        {
            INPUT[] inputs = new INPUT[2];
            inputs[0].type = 1;
            inputs[0].U.ki.wScan = c;
            inputs[0].U.ki.dwFlags = KEYEVENTF_UNICODE;
            inputs[1] = inputs[0];
            inputs[1].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            if (SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT))) != 2)
                throw new InvalidOperationException("SendInput failed");
            Thread.Sleep(2);
        }
    }

    public static void PressWin(string key)
    {
        if (string.IsNullOrEmpty(key)) throw new ArgumentException("win key is empty");
        byte vk = (byte)char.ToUpperInvariant(key[0]);
        keybd_event(VK_LWIN, 0, 0, UIntPtr.Zero);
        Thread.Sleep(40);
        keybd_event(vk, 0, 0, UIntPtr.Zero);
        Thread.Sleep(50);
        keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        Thread.Sleep(30);
        keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
}
'@

if ($Action -eq 'type') {
  $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($EncodedText))
  if ([string]::IsNullOrEmpty($text)) { throw 'text is empty' }
  try {
    [HqKeyboard]::TypeText($text)
    Write-Output 'sendinput'
  } catch {
    # 安全软件常拦截 SendInput；SendKeys 走另一条通道，通常仍可用。
    $oldText = ''
    try { $oldText = [System.Windows.Forms.Clipboard]::GetText() } catch { }
    [System.Windows.Forms.Clipboard]::SetText($text)
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 320
    try { if ($oldText) { [System.Windows.Forms.Clipboard]::SetText($oldText) } } catch { }
    Write-Output 'clipboard'
  }
  exit 0
} elseif ($Action -eq 'press') {
  $raw = $Keys.Trim()
  if ([string]::IsNullOrWhiteSpace($raw)) { throw 'keys is empty' }
  $parts = $raw -split '\+'
  $key = $parts[$parts.Length - 1].Trim()
  $mods = ''
  $winMod = $false
  for ($i = 0; $i -lt $parts.Length - 1; $i++) {
    switch ($parts[$i].Trim().ToUpperInvariant()) {
      'CTRL' { $mods += '^' }
      'CONTROL' { $mods += '^' }
      'ALT' { $mods += '%' }
      'SHIFT' { $mods += '+' }
      'WIN' { $winMod = $true }
      'WINDOWS' { $winMod = $true }
      default { throw "unsupported modifier: $($parts[$i])" }
    }
  }
  if ($winMod) {
    if ($key.Length -ne 1) { throw 'WIN 组合目前只支持单个字母或数字键，例如 WIN+D' }
    [HqKeyboard]::PressWin($key)
    Write-Output 'ok'
    exit 0
  }
  $map = @{
    'ENTER'='{ENTER}'; 'RETURN'='{ENTER}'; 'TAB'='{TAB}'; 'ESC'='{ESC}'; 'ESCAPE'='{ESC}'
    'SPACE'=' '; 'BACKSPACE'='{BACKSPACE}'; 'DELETE'='{DELETE}'; 'INSERT'='{INSERT}'
    'HOME'='{HOME}'; 'END'='{END}'; 'PAGEUP'='{PGUP}'; 'PAGEDOWN'='{PGDN}'
    'UP'='{UP}'; 'DOWN'='{DOWN}'; 'LEFT'='{LEFT}'; 'RIGHT'='{RIGHT}'
    'F1'='{F1}'; 'F2'='{F2}'; 'F3'='{F3}'; 'F4'='{F4}'; 'F5'='{F5}'; 'F6'='{F6}'
    'F7'='{F7}'; 'F8'='{F8}'; 'F9'='{F9}'; 'F10'='{F10}'; 'F11'='{F11}'; 'F12'='{F12}'
    '+'='{+}'; '^'='{^}'; '%'='{%}'; '~'='{~}'; '('='{(}'; ')'='{)}'; '{'='{{}'; '}'='{}}'
    '['='{[}'; ']'='{]}'
  }
  $upper = $key.ToUpperInvariant()
  if ($map.ContainsKey($upper)) { $key = $map[$upper] }
  elseif ($key.Length -eq 1) { $key = $key }
  else { $key = '{' + $upper + '}' }
  [System.Windows.Forms.SendKeys]::SendWait($mods + $key)
} else {
  throw "unknown keyboard action: $Action"
}
Write-Output 'ok'
`


export const SCREEN_SCRIPT = String.raw`param([string]$Path)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HqScreenInfo
{
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
try {
  if (-not [HqScreenInfo]::SetProcessDpiAwarenessContext([IntPtr](-4))) { [HqScreenInfo]::SetProcessDPIAware() | Out-Null }
} catch { [HqScreenInfo]::SetProcessDPIAware() | Out-Null }

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = [System.Drawing.Bitmap]::new([int]$bounds.Width, [int]$bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen([int]$bounds.X, [int]$bounds.Y, 0, 0, $bitmap.Size)
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
Write-Output "$($bounds.X),$($bounds.Y),$($bounds.Width),$($bounds.Height)"
`

// 读取当前前台窗口（截图时用来限定 OCR 范围）。
export const FOREGROUND_SCRIPT = String.raw`param()
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class HqForeground
{
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
try {
  if (-not [HqForeground]::SetProcessDpiAwarenessContext([IntPtr](-4))) { [HqForeground]::SetProcessDPIAware() | Out-Null }
} catch { [HqForeground]::SetProcessDPIAware() | Out-Null }
$h = [HqForeground]::GetForegroundWindow()
if ($h -eq [IntPtr]::Zero) { Write-Output 'none'; exit 0 }
$sb = New-Object System.Text.StringBuilder 512
[void][HqForeground]::GetWindowText($h, $sb, 512)
$rect = New-Object HqForeground+RECT
if (-not [HqForeground]::GetWindowRect($h, [ref]$rect)) { Write-Output 'none'; exit 0 }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { Write-Output 'none'; exit 0 }
Write-Output ("{0}|{1},{2},{3},{4}" -f $sb.ToString(), $rect.Left, $rect.Top, $width, $height)
`

// 按标题把窗口切到前台，返回标题和屏幕矩形。找不到可见窗口时，会尝试
// 恢复最小化到托盘的隐藏窗口（QQ 等程序常见状态）。
export const WINDOW_FOCUS_SCRIPT = String.raw`param([string]$Title)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class HqFocus
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool altTab);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    public static IntPtr FindWindowForProcess(int pid)
    {
        IntPtr best = IntPtr.Zero;
        EnumWindows(delegate(IntPtr h, IntPtr l)
        {
            uint owner;
            GetWindowThreadProcessId(h, out owner);
            if (owner != (uint)pid) return true;
            int len = GetWindowTextLength(h);
            if (len > 0) { best = h; return false; }
            if (best == IntPtr.Zero) best = h;
            return true;
        }, IntPtr.Zero);
        return best;
    }

    public static IntPtr FindWindowByTitle(string title)
    {
        IntPtr best = IntPtr.Zero;
        EnumWindows(delegate(IntPtr h, IntPtr l)
        {
            int len = GetWindowTextLength(h);
            if (len <= 0) return true;
            StringBuilder sb = new StringBuilder(len + 1);
            GetWindowText(h, sb, sb.Capacity);
            if (sb.ToString().IndexOf(title, StringComparison.OrdinalIgnoreCase) >= 0)
            {
                best = h;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return best;
    }
}
'@
try {
  if (-not [HqFocus]::SetProcessDpiAwarenessContext([IntPtr](-4))) { [HqFocus]::SetProcessDPIAware() | Out-Null }
} catch { [HqFocus]::SetProcessDPIAware() | Out-Null }
$pattern = '*' + [System.Management.Automation.WildcardPattern]::Escape($Title) + '*'
$proc = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.MainWindowTitle -like $pattern } |
    Select-Object -First 1
$h = [IntPtr]::Zero
if ($proc) { $h = $proc.MainWindowHandle }
if ($h -eq [IntPtr]::Zero) { $h = [HqFocus]::FindWindowByTitle($Title) }
if ($h -eq [IntPtr]::Zero) {
    $proc = Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -like "*$Title*" } |
        Select-Object -First 1
    if ($proc) { $h = [HqFocus]::FindWindowForProcess($proc.Id) }
}
if ($h -eq [IntPtr]::Zero) { Write-Output 'notfound'; exit 0 }
[void][HqFocus]::ShowWindow($h, 9)
[void][HqFocus]::BringWindowToTop($h)
[void][HqFocus]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 600
if ([HqFocus]::GetForegroundWindow() -ne $h) {
    # 前台切换可能被系统拒绝；SwitchToThisWindow 是少数仍可用的兜底。
    [HqFocus]::SwitchToThisWindow($h, $true)
    Start-Sleep -Milliseconds 400
}
$sb = New-Object System.Text.StringBuilder 512
[void][HqFocus]::GetWindowText($h, $sb, 512)
$windowTitle = if ($sb.Length -gt 0) { $sb.ToString() } elseif ($proc) { $proc.ProcessName } else { $Title }
$rect = New-Object HqFocus+RECT
[void][HqFocus]::GetWindowRect($h, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) {
    Start-Sleep -Milliseconds 400
    [void][HqFocus]::GetWindowRect($h, [ref]$rect)
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
}
if ($width -le 0 -or $height -le 0) { Write-Output 'notfound'; exit 0 }
Write-Output ("{0}|{1},{2},{3},{4}" -f $windowTitle, $rect.Left, $rect.Top, $width, $height)
`

// 用命令行按进程名恢复/启动窗口：枚举该进程所有顶层窗口（包括隐藏/托盘窗口），
// 执行 ShowWindow + SetForegroundWindow；找不到时用进程路径或开始菜单重新启动。
export const WINDOW_RESTORE_SCRIPT = String.raw`param(
  [string]$ProcessName,
  [string]$Title = '',
  [switch]$Launch,
  [int]$WaitMs = 1200
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class HqRestore
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool altTab);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT placement);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct WINDOWPLACEMENT
    {
        public int length;
        public int flags;
        public int showCmd;
        public POINT ptMinPosition;
        public POINT ptMaxPosition;
        public RECT rcNormalPosition;
    }

    public static IntPtr[] FindWindows(int[] pids)
    {
        List<IntPtr> found = new List<IntPtr>();
        EnumWindows(delegate(IntPtr h, IntPtr l)
        {
            uint owner;
            GetWindowThreadProcessId(h, out owner);
            if (Array.IndexOf(pids, (int)owner) >= 0) found.Add(h);
            return true;
        }, IntPtr.Zero);
        return found.ToArray();
    }

    public static string TextOf(IntPtr h)
    {
        int len = GetWindowTextLength(h);
        if (len <= 0) return "";
        StringBuilder sb = new StringBuilder(len + 1);
        GetWindowText(h, sb, sb.Capacity);
        return sb.ToString();
    }
}
'@
try {
  if (-not [HqRestore]::SetProcessDpiAwarenessContext([IntPtr](-4))) { [HqRestore]::SetProcessDPIAware() | Out-Null }
} catch { [HqRestore]::SetProcessDPIAware() | Out-Null }
function Get-ProcessList { @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue) }
$procs = Get-ProcessList
if ($procs.Count -eq 0 -and $Launch) {
    $app = Get-StartApps -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*$ProcessName*" } |
        Select-Object -First 1
    if ($app) {
        Start-Process explorer.exe -ArgumentList "shell:AppsFolder\$($app.AppID)"
        Start-Sleep -Milliseconds $WaitMs
        $procs = Get-ProcessList
    }
}
if ($procs.Count -eq 0) { Write-Output 'notfound'; exit 0 }
$handles = [HqRestore]::FindWindows([int[]]($procs | ForEach-Object { $_.Id }))
if ($handles.Length -eq 0 -and $Launch) {
    $path = ($procs | Where-Object { $_.Path } | Select-Object -First 1).Path
    if ($path) {
        Start-Process -FilePath $path
        Start-Sleep -Milliseconds $WaitMs
        $procs = Get-ProcessList
        $handles = [HqRestore]::FindWindows([int[]]($procs | ForEach-Object { $_.Id }))
    }
}
if ($handles.Length -eq 0) { Write-Output 'notfound'; exit 0 }
$matching = @()
$all = @()
$filter = if ($Title) { $Title } else { $ProcessName }
foreach ($h in $handles) {
    $text = [HqRestore]::TextOf($h)
    $all += $h
    if ($text -and $text.IndexOf($filter, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $matching += $h
    }
}
if ($matching.Count -eq 0) {
    if ($Title) { Write-Output 'notfound'; exit 0 }
    $matching = $all
}
$candidates = @()
foreach ($h in $matching) {
    $placement = New-Object HqRestore+WINDOWPLACEMENT
    $placement.length = [System.Runtime.InteropServices.Marshal]::SizeOf([type][HqRestore+WINDOWPLACEMENT])
    $w = 0
    $hgt = 0
    if ([HqRestore]::GetWindowPlacement($h, [ref]$placement)) {
        $normal = $placement.rcNormalPosition
        $w = $normal.Right - $normal.Left
        $hgt = $normal.Bottom - $normal.Top
    }
    if ($w -le 0 -or $hgt -le 0) {
        $probe = New-Object HqRestore+RECT
        if ([HqRestore]::GetWindowRect($h, [ref]$probe)) {
            $w = $probe.Right - $probe.Left
            $hgt = $probe.Bottom - $probe.Top
        }
    }
    if ($w -le 0 -or $hgt -le 0) { continue }
    $candidates += [PSCustomObject]@{
        Handle = $h
        Area = $w * $hgt
        Visible = [HqRestore]::IsWindowVisible($h)
        Title = [HqRestore]::TextOf($h)
    }
}
if ($candidates.Count -eq 0) { Write-Output 'notfound'; exit 0 }
$best = ($candidates | Sort-Object -Property Area, Visible -Descending | Select-Object -First 1).Handle
# 只恢复选中的主窗口，避免把 QQ 的其他聊天/托盘窗口一起弹出来。
[void][HqRestore]::ShowWindow($best, 9)
[void][HqRestore]::ShowWindow($best, 5)
# 顶层窗口置前两次（TOPMOST -> NOTOPMOST）可绕过部分前台锁定。
[void][HqRestore]::SetWindowPos($best, [IntPtr](-1), 0, 0, 0, 0, 0x0003)
[void][HqRestore]::SetWindowPos($best, [IntPtr](-2), 0, 0, 0, 0, 0x0003)
[void][HqRestore]::BringWindowToTop($best)
[void][HqRestore]::SetForegroundWindow($best)
Start-Sleep -Milliseconds 500
if ([HqRestore]::GetForegroundWindow() -ne $best) {
    [void][HqRestore]::ShowWindow($best, 9)
    [HqRestore]::SwitchToThisWindow($best, $true)
    Start-Sleep -Milliseconds 400
}
$windowTitle = [HqRestore]::TextOf($best)
if (-not $windowTitle) { $windowTitle = $ProcessName }
$rect = New-Object HqRestore+RECT
[void][HqRestore]::GetWindowRect($best, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { Write-Output 'notfound'; exit 0 }
Write-Output ("{0}|{1},{2},{3},{4}" -f $windowTitle, $rect.Left, $rect.Top, $width, $height)
`

// 把截图裁剪到指定矩形，并把最大边缩放到 MaxEdge，避免多屏截图过大。
export const CROP_SCRIPT = String.raw`param(
  [string]$Source,
  [string]$Target,
  [int]$X,
  [int]$Y,
  [int]$Width,
  [int]$Height,
  [int]$MaxEdge = 1920
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$scale = [Math]::Max(1.0, [Math]::Max($Width, $Height) / [double]$MaxEdge)
$outWidth = [Math]::Max(1, [int][Math]::Round($Width / $scale))
$outHeight = [Math]::Max(1, [int][Math]::Round($Height / $scale))
$img = [System.Drawing.Image]::FromFile($Source)
try {
    $bmp = New-Object System.Drawing.Bitmap $outWidth, $outHeight
    try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $dest = New-Object System.Drawing.Rectangle 0, 0, $outWidth, $outHeight
            $src = New-Object System.Drawing.Rectangle $X, $Y, $Width, $Height
            $g.DrawImage($img, $dest, $src, [System.Drawing.GraphicsUnit]::Pixel)
        } finally { $g.Dispose() }
        $bmp.Save($Target, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $bmp.Dispose() }
} finally { $img.Dispose() }
Write-Output "$outWidth,$outHeight,$scale"
`
