import { spawn } from 'node:child_process'

// 通过 Shell.Application 找到目标路径对应的资源管理器窗口，
// 轮询等待窗口出现后将其置为顶层（置顶）并激活。
const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Name W -Namespace U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr h); [DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr a, int x, int y, int cx, int cy, uint f);'
$target = '__TARGET__'
$item = Get-Item -LiteralPath $target
$dir = $target
if ($item -and -not $item.PSIsContainer) { $dir = Split-Path $target }
$shell = New-Object -ComObject Shell.Application
$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 25; $i++) {
  foreach ($w in @($shell.Windows())) {
    try {
      $p = $w.Document.Folder.Self.Path
      if ($p -and ($p.ToLower() -eq $dir.ToLower())) { $hwnd = [IntPtr]$w.HWND }
    } catch { }
  }
  if ($hwnd -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 200
}
if ($hwnd -ne [IntPtr]::Zero) {
  [void][U.W]::SetWindowPos($hwnd, [IntPtr]::new(-1), 0, 0, 0, 0, 0x43)
  [void][U.W]::BringWindowToTop($hwnd)
  [void][U.W]::SetForegroundWindow($hwnd)
}
`

function escapePs(text: string): string {
  return text.replace(/'/g, "''")
}

/** 资源管理器窗口打开后将其置顶并激活。尽力而为：任何失败都不影响打开本身。 */
export function focusExplorerWindow(target: string): void {
  try {
    const script = PS_SCRIPT.replace('__TARGET__', escapePs(target))
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: 'ignore', detached: true }
    )
    child.once('error', () => {})
    child.unref()
  } catch {
    // 忽略：置顶失败不打断打开流程
  }
}
