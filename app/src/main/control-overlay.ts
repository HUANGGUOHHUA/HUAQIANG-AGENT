import { app, BrowserWindow, screen } from 'electron'

let overlay: BrowserWindow | null = null
let active = false
let suspended = false

function virtualBounds(): { x: number; y: number; width: number; height: number } {
  const displays = screen.getAllDisplays()
  if (!displays.length) return { x: 0, y: 0, width: 1, height: 1 }
  let left = displays[0].bounds.x
  let top = displays[0].bounds.y
  let right = left + displays[0].bounds.width
  let bottom = top + displays[0].bounds.height
  for (const display of displays.slice(1)) {
    left = Math.min(left, display.bounds.x)
    top = Math.min(top, display.bounds.y)
    right = Math.max(right, display.bounds.x + display.bounds.width)
    bottom = Math.max(bottom, display.bounds.y + display.bounds.height)
  }
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

function overlayHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
  .frame {
    position: fixed; inset: 6px; border-radius: 18px;
    border: 3px solid rgba(56, 189, 248, .95);
    box-shadow: 0 0 0 1px rgba(14, 165, 233, .45), 0 0 28px rgba(56, 189, 248, .75), inset 0 0 34px rgba(56, 189, 248, .18);
    animation: breathe 2.2s ease-in-out infinite;
  }
  .banner {
    position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 10px;
    padding: 9px 16px; border-radius: 999px;
    color: #e0f2fe; background: rgba(8, 47, 73, .88);
    border: 1px solid rgba(125, 211, 252, .65);
    box-shadow: 0 8px 28px rgba(2, 132, 199, .35);
    font: 600 13px/1.2 "Microsoft YaHei", "Segoe UI", sans-serif;
    letter-spacing: .02em; white-space: nowrap;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #38bdf8; box-shadow: 0 0 10px #38bdf8; }
  .key { padding: 2px 7px; border-radius: 5px; border: 1px solid rgba(186, 230, 253, .55); font-size: 11px; color: #bae6fd; }
  .hint { font-weight: 400; color: rgba(224, 242, 254, .72); font-size: 12px; }
  @keyframes breathe { 0%, 100% { opacity: .65; } 50% { opacity: 1; } }
</style>
</head>
<body>
  <div class="frame"></div>
  <div class="banner">
    <span class="dot"></span>
    <span>华强以太正在控制屏幕和鼠标</span>
    <span class="hint">退出请按</span>
    <span class="key">ESC</span>
  </div>
</body>
</html>`
}

function ensureOverlay(): BrowserWindow {
  if (overlay && !overlay.isDestroyed()) return overlay
  overlay = new BrowserWindow({
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  overlay.setIgnoreMouseEvents(true, { forward: true })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.on('closed', () => {
    overlay = null
  })
  return overlay
}

export function showControlOverlay(): void {
  active = true
  suspended = false
  const win = ensureOverlay()
  win.setBounds(virtualBounds())
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml())}`)
  win.showInactive()
}

export function hideControlOverlay(): void {
  active = false
  suspended = false
  if (overlay && !overlay.isDestroyed()) {
    overlay.hide()
  }
}

export function suspendControlOverlay(): void {
  if (!active) return
  suspended = true
  if (overlay && !overlay.isDestroyed()) overlay.hide()
}

export function resumeControlOverlay(): void {
  if (!active || !suspended) return
  suspended = false
  if (overlay && !overlay.isDestroyed()) {
    overlay.setBounds(virtualBounds())
    overlay.showInactive()
  }
}

export function isControlOverlayActive(): boolean {
  return active
}

app.on('before-quit', () => {
  active = false
  suspended = false
  if (overlay && !overlay.isDestroyed()) {
    overlay.destroy()
    overlay = null
  }
})
