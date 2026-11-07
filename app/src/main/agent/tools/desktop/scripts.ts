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
  [HqKeyboard]::TypeText($text)
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

export const UI_SCRIPT = String.raw`param([int]$Max = 80, [int]$ExcludePid = 0)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HqDesktopInfo
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int max);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
}
'@
try {
  if (-not [HqDesktopInfo]::SetProcessDpiAwarenessContext([IntPtr](-4))) { [HqDesktopInfo]::SetProcessDPIAware() | Out-Null }
} catch { [HqDesktopInfo]::SetProcessDPIAware() | Out-Null }

$fg = [HqDesktopInfo]::GetForegroundWindow()
$fgTitle = New-Object System.Text.StringBuilder 512
[HqDesktopInfo]::GetWindowText($fg, $fgTitle, 512) | Out-Null
$fgRect = New-Object HqDesktopInfo+RECT
[HqDesktopInfo]::GetWindowRect($fg, [ref]$fgRect) | Out-Null

$virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen
$displays = @()
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
  $b = $s.Bounds
  $w = $s.WorkingArea
  $displays += [pscustomobject]@{
    deviceName = $s.DeviceName
    primary = [bool]$s.Primary
    x = [int]$b.X; y = [int]$b.Y; width = [int]$b.Width; height = [int]$b.Height
    workX = [int]$w.X; workY = [int]$w.Y; workWidth = [int]$w.Width; workHeight = [int]$w.Height
    active = ($fgRect.Left -ge $b.X -and $fgRect.Left -lt ($b.X + $b.Width) -and $fgRect.Top -ge $b.Y -and $fgRect.Top -lt ($b.Y + $b.Height))
  }
}

function Get-ElementId($element) {
  try {
    $id = $element.GetRuntimeId()
    if ($id) { return ($id -join '.') }
  } catch { }
  return ''
}

function Get-Rect($element) {
  try {
    $r = $element.Current.BoundingRectangle
    if ([double]::IsInfinity($r.X) -or [double]::IsInfinity($r.Y) -or $r.Width -le 0 -or $r.Height -le 0) { return $null }
    return [pscustomobject]@{
      x = [int][Math]::Round($r.X)
      y = [int][Math]::Round($r.Y)
      width = [int][Math]::Round($r.Width)
      height = [int][Math]::Round($r.Height)
    }
  } catch { return $null }
}

$items = @()
$root = [Windows.Automation.AutomationElement]::RootElement
$all = [Windows.Automation.Condition]::TrueCondition
$windows = $root.FindAll([Windows.Automation.TreeScope]::Children, $all)
foreach ($window in $windows) {
  if ($items.Count -ge $Max) { break }
  try {
    if ($window.Current.IsOffscreen) { continue }
    $processId = 0
    try { $processId = [int]$window.Current.ProcessId } catch { }
    if ($ExcludePid -gt 0 -and $processId -eq $ExcludePid) { continue }
    $rect = Get-Rect $window
    if ($null -eq $rect) { continue }
    $windowName = $window.Current.Name
    if ($windowName -match '华强以太正在控制|退出请按|鼠标已锁定') { continue }
    $handle = $window.Current.NativeWindowHandle
    $items += [pscustomobject]@{
      index = $items.Count
      id = (Get-ElementId $window)
      kind = 'window'
      name = $windowName
      type = 'Window'
      automationId = ''
      className = $window.Current.ClassName
      x = $rect.x; y = $rect.y; width = $rect.width; height = $rect.height
      enabled = [bool]$window.Current.IsEnabled
      active = ([int]$handle -eq [int]$fg)
    }
    $children = $window.FindAll([Windows.Automation.TreeScope]::Descendants, $all)
    foreach ($child in $children) {
      if ($items.Count -ge $Max) { break }
      try {
        if ($child.Current.IsOffscreen) { continue }
        $type = ($child.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '')
        if (@('Button','Edit','ComboBox','CheckBox','RadioButton','MenuItem','ListItem','TabItem','TreeItem','Hyperlink','Document','Text') -notcontains $type) { continue }
        $name = $child.Current.Name
        if ($name -match '华强以太正在控制|退出请按|鼠标已锁定') { continue }
        $aid = $child.Current.AutomationId
        if ([string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace($aid)) { continue }
        $crect = Get-Rect $child
        if ($null -eq $crect) { continue }
        $items += [pscustomobject]@{
          index = $items.Count
          id = (Get-ElementId $child)
          kind = 'control'
          window = $windowName
          name = $name
          type = $type
          automationId = $aid
          className = $child.Current.ClassName
          x = $crect.x; y = $crect.y; width = $crect.width; height = $crect.height
          enabled = [bool]$child.Current.IsEnabled
          active = $false
        }
      } catch { }
    }
  } catch { }
}

[pscustomobject]@{
  screenWidth = [int]$virtual.Width
  screenHeight = [int]$virtual.Height
  virtualScreen = [pscustomobject]@{
    x = [int]$virtual.X; y = [int]$virtual.Y
    width = [int]$virtual.Width; height = [int]$virtual.Height
  }
  displays = @($displays)
  foregroundWindow = $fgTitle.ToString()
  foregroundRect = [pscustomobject]@{
    x = $fgRect.Left; y = $fgRect.Top
    width = ($fgRect.Right - $fgRect.Left); height = ($fgRect.Bottom - $fgRect.Top)
  }
  items = @($items)
} | ConvertTo-Json -Depth 7 -Compress
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
