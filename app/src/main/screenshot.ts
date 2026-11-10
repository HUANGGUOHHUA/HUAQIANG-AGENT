import { desktopCapturer, ipcMain, screen, type BrowserWindow } from 'electron'
import { handleTrusted } from './ipc/trust'

export interface ScreenshotPayload {
  dataUrl: string
  width: number
  height: number
  scaleFactor: number
}

export async function capturePrimaryScreen(
  getWindow: () => BrowserWindow | null
): Promise<ScreenshotPayload | null> {
  try {
    const win = getWindow()
    if (!win || win.isDestroyed()) return null
    const display = screen.getPrimaryDisplay()
    const width = display.size.width
    const height = display.size.height
    const scaleFactor = display.scaleFactor
    const thumbnailSize = {
      width: Math.round(width * scaleFactor),
      height: Math.round(height * scaleFactor)
    }
    const wasVisible = win.isVisible()
    if (wasVisible) win.hide()
    await new Promise((resolve) => setTimeout(resolve, 350))
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize
      })
      const source =
        sources.find((item) => item.display_id === String(display.id)) ??
        sources.find((item) => item.name.includes('Screen')) ??
        sources[0]
      if (!source) return null
      return {
        dataUrl: source.thumbnail.toDataURL(),
        width: source.thumbnail.getSize().width,
        height: source.thumbnail.getSize().height,
        scaleFactor
      }
    } finally {
      if (wasVisible && !win.isDestroyed()) {
        win.showInactive()
      }
    }
  } catch {
    return null
  }
}

export function registerScreenshotIpc(getWindow: () => BrowserWindow | null): void {
  handleTrusted(
    'screenshot:capture',
    async (): Promise<ScreenshotPayload | null> => capturePrimaryScreen(getWindow)
  )
}
