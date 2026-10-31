import { desktopCapturer, ipcMain, screen, type BrowserWindow } from 'electron'

interface ScreenshotPayload {
  dataUrl: string
  width: number
  height: number
  scaleFactor: number
}

export function registerScreenshotIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('screenshot:capture', async (): Promise<ScreenshotPayload | null> => {
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
      win.hide()
      await new Promise((resolve) => setTimeout(resolve, 400))
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
        if (!win.isDestroyed()) {
          win.show()
          win.focus()
        }
      }
    } catch {
      return null
    }
  })
}
