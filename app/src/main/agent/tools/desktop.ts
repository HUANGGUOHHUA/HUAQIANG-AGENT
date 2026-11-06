import { execFile } from 'node:child_process'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type { BrowserWindow } from 'electron'
import { detectEdges } from '../../attachments/edges'
import { ocrImage, ocrImageBoxes } from '../../attachments/ocr'
import type { ToolDefinition } from './types'
import { ToolError, boolArg, numberArg, stringArg, truncate } from './types'

const run = promisify(execFile)

const MOUSE_SCRIPT = String.raw`param(
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

const KEYBOARD_SCRIPT = String.raw`param(
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

const UI_SCRIPT = String.raw`param([int]$Max = 80, [int]$ExcludePid = 0)
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

const SCREEN_SCRIPT = String.raw`param([string]$Path)
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

const POST_MOUSE_DELAY_MS = 300
const UI_CACHE_TTL_MS = 1_500
let uiCache: { items: UiSnapshotItem[]; at: number } | null = null

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function ensureScript(name: string, content: string): Promise<string> {
  const path = join(tmpdir(), `huaqiang-${name}.ps1`)
  await writeFile(path, content, 'utf8')
  return path
}

async function runPowerShell(
  name: string,
  content: string,
  args: string[],
  timeout = 20_000
): Promise<string> {
  const script = await ensureScript(name, content)
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }
    )
    return stdout.trim()
  } catch (error) {
    const detail =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr ?? '')
        : ''
    throw new ToolError(
      truncate(
        `桌面操作失败${detail ? `：${detail.trim()}` : `：${error instanceof Error ? error.message : String(error)}`}`,
        3_000
      )
    )
  }
}

interface UiSnapshotItem {
  index?: number
  id?: string
  kind?: string
  name?: string
  type?: string
  x?: number
  y?: number
  width?: number
  height?: number
}

function parseUiItems(output: string): UiSnapshotItem[] {
  try {
    const parsed = JSON.parse(output) as { items?: unknown }
    return Array.isArray(parsed.items) ? (parsed.items as UiSnapshotItem[]) : []
  } catch {
    return []
  }
}

function pickUiItem(
  items: UiSnapshotItem[],
  args: Record<string, unknown>
): UiSnapshotItem | null {
  const wantedId = stringArg(args, 'id').trim()
  if (wantedId) {
    return items.find((item) => item.id === wantedId) ?? null
  }
  const index = numberArg(args, 'index', -1, -1, 100_000)
  if (index >= 0) {
    return items.find((item) => item.index === index) ?? null
  }
  const wantedName = stringArg(args, 'name').trim().toLowerCase()
  const wantedType = stringArg(args, 'type').trim().toLowerCase()
  if (!wantedName && !wantedType) return null
  const candidates = items.filter((item) => {
    if (item.kind !== 'control') return false
    if (wantedType && String(item.type ?? '').toLowerCase() !== wantedType) return false
    if (!wantedName) return true
    return String(item.name ?? '').toLowerCase().includes(wantedName)
  })
  if (!candidates.length) return null
  return (
    candidates.find((item) => String(item.name ?? '').toLowerCase() === wantedName) ??
    candidates[0]
  )
}

function mouseArgs(action: string, args: Record<string, unknown>): string[] {
  return [
    '-Action', action,
    '-X', String(numberArg(args, 'x', 0, -100_000, 100_000)),
    '-Y', String(numberArg(args, 'y', 0, -100_000, 100_000)),
    '-X2', String(numberArg(args, 'to_x', 0, -100_000, 100_000)),
    '-Y2', String(numberArg(args, 'to_y', 0, -100_000, 100_000)),
    '-Button', stringArg(args, 'button', { fallback: 'left' }).toLowerCase(),
    '-Clicks', String(numberArg(args, 'clicks', 1, 1, 3)),
    '-Amount', String(numberArg(args, 'amount', 0, -20, 20)),
    '-Duration', String(numberArg(args, 'duration_ms', 320, 80, 1500))
  ]
}

export interface DesktopToolOptions {
  suspendOverlay?: () => void
  resumeOverlay?: () => void
  highlight?: (target: { x: number; y: number; width?: number; height?: number; label?: string }) => void
  pythonPath?: () => string
}

