import { execFile } from 'node:child_process'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type { BrowserWindow } from 'electron'
import { capturePrimaryScreen } from '../../screenshot'
import { ocrImage } from '../../attachments/ocr'
import type { ToolDefinition } from './types'
import { ToolError, numberArg, stringArg, truncate } from './types'

const run = promisify(execFile)

const MOUSE_SCRIPT = String.raw`param(
  [string]$Action,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$X2 = 0,
  [int]$Y2 = 0,
  [string]$Button = 'left',
  [int]$Clicks = 1,
  [int]$Amount = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class HqMouse
{
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

    const uint LEFTDOWN = 0x0002;
    const uint LEFTUP = 0x0004;
    const uint RIGHTDOWN = 0x0008;
    const uint RIGHTUP = 0x0010;
    const uint MIDDLEDOWN = 0x0020;
    const uint MIDDLEUP = 0x0040;
    const uint WHEEL = 0x0800;

    static HqMouse() { try { SetProcessDPIAware(); } catch { } }

    static void Move(int x, int y)
    {
        if (!SetCursorPos(x, y)) throw new InvalidOperationException("SetCursorPos failed");
    }

    public static void Click(int x, int y, string button, int clicks)
    {
        Move(x, y);
        uint down = LEFTDOWN, up = LEFTUP;
        if (string.Equals(button, "right", StringComparison.OrdinalIgnoreCase)) { down = RIGHTDOWN; up = RIGHTUP; }
        else if (string.Equals(button, "middle", StringComparison.OrdinalIgnoreCase)) { down = MIDDLEDOWN; up = MIDDLEUP; }
        for (int i = 0; i < clicks; i++)
        {
            mouse_event(down, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(20);
            mouse_event(up, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(60);
        }
    }

    public static void Drag(int x1, int y1, int x2, int y2)
    {
        Move(x1, y1);
        mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        for (int i = 1; i <= 24; i++)
        {
            int x = x1 + (x2 - x1) * i / 24;
            int y = y1 + (y2 - y1) * i / 24;
            SetCursorPos(x, y);
            Thread.Sleep(12);
        }
        mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero);
    }

    public static void Wheel(int amount)
    {
        mouse_event(WHEEL, 0, 0, amount * 120, UIntPtr.Zero);
    }
}
'@

switch ($Action.ToLowerInvariant()) {
  'move' {
    [HqMouse]::Click($X, $Y, 'none', 0)
  }
  'click' {
    [HqMouse]::Click($X, $Y, $Button, [Math]::Max(1, [Math]::Min(3, $Clicks)))
  }
  'drag' {
    [HqMouse]::Drag($X, $Y, $X2, $Y2)
  }
  'scroll' {
    if ($X -ne 0 -or $Y -ne 0) { [HqMouse]::Click($X, $Y, 'none', 0) }
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

    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;

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
  for ($i = 0; $i -lt $parts.Length - 1; $i++) {
    switch ($parts[$i].Trim().ToUpperInvariant()) {
      'CTRL' { $mods += '^' }
      'CONTROL' { $mods += '^' }
      'ALT' { $mods += '%' }
      'SHIFT' { $mods += '+' }
      default { throw "unsupported modifier: $($parts[$i])" }
    }
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

const UI_SCRIPT = String.raw`param([int]$Max = 80)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HqDesktopInfo
{
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int max);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
}
'@
try { [HqDesktopInfo]::SetProcessDPIAware() | Out-Null } catch { }

