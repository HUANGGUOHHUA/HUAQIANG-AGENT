import { app, BrowserWindow, screen } from 'electron'
import { startInputLock, stopInputLock } from './input-lock'

let overlay: BrowserWindow | null = null
let active = false
let suspended = false
let released = false
let pendingStatus = '正在等待模型…'
let statusTimer: ReturnType<typeof setTimeout> | null = null

function flushStatus(): void {
  if (!overlay || overlay.isDestroyed() || overlay.webContents.isLoading()) return
  const script = `window.__hqStatus && window.__hqStatus(${JSON.stringify(pendingStatus)})`
  void overlay.webContents.executeJavaScript(script).catch(() => undefined)
}

/** 更新控制浮层里显示的“大模型当前在做什么”。 */
export function updateControlOverlayStatus(text: string): void {
  if (!active || released) return
  pendingStatus = text.trim().slice(0, 1000) || '正在等待模型…'
  if (statusTimer) return
  statusTimer = setTimeout(() => {
    statusTimer = null
    if (suspended) return
    flushStatus()
  }, 250)
}

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

interface OverlayScreen {
  left: number
  top: number
  width: number
  height: number
  label: string
}

function overlayLayout(): {
  bounds: { x: number; y: number; width: number; height: number }
  screens: OverlayScreen[]
} {
  const bounds = virtualBounds()
  let primaryId: number | undefined
  try {
    primaryId = screen.getPrimaryDisplay().id
  } catch {
    primaryId = undefined
  }
  const screens = screen.getAllDisplays().map((display, index) => ({
    left: display.bounds.x - bounds.x,
    top: display.bounds.y - bounds.y,
    width: Math.max(1, display.bounds.width),
    height: Math.max(1, display.bounds.height),
    label:
      (display.label && display.label.trim()) ||
      (display.id === primaryId ? '主屏' : `屏幕 ${index + 1}`)
  }))
  return { bounds, screens }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

function overlayHtml(screens: OverlayScreen[]): string {
  const screenLayers = screens
    .map((item) => {
      const frameWidth = Math.max(1, item.width - 12)
      const frameHeight = Math.max(1, item.height - 12)
      const hubWidth = Math.max(220, Math.min(420, item.width - 32))
      return `
  <div class="screen-frame" style="left:${item.left + 6}px;top:${item.top + 6}px;width:${frameWidth}px;height:${frameHeight}px"></div>
  <div class="hub" style="left:${item.left + 16}px;top:${item.top + 16}px;width:${hubWidth}px">
    <div class="hub-head">
      <span class="dot"></span>
      <span class="hub-title">正在控制</span>
      <span class="hub-screen">${escapeHtml(item.label)}</span>
      <span class="hint">退出</span>
      <span class="key">ESC</span>
    </div>
    <div class="hub-status">正在等待模型…</div>
  </div>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
  .screen-frame {
    position: fixed; border-radius: 16px;
    border: 2px solid rgba(56, 189, 248, .95);
    box-shadow: 0 0 0 1px rgba(14, 165, 233, .45), 0 0 22px rgba(56, 189, 248, .65), inset 0 0 24px rgba(56, 189, 248, .14);
    animation: breathe 2.2s ease-in-out infinite;
    pointer-events: none;
  }
  .hub {
    position: fixed; z-index: 6;
    display: flex; flex-direction: column; gap: 4px;
    padding: 9px 12px; border-radius: 12px;
    color: #e0f2fe; background: rgba(8, 47, 73, .84);
    border: 1px solid rgba(125, 211, 252, .55);
    box-shadow: 0 6px 20px rgba(2, 132, 199, .3);
    font: 600 12px/1.25 "Microsoft YaHei", "Segoe UI", sans-serif;
    letter-spacing: .02em; white-space: normal;
    pointer-events: none;
  }
  .hub-head { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
  .hub-title { font-weight: 600; }
  .hub-screen { font-weight: 400; font-size: 11px; color: #7dd3fc; }
  .hub-status {
    font-weight: 400; font-size: 11px; line-height: 1.4;
    color: rgba(224, 242, 254, .92);
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    overflow: hidden; word-break: break-word; white-space: pre-line;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #38bdf8; box-shadow: 0 0 10px #38bdf8; flex: none; }
  .key { padding: 2px 7px; border-radius: 5px; border: 1px solid rgba(186, 230, 253, .55); font-size: 11px; color: #bae6fd; }
  .hint { font-weight: 400; color: rgba(224, 242, 254, .72); font-size: 11px; }
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
  @keyframes breathe { 0%, 100% { opacity: .62; } 50% { opacity: 1; } }
</style>
</head>
<body>
${screenLayers}
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
      const statuses = Array.from(document.querySelectorAll('.hub-status'))
      window.__hqStatus = (text) => {
        const value = text || '正在等待模型…'
        for (const node of statuses) node.textContent = value
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
  released = false
  pendingStatus = '正在等待模型…'
  startInputLock(process.pid)
  const layout = overlayLayout()
  const win = ensureOverlay()
  win.setBounds(layout.bounds)
  win.webContents.once('did-finish-load', () => flushStatus())
  void win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml(layout.screens))}`
  )
  win.showInactive()
}

export function hideControlOverlay(): void {
  active = false
  suspended = false
  released = false
  if (statusTimer) {
    clearTimeout(statusTimer)
    statusTimer = null
  }
  pendingStatus = '正在等待模型…'
  stopInputLock()
  if (overlay && !overlay.isDestroyed()) {
    overlay.hide()
  }
}

export function suspendControlOverlay(): void {
  if (!active || released) return
  suspended = true
  if (overlay && !overlay.isDestroyed()) overlay.hide()
}

export function resumeControlOverlay(): void {
  if (!active || !suspended || released) return
  suspended = false
  if (overlay && !overlay.isDestroyed()) {
    overlay.setBounds(virtualBounds())
    overlay.showInactive()
  }
  flushStatus()
}

/**
 * Release the desktop takeover so the approval UI can be clicked.
 * Unlike suspend(), this also removes the low-level mouse lock.
 */
export function releaseControlOverlay(): void {
  if (!active) return
  released = true
  suspended = false
  stopInputLock()
  if (overlay && !overlay.isDestroyed()) overlay.hide()
}

/** Restore the takeover after the approval dialog has been answered. */
export function restoreControlOverlay(): void {
  if (!active || !released) return
  released = false
  if (overlay && !overlay.isDestroyed()) {
    overlay.setBounds(virtualBounds())
    overlay.showInactive()
  }
  startInputLock(process.pid)
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
  if (!active || suspended || released) return
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