export function createDesktopTools(
  getWindow: () => BrowserWindow | null,
  options: DesktopToolOptions = {}
): ToolDefinition[] {
  const captureVirtualScreen = async (): Promise<{
    path: string
    bounds: { x: number; y: number; width: number; height: number }
  }> => {
    options.suspendOverlay?.()
    const win = getWindow()
    const wasVisible = Boolean(win && !win.isDestroyed() && win.isVisible())
    if (wasVisible) win!.hide()
    try {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const path = join(tmpdir(), `huaqiang-screen-${Date.now()}.png`)
      const raw = await runPowerShell('desktop-screen', SCREEN_SCRIPT, ['-Path', path], 20_000)
      const [x, y, width, height] = raw.split(',').map((value) => Number(value))
      return {
        path,
        bounds: {
          x: Number.isFinite(x) ? x : 0,
          y: Number.isFinite(y) ? y : 0,
          width: Number.isFinite(width) ? width : 0,
          height: Number.isFinite(height) ? height : 0
        }
      }
    } finally {
      if (wasVisible && win && !win.isDestroyed()) {
        win.show()
        win.focus()
      }
      options.resumeOverlay?.()
    }
  }

  const clickScreenText = async (
    text: string,
    args: Record<string, unknown>,
    context: { signal: AbortSignal }
  ): Promise<{ output: string }> => {
    const shot = await captureVirtualScreen()
    try {
      const ocr = await ocrImageBoxes(shot.path)
      const normalize = (value: string): string => value.replace(/\s+/g, '').toLowerCase()
      const wanted = normalize(text)
      const candidates = ocr.lines.filter((line) => normalize(line.text).includes(wanted))
      const line = candidates[0]
      if (!line) {
        const sample = ocr.lines
          .slice(0, 10)
          .map((item) => item.text)
          .join('、')
        throw new ToolError(`没有找到文字「${text}」${sample ? `。屏幕文字：${sample}` : ''}`)
      }
      const x = Math.round(shot.bounds.x + line.x + line.width / 2)
      const y = Math.round(shot.bounds.y + line.y + line.height / 2)
      options.highlight?.({
        x,
        y,
        width: line.width,
        height: line.height,
        label: line.text
      })
      await runPowerShell(
        'desktop-mouse',
        MOUSE_SCRIPT,
        mouseArgs('click', { ...args, x, y }),
        12_000
      )
      await waitFor(POST_MOUSE_DELAY_MS, context.signal)
      uiCache = null
      return { output: `已通过屏幕文字点击「${line.text}」中心 (${x}, ${y})` }
    } finally {
      await unlink(shot.path).catch(() => undefined)
    }
  }

  return [
    {
      name: 'ui_snapshot',
      displayName: '识别界面',
      risk: 'read',
      description:
        '读取当前所有显示器上的前台窗口和可见控件，返回虚拟桌面范围、显示器列表、控件类型、名称、AutomationId、屏幕坐标（物理像素）和大小。不知道目标控件时才用它；目标名称明确可直接 ui_click(name) 或 screen_click(text)。参数 max_items：最多返回多少个条目，默认 80。',
      inputSchema: {
        type: 'object',
        properties: {
          max_items: { type: 'number', description: '最多返回的窗口/控件数量，默认 80，最大 150' }
        },
        additionalProperties: false
      },
      summarize: () => '识别当前桌面窗口和控件',
      execute: async (args) => {
        const max = numberArg(args, 'max_items', 80, 20, 150)
        const output = await runPowerShell(
          'ui-snapshot',
          UI_SCRIPT,
          ['-Max', String(max), '-ExcludePid', String(process.pid)],
          25_000
        )
        const items = parseUiItems(output)
        uiCache = { items, at: Date.now() }
        return { output: output || '{"items":[]}' }
      }
    },
    {
      name: 'screen_ocr',
      displayName: '读取屏幕文字',
      risk: 'read',
      description:
        '截取整个虚拟桌面并用 Windows 本地 OCR 识别文字。默认返回每行文字及其虚拟桌面绝对坐标（x/y/width/height），可直接用于判断位置；不需要坐标时传 with_boxes=false。只想点击某段文字时直接用 screen_click(text)。',
      inputSchema: {
        type: 'object',
        properties: {
          with_boxes: {
            type: 'boolean',
            description: '是否返回每行文字的 x/y/width/height，默认 true'
          }
        },
        additionalProperties: false
      },
      summarize: () => '截取全部显示器并识别文字坐标',
      execute: async (args) => {
        options.suspendOverlay?.()
        const win = getWindow()
        const wasVisible = Boolean(win && !win.isDestroyed() && win.isVisible())
        if (wasVisible) win!.hide()
        await new Promise((resolve) => setTimeout(resolve, 350))
        const path = join(tmpdir(), `huaqiang-screen-${Date.now()}.png`)
        let bounds = ''
        try {
          bounds = await runPowerShell(
            'desktop-screen',
            SCREEN_SCRIPT,
            ['-Path', path],
            20_000
          )
        } finally {
          if (wasVisible && win && !win.isDestroyed()) {
            win.show()
            win.focus()
          }
          options.resumeOverlay?.()
        }
        try {
          const [x, y, width, height] = bounds.split(',').map((value) => Number(value))
          const originX = Number.isFinite(x) ? x : 0
          const originY = Number.isFinite(y) ? y : 0
          const range =
            Number.isFinite(x) && Number.isFinite(y)
              ? `虚拟桌面：x=${x} y=${y} ${width}x${height}`
              : '虚拟桌面：尺寸未知'
          const withBoxes = boolArg(args, 'with_boxes', true)
          if (!withBoxes) {
            const text = await ocrImage(path)
            return {
              output: truncate(`${range}\n${text || '（未识别到文字）'}`, 40_000)
            }
          }
          const boxes = await ocrImageBoxes(path)
          const lines = boxes.lines
            .map(
              (line, index) =>
                `${index + 1}. x=${Math.round(originX + line.x)} y=${Math.round(originY + line.y)} w=${line.width} h=${line.height} | ${line.text}`
            )
            .join('\n')
          return {
            output: truncate(`${range}\n${lines || '（未识别到文字）'}`, 40_000)
          }
        } finally {
          await unlink(path).catch(() => undefined)
        }
      }
    },
    {
      name: 'screen_edges',
      displayName: '检测屏幕控件边缘',
      risk: 'read',
      description:
        '截取虚拟桌面并做本地边缘检测，返回可见矩形控件的边缘外框（x/y/width/height/center）。适合 Canvas、自绘按钮、远程桌面等 UI Automation/DOM 读不到边界的界面；普通按钮优先 ui_snapshot 或 browser_snapshot。',
      inputSchema: {
        type: 'object',
        properties: {
          min_width: { type: 'number', description: '最小控件宽度，默认 20' },
          min_height: { type: 'number', description: '最小控件高度，默认 12' },
          max_boxes: { type: 'number', description: '最多返回多少个矩形，默认 40，最大 80' }
        },
        additionalProperties: false
      },
      summarize: () => '检测屏幕控件边缘',
      execute: async (args) => {
        const shot = await captureVirtualScreen()
        try {
          const result = await detectEdges(shot.path, {
            pythonPath: options.pythonPath?.(),
            minWidth: numberArg(args, 'min_width', 20, 4, 2000),
            minHeight: numberArg(args, 'min_height', 12, 4, 2000),
            maxBoxes: numberArg(args, 'max_boxes', 40, 1, 80)
          })
          const boxes = result.boxes.map((box) => ({
            ...box,
            x: shot.bounds.x + box.x,
            y: shot.bounds.y + box.y,
            centerX: shot.bounds.x + box.centerX,
            centerY: shot.bounds.y + box.centerY
          }))
          return {
            output: truncate(
              JSON.stringify(
                {
                  screen: shot.bounds,
                  width: result.width,
                  height: result.height,
                  boxes
                },
                null,
                2
              ),
              40_000
            )
          }
        } finally {
          await unlink(shot.path).catch(() => undefined)
        }
      }
    },
    {
      name: 'screen_click',
      displayName: '识别文字并点击',
      risk: 'exec',
      description:
        '一次完成截图、OCR 和点击：在屏幕上找到指定文字，直接点击文字中心。目标文字明确时优先使用它，不需要先 screen_ocr 或 ui_snapshot。适合按钮、菜单、网页文字和 UI Automation 读不到的界面。',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '屏幕上要点击的文字，例如“批量下载”' },
          button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标按键，默认 left' },
          clicks: { type: 'number', description: '点击次数，1-3，默认 1' },
          duration_ms: { type: 'number', description: '平滑移动时长，默认 320 毫秒' }
        },
        required: ['text'],
        additionalProperties: false
      },
      summarize: (args) => `识别并点击文字「${stringArg(args, 'text').slice(0, 40)}」`,
      execute: async (args, context) => {
        const text = stringArg(args, 'text', { required: true, max: 200 }).trim()
        if (!text) throw new ToolError('text 不能为空')
        return clickScreenText(text, args, context)
      }
    },
    {
      name: 'ui_click',
      displayName: '识别并点击',
      risk: 'exec',
      description:
        '按名称、id 或类型点击控件中心。名称明确时直接 ui_click(name="批量下载")，不必先 ui_snapshot；UI Automation 找不到时会自动截屏 OCR，找到相同文字后点击。id 最稳定，name 支持包含匹配，index 只对最近一次快照有效。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ui_snapshot 返回的稳定控件 id，优先级最高' },
          index: { type: 'number', description: '最近一次 ui_snapshot 的控件编号' },
          name: { type: 'string', description: '控件名称，支持包含匹配，例如“保存”' },
          type: { type: 'string', description: '控件类型，例如 Button、Edit、MenuItem' },
          button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标按键，默认 left' },
          clicks: { type: 'number', description: '点击次数，1-3，默认 1' },
          duration_ms: { type: 'number', description: '平滑移动到控件的时长，默认 320 毫秒' }
        },
        additionalProperties: false
      },
      summarize: (args) => {
        const id = stringArg(args, 'id').slice(0, 40)
        if (id) return `识别并点击控件 ${id}`
        const index = numberArg(args, 'index', -1, -1, 100_000)
        if (index >= 0) return `识别并点击控件 #${index}`
        const name = stringArg(args, 'name').slice(0, 40)
        const type = stringArg(args, 'type')
        return `识别并点击 ${type ? `${type} ` : ''}${name || '?'}`
      },
      execute: async (args, context) => {
        const refresh = async (): Promise<UiSnapshotItem[]> => {
          const snapshot = await runPowerShell(
            'ui-snapshot',
            UI_SCRIPT,
            ['-Max', '150', '-ExcludePid', String(process.pid)],
            25_000
          )
          const items = parseUiItems(snapshot)
          uiCache = { items, at: Date.now() }
          return items
        }
        const cached =
          uiCache && Date.now() - uiCache.at <= UI_CACHE_TTL_MS ? uiCache.items : null
        let items = cached ?? (await refresh())
        let item = pickUiItem(items, args)
        if (!item && cached) {
          items = await refresh()
          item = pickUiItem(items, args)
        }
        if (!items.length || !item) {
          const name = stringArg(args, 'name').trim()
          if (name) {
            try {
              const fallback = await clickScreenText(name, args, context)
              return { output: `UI Automation 未找到，${fallback.output}` }
            } catch (screenError) {
              const names = items
                .filter((entry) => entry.kind === 'control')
                .slice(0, 12)
                .map((entry) => `${entry.type ?? '控件'}:${entry.name ?? ''}`)
                .join('；')
              const detail =
                screenError instanceof Error ? screenError.message : String(screenError)
              throw new ToolError(
                `没有找到匹配的控件${names ? `。可用控件：${names}` : ''}；屏幕识别也未找到：${detail}`
              )
            }
          }
          const names = items
            .filter((entry) => entry.kind === 'control')
            .slice(0, 12)
            .map((entry) => `${entry.type ?? '控件'}:${entry.name ?? ''}`)
            .join('；')
          throw new ToolError(
            `没有找到匹配的控件${names ? `。可用控件：${names}` : ''}`
          )
        }
        const x = Math.round(Number(item.x ?? 0) + Number(item.width ?? 0) / 2)
        const y = Math.round(Number(item.y ?? 0) + Number(item.height ?? 0) / 2)
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new ToolError('控件坐标无效')
        }
        options.highlight?.({
          x,
          y,
          width: Number(item.width ?? 26),
          height: Number(item.height ?? 26),
          label: `${item.type ?? '控件'}${item.name ? ` ${item.name}` : ''}`
        })
        await runPowerShell(
          'desktop-mouse',
          MOUSE_SCRIPT,
          mouseArgs('click', {
            ...args,
            x,
            y
          }),
          12_000
        )
        await waitFor(POST_MOUSE_DELAY_MS, context.signal)
        uiCache = null
        return {
          output: `已点击 ${item.type ?? '控件'}「${item.name ?? ''}」中心 (${x}, ${y})`
        }
      }
    },
    {
      name: 'mouse_move',
      displayName: '移动鼠标',
      risk: 'exec',
      description:
        '把鼠标平滑移动到屏幕坐标 (x, y)，支持多显示器虚拟桌面坐标。坐标使用 ui_snapshot 返回的物理像素坐标；用户可以看到鼠标移动过程。',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '屏幕 X 坐标' },
          y: { type: 'number', description: '屏幕 Y 坐标' },
          duration_ms: { type: 'number', description: '平滑移动时长，默认 320 毫秒，范围 80-1500' }
        },
        required: ['x', 'y'],
        additionalProperties: false
      },
      summarize: (args) => `移动鼠标到 (${numberArg(args, 'x', 0, -100_000, 100_000)}, ${numberArg(args, 'y', 0, -100_000, 100_000)})`,
      execute: async (args, context) => {
        const x = numberArg(args, 'x', 0, -100_000, 100_000)
        const y = numberArg(args, 'y', 0, -100_000, 100_000)
        options.highlight?.({ x, y, label: '鼠标移动' })
        await runPowerShell('desktop-mouse', MOUSE_SCRIPT, mouseArgs('move', args), 12_000)
        await waitFor(POST_MOUSE_DELAY_MS, context.signal)
        uiCache = null
        return { output: '鼠标已移动' }
      }
    },
    {
      name: 'mouse_click',
      displayName: '点击鼠标',
      risk: 'exec',
      description:
        '在屏幕坐标 (x, y) 点击鼠标，坐标已知时直接使用。鼠标会先平滑移动到目标，再执行点击。button 可选 left/right/middle，clicks 可选 1-3（双击传 2）。',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '屏幕 X 坐标' },
          y: { type: 'number', description: '屏幕 Y 坐标' },
          button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标按键，默认 left' },
          clicks: { type: 'number', description: '点击次数，1-3，默认 1' },
          duration_ms: { type: 'number', description: '平滑移动到目标的时长，默认 320 毫秒' }
        },
        required: ['x', 'y'],
        additionalProperties: false
      },
      summarize: (args) => {
        const button = stringArg(args, 'button', { fallback: 'left' })
        const clicks = numberArg(args, 'clicks', 1, 1, 3)
        return `${button === 'right' ? '右键' : button === 'middle' ? '中键' : '左键'}点击 (${numberArg(args, 'x', 0, -100_000, 100_000)}, ${numberArg(args, 'y', 0, -100_000, 100_000)}) ×${clicks}`
      },
      execute: async (args, context) => {
        const x = numberArg(args, 'x', 0, -100_000, 100_000)
        const y = numberArg(args, 'y', 0, -100_000, 100_000)
        const button = stringArg(args, 'button', { fallback: 'left' })
        options.highlight?.({
          x,
          y,
          label: `${button === 'right' ? '右键' : button === 'middle' ? '中键' : '点击'} (${x}, ${y})`
        })
        await runPowerShell('desktop-mouse', MOUSE_SCRIPT, mouseArgs('click', args), 12_000)
        await waitFor(POST_MOUSE_DELAY_MS, context.signal)
        uiCache = null
        return { output: '鼠标点击完成' }
      }
    },
    {
      name: 'mouse_drag',
      displayName: '拖拽鼠标',
      risk: 'exec',
      description:
        '按住鼠标左键从 (x, y) 平滑拖拽到 (to_x, to_y)。用于拖动窗口、滑块或选择文本；支持跨显示器。',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '起点 X 坐标' },
          y: { type: 'number', description: '起点 Y 坐标' },
          to_x: { type: 'number', description: '终点 X 坐标' },
          to_y: { type: 'number', description: '终点 Y 坐标' },
          duration_ms: { type: 'number', description: '平滑拖拽时长，默认 320 毫秒' }
        },
        required: ['x', 'y', 'to_x', 'to_y'],
        additionalProperties: false
      },
      summarize: (args) => `拖拽 (${numberArg(args, 'x', 0, -100_000, 100_000)}, ${numberArg(args, 'y', 0, -100_000, 100_000)}) → (${numberArg(args, 'to_x', 0, -100_000, 100_000)}, ${numberArg(args, 'to_y', 0, -100_000, 100_000)})`,
      execute: async (args, context) => {
        options.highlight?.({
          x: numberArg(args, 'x', 0, -100_000, 100_000),
          y: numberArg(args, 'y', 0, -100_000, 100_000),
          label: '拖拽起点'
        })
        await runPowerShell('desktop-mouse', MOUSE_SCRIPT, mouseArgs('drag', args), 15_000)
        await waitFor(POST_MOUSE_DELAY_MS, context.signal)
        uiCache = null
        return { output: '鼠标拖拽完成' }
      }
    },
    {
      name: 'mouse_scroll',
      displayName: '滚动滚轮',
      risk: 'exec',
      description:
        '滚动鼠标滚轮。amount 为正数向上、负数向下，范围 -20 到 20；可选 x/y 先把鼠标移动到目标位置。',
      inputSchema: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: '滚动格数，正数向上，负数向下' },
          x: { type: 'number', description: '可选，滚动前移动到的 X 坐标' },
          y: { type: 'number', description: '可选，滚动前移动到的 Y 坐标' },
          duration_ms: { type: 'number', description: '可选，滚动前移动的动画时长' }
        },
        required: ['amount'],
        additionalProperties: false
      },
      summarize: (args) => `滚动滚轮 ${numberArg(args, 'amount', 0, -20, 20)} 格`,
      execute: async (args, context) => {
        const amount = numberArg(args, 'amount', 0, -20, 20)
        if (amount === 0) throw new ToolError('amount 不能为 0')
        const x = numberArg(args, 'x', 0, -100_000, 100_000)
        const y = numberArg(args, 'y', 0, -100_000, 100_000)
        if (x !== 0 || y !== 0) {
          options.highlight?.({ x, y, label: `滚轮 ${amount > 0 ? '↑' : '↓'} ${Math.abs(amount)}` })
        }
        await runPowerShell('desktop-mouse', MOUSE_SCRIPT, mouseArgs('scroll', args), 12_000)
        await waitFor(POST_MOUSE_DELAY_MS, context.signal)
        uiCache = null
        return { output: '滚轮操作完成' }
      }
    },
    {
      name: 'keyboard_type',
      displayName: '输入文字',
      risk: 'exec',
      description:
        '向当前前台窗口输入文字，支持中文和 Unicode。输入前先用 ui_snapshot 确认焦点位置；不要在密码框中输入敏感信息。text 最长 4000 字符。',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: '要输入的文字' } },
        required: ['text'],
        additionalProperties: false
      },
      summarize: (args) => `输入文字（${stringArg(args, 'text').length} 字符）`,
      execute: async (args) => {
        const text = stringArg(args, 'text', { required: true, max: 4_000 })
        if (!text) throw new ToolError('text 不能为空')
        const encoded = Buffer.from(text, 'utf8').toString('base64')
        await runPowerShell('desktop-keyboard', KEYBOARD_SCRIPT, ['-Action', 'type', '-EncodedText', encoded], 20_000)
        uiCache = null
        return { output: `已输入 ${text.length} 个字符` }
      }
    },
    {
      name: 'keyboard_press',
      displayName: '按下按键',
      risk: 'exec',
      description:
        '按下按键或组合键。示例：ENTER、TAB、ESC、CTRL+S、CTRL+SHIFT+ESC、ALT+TAB、F5。用于提交、切换窗口、保存等操作。',
      inputSchema: {
        type: 'object',
        properties: { keys: { type: 'string', description: '按键或组合键，例如 CTRL+S' } },
        required: ['keys'],
        additionalProperties: false
      },
      summarize: (args) => `按键 ${stringArg(args, 'keys').slice(0, 60) || '?'}`,
      execute: async (args) => {
        const keys = stringArg(args, 'keys', { required: true, max: 200 }).trim()
        if (!keys) throw new ToolError('keys 不能为空')
        await runPowerShell('desktop-keyboard', KEYBOARD_SCRIPT, ['-Action', 'press', '-Keys', keys], 12_000)
        uiCache = null
        return { output: `已按键 ${keys}` }
      }
    }
  ]
}
