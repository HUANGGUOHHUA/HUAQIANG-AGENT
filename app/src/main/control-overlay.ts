import { app, BrowserWindow, screen } from 'electron'
import { startInputLock, stopInputLock } from './input-lock'

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
  .target {
    position: fixed; display: none; z-index: 8; pointer-events: none;
    border: 2px solid #fbbf24; border-radius: 7px;
    background: rgba(251, 191, 36, .12);
    box-shadow: 0 0 0 3px rgba(251, 191, 36, .18), 0 0 22px rgba(251, 191, 36, .7);
  }
  .target::before {
    content: ""; position: absolute; left: 50%; top: 50%; width: 6px; height: 6px;
    margin: -3px 0 0 -3px; border-radius: 50%; background: #fbbf24;
    box-shadow: 0 0 10px #fbbf24;
  }
  .target-label {
    position: fixed; display: none; z-index: 9; pointer-events: none;
    max-width: 360px; padding: 5px 9px; border-radius: 6px;
    color: #451a03; background: #fde68a; border: 1px solid #f59e0b;
    font: 600 12px/1.3 "Microsoft YaHei", "Segoe UI", sans-serif;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    box-shadow: 0 4px 14px rgba(120, 53, 15, .3);
  }
  @keyframes breathe { 0%, 100% { opacity: .65; } 50% { opacity: 1; } }
</style>
</head>
<body>
  <div class="frame"></div>
  <div class="banner">
    <span class="dot"></span>
    <span>华强以太正在控制 · 鼠标已锁定</span>
    <span class="hint">退出请按</span>
    <span class="key">ESC</span>
  </div>
  <div class="target" id="target"></div>
  <div class="target-label" id="targetLabel"></div>
  <script>
    (() => {
      const box = document.getElementById('target')
      const label = document.getElementById('targetLabel')
      let hideTimer = 0
      window.__hqHighlight = (x, y, width, height, text) => {
        const w = Math.max(12, Number(width) || 24)
        const h = Math.max(12, Number(height) || 24)
        box.style.display = 'block'
        box.style.left = Math.round(x - w / 2) + 'px'
        box.style.top = Math.round(y - h / 2) + 'px'
        box.style.width = Math.round(w) + 'px'
        box.style.height = Math.round(h) + 'px'
        label.textContent = text || ''
        const labelVisible = Boolean(text)
        label.style.display = labelVisible ? 'block' : 'none'
        if (labelVisible) {
          const left = Math.max(8, Math.min(x - 20, window.innerWidth - 380))
          const top = y + h / 2 + 10
          label.style.left = Math.round(left) + 'px'
          label.style.top = Math.round(Math.min(top, window.innerHeight - 44)) + 'px'
        }
        clearTimeout(hideTimer)
        hideTimer = setTimeout(() => {
          box.style.display = 'none'
          label.style.display = 'none'
        }, 1100)
      }
      window.__hqClearHighlight = () => {
        clearTimeout(hideTimer)
        box.style.display = 'none'
        label.style.display = 'none'
      }
    })()
  </script>
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
  // Keep the takeover banner/border out of screenshots and screen recordings.
  overlay.setContentProtection(true)
  overlay.on('closed', () => {
    overlay = null
  })
  return overlay
}

export function showControlOverlay(): void {
  active = true
  suspended = false
  startInputLock(process.pid)
  const win = ensureOverlay()
  win.setBounds(virtualBounds())
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml())}`)
  win.showInactive()
}

export function hideControlOverlay(): void {
  active = false
  suspended = false
  stopInputLock()
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

export interface HighlightTarget {
  x: number
  y: number
  width?: number
  height?: number
  label?: string
}

/** Draw a short-lived box around the exact control/point being operated. */
export function highlightControl(target: HighlightTarget): void {
  if (!active || suspended) return
  if (!overlay || overlay.isDestroyed() || overlay.webContents.isLoading()) return
  const physical = { x: Math.round(target.x), y: Math.round(target.y) }
  let dip = physical
  try {
    dip = screen.screenToDipPoint(physical)
  } catch {
    // Fall back to the physical point on platforms without this helper.
  }
  let scale = 1
  try {
    scale = screen.getDisplayNearestPoint(dip).scaleFactor || 1
  } catch {
    scale = 1
  }
  const bounds = virtualBounds()
  const x = dip.x - bounds.x
  const y = dip.y - bounds.y
  const width = Math.max(12, Math.round((target.width ?? 26) / scale))
  const height = Math.max(12, Math.round((target.height ?? 26) / scale))
  const label = target.label ?? ''
  const script = `window.__hqHighlight && window.__hqHighlight(${x}, ${y}, ${width}, ${height}, ${JSON.stringify(label)})`
  void overlay.webContents.executeJavaScript(script).catch(() => undefined)
}

app.on('before-quit', () => {
  active = false
  suspended = false
  stopInputLock()
  if (overlay && !overlay.isDestroyed()) {
    overlay.destroy()
    overlay = null
  }
})