$fg = [HqDesktopInfo]::GetForegroundWindow()
$fgTitle = New-Object System.Text.StringBuilder 512
[HqDesktopInfo]::GetWindowText($fg, $fgTitle, 512) | Out-Null

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
    $rect = Get-Rect $window
    if ($null -eq $rect) { continue }
    $windowName = $window.Current.Name
    $handle = $window.Current.NativeWindowHandle
    $items += [pscustomobject]@{
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
        $aid = $child.Current.AutomationId
        if ([string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace($aid)) { continue }
        $crect = Get-Rect $child
        if ($null -eq $crect) { continue }
        $items += [pscustomobject]@{
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
  screenWidth = [HqDesktopInfo]::GetSystemMetrics(0)
  screenHeight = [HqDesktopInfo]::GetSystemMetrics(1)
  foregroundWindow = $fgTitle.ToString()
  items = @($items)
} | ConvertTo-Json -Depth 6 -Compress
`

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

function mouseArgs(action: string, args: Record<string, unknown>): string[] {
  return [
    '-Action', action,
    '-X', String(numberArg(args, 'x', 0, -100_000, 100_000)),
    '-Y', String(numberArg(args, 'y', 0, -100_000, 100_000)),
    '-X2', String(numberArg(args, 'to_x', 0, -100_000, 100_000)),
    '-Y2', String(numberArg(args, 'to_y', 0, -100_000, 100_000)),
    '-Button', stringArg(args, 'button', { fallback: 'left' }).toLowerCase(),
    '-Clicks', String(numberArg(args, 'clicks', 1, 1, 3)),
    '-Amount', String(numberArg(args, 'amount', 0, -20, 20))
  ]
}

export function createDesktopTools(
  getWindow: () => BrowserWindow | null
): ToolDefinition[] {
  return [
    {
      name: 'ui_snapshot',
      displayName: '识别界面',
      risk: 'read',
      description:
        '读取当前桌面的前台窗口和可见控件，返回控件类型、名称、AutomationId、屏幕坐标（物理像素）和大小。点击或输入前先用它确认目标；操作后应重新读取以验证结果。参数 max_items：最多返回多少个条目，默认 80。',
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
        const output = await runPowerShell('ui-snapshot', UI_SCRIPT, ['-Max', String(max)], 25_000)
        return { output: output || '{"items":[]}' }
      }
    },
    {
      name: 'screen_ocr',
      displayName: '读取屏幕文字',
      risk: 'read',
      description:
        '截取主屏幕并用 Windows 本地 OCR 识别文字。适用于 UI Automation 读不到的界面（画布、游戏、远程桌面、图片文字）。返回屏幕尺寸和识别出的文本，不保存截图。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      summarize: () => '截取屏幕并识别文字',
      execute: async () => {
        const shot = await capturePrimaryScreen(getWindow)
        if (!shot) throw new ToolError('屏幕截图失败')
        const data = shot.dataUrl.split(',')[1] ?? ''
        const path = join(tmpdir(), `huaqiang-screen-${Date.now()}.png`)
        try {
          await writeFile(path, Buffer.from(data, 'base64'))
          const text = await ocrImage(path)
          return {
            output: truncate(
              `屏幕尺寸：${shot.width}x${shot.height}（缩放 ${shot.scaleFactor}）\n${text || '（未识别到文字）'}`,
              40_000
            )
          }
        } finally {
          await unlink(path).catch(() => undefined)
        }
      }
    },
    {
      name: 'mouse_move',
      displayName: '移动鼠标',
      risk: 'exec',
      description: '把鼠标移动到屏幕坐标 (x, y)。坐标使用 ui_snapshot 返回的物理像素坐标。',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '屏幕 X 坐标' },
          y: { type: 'number', description: '屏幕 Y 坐标' }
        },
        required: ['x', 'y'],
        additionalProperties: false
      },
      summarize: (args) => `移动鼠标到 (${numberArg(args, 'x', 0, -100_000, 100_000)}, ${numberArg(args, 'y', 0, -100_000, 100_000)})`,
      execute: async (args) => {
        await runPowerShell('desktop-mouse', MOUSE_SCRIPT, mouseArgs('move', args), 12_000)
        return { output: '鼠标已移动' }
      }
    },
    {
      name: 'mouse_click',
      displayName: '点击鼠标',
      risk: 'exec',
      description:
        '在屏幕坐标 (x, y) 点击鼠标。button 可选 left/right/middle，clicks 可选 1-3（双击传 2）。点击前先用 ui_snapshot 或 screen_ocr 确认位置。',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '屏幕 X 坐标' },
          y: { type: 'number', description: '屏幕 Y 坐标' },
          button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标按键，默认 left' },
          clicks: { type: 'number', description: '点击次数，1-3，默认 1' }
        },
        required: ['x', 'y'],
        additionalProperties: false
      },
      summarize: (args) => {
        const button = stringArg(args, 'button', { fallback: 'left' })
        const clicks = numberArg(args, 'clicks', 1, 1, 3)
        return `${button === 'right' ? '右键' : button === 'middle' ? '中键' : '左键'}点击 (${numberArg(args, 'x', 0, -100_000, 100_000)}, ${numberArg(args, 'y', 0, -100_000, 100_000)}) ×${clicks}`
      },
      execute: async (args) => {
        await runPowerShell('desktop-mouse', MOUSE_SCRIPT, mouseArgs('click', args), 12_000)
        return { output: '鼠标点击完成' }
      }
    },
    {
      name: 'mouse_drag',
      displayName: '拖拽鼠标',
      risk: 'exec',
      description: '按住鼠标左键从 (x, y) 拖拽到 (to_x, to_y)。用于拖动窗口、滑块或选择文本。',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '起点 X 坐标' },
          y: { type: 'number', description: '起点 Y 坐标' },
          to_x: { type: 'number', description: '终点 X 坐标' },
          to_y: { type: 'number', description: '终点 Y 坐标' }
        },
        required: ['x', 'y', 'to_x', 'to_y'],
        additionalProperties: false
      },
      summarize: (args) => `拖拽 (${numberArg(args, 'x', 0, -100_000, 100_000)}, ${numberArg(args, 'y', 0, -100_000, 100_000)}) → (${numberArg(args, 'to_x', 0, -100_000, 100_000)}, ${numberArg(args, 'to_y', 0, -100_000, 100_000)})`,
      execute: async (args) => {
        await runPowerShell('desktop-mouse', MOUSE_SCRIPT, mouseArgs('drag', args), 15_000)
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
          y: { type: 'number', description: '可选，滚动前移动到的 Y 坐标' }
        },
        required: ['amount'],
        additionalProperties: false
      },
      summarize: (args) => `滚动滚轮 ${numberArg(args, 'amount', 0, -20, 20)} 格`,
      execute: async (args) => {
        if (numberArg(args, 'amount', 0, -20, 20) === 0) throw new ToolError('amount 不能为 0')
        await runPowerShell('desktop-mouse', MOUSE_SCRIPT, mouseArgs('scroll', args), 12_000)
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
        return { output: `已按键 ${keys}` }
      }
    }
  ]
}
