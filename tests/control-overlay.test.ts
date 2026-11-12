import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const displays = [
    { id: 1, label: '主屏', bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
  ]
  const handlers: Record<string, () => void> = {}
  const executeJavaScript = vi.fn().mockResolvedValue(undefined)
  const overlay = {
    isDestroyed: () => false,
    webContents: {
      isLoading: () => false,
      once: (event: string, callback: () => void) => {
        handlers[event] = callback
      },
      executeJavaScript
    },
    setIgnoreMouseEvents: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setContentProtection: vi.fn(),
    on: vi.fn(),
    setBounds: vi.fn(),
    loadURL: vi.fn().mockResolvedValue(undefined),
    showInactive: vi.fn(),
    hide: vi.fn()
  }
  return { handlers, executeJavaScript, overlay, displays }
})

vi.mock('electron', () => ({
  app: { on: vi.fn() },
  BrowserWindow: vi.fn(() => mocks.overlay),
  screen: {
    getAllDisplays: () => mocks.displays,
    getPrimaryDisplay: () => mocks.displays[0],
    screenToDipPoint: (point: unknown) => point,
    getDisplayNearestPoint: () => ({ scaleFactor: 1 })
  }
}))

vi.mock('../app/src/main/input-lock', () => ({
  startInputLock: vi.fn(),
  stopInputLock: vi.fn()
}))

import {
  hideControlOverlay,
  showControlOverlay,
  updateControlOverlayStatus
} from '../app/src/main/control-overlay'

describe('control overlay HUD', () => {
  it('shows the current model action with throttled updates', async () => {
    vi.useFakeTimers()
    try {
      showControlOverlay()
      mocks.handlers['did-finish-load']?.()
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.executeJavaScript).toHaveBeenCalled()
      expect(String(mocks.executeJavaScript.mock.calls.at(-1)?.[0])).toContain('正在等待模型')

      updateControlOverlayStatus('正在执行：点击「发送」')
      updateControlOverlayStatus('思考：先找发送按钮，再点击')
      await vi.advanceTimersByTimeAsync(300)

      const latest = String(mocks.executeJavaScript.mock.calls.at(-1)?.[0])
      expect(latest).toContain('思考：先找发送按钮')
      expect(latest).not.toContain('正在执行')
    } finally {
      hideControlOverlay()
      vi.useRealTimers()
    }
  })

  it('draws one frame and one hub per monitor', () => {
    mocks.displays.length = 0
    mocks.displays.push(
      { id: 1, label: '主屏', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 2, label: '副屏', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
    )
    mocks.overlay.loadURL.mockClear()
    try {
      showControlOverlay()
      const url = String(mocks.overlay.loadURL.mock.calls.at(-1)?.[0] ?? '')
      const html = decodeURIComponent(url.slice(url.indexOf(',') + 1))
      expect(html.match(/class="screen-frame"/g)?.length).toBe(2)
      expect(html.match(/class="hub"/g)?.length).toBe(2)
      expect(html).toContain('left:1926px')
      expect(html).toContain('副屏')
    } finally {
      hideControlOverlay()
      mocks.displays.length = 0
      mocks.displays.push({
        id: 1,
        label: '主屏',
        bounds: { x: 0, y: 0, width: 1920, height: 1080 }
      })
    }
  })
})