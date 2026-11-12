import { app, BrowserWindow, Menu, protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { join, normalize, relative } from 'node:path'
import type { AgentEvent } from '../shared/types'
import { mimeFor } from './mime'
import { abortAllRuns, state } from './state'

function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
}

/** `app://bundle/...` 协议：只允许读取打包后的渲染资源，拒绝越界路径。 */
export async function serveRenderer(request: Request): Promise<Response> {
  const rendererRoot = normalize(join(__dirname, '../renderer'))
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname)
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  const relativePath = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '')
  const filePath = normalize(join(rendererRoot, relativePath))
  const relativeToRoot = relative(rendererRoot, filePath)
  if (relativeToRoot.startsWith('..') || relativeToRoot.includes(':')) {
    return new Response('Forbidden', { status: 403 })
  }
  try {
    const data = await readFile(filePath)
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': mimeFor(filePath),
        'Cache-Control': app.isPackaged ? 'public, max-age=3600' : 'no-store'
      }
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

export function sendToWindow(event: AgentEvent): void {
  const win = state.mainWindow
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send('agent:event', event)
  }
}

export function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#f7f3e9',
    title: '华强以太',
    icon: iconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
      webviewTag: true
    }
  })
  state.mainWindow = win

  Menu.setApplicationMenu(null)
  win.removeMenu()

  win.once('ready-to-show', () => {
    win.show()
    win.webContents.setZoomFactor(1)
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('will-attach-webview', (event, webPreferences) => {
    const unsafeNodeIntegration =
      webPreferences.nodeIntegration === true ||
      webPreferences.nodeIntegrationInWorker === true ||
      webPreferences.nodeIntegrationInSubFrames === true
    const hasPreload =
      typeof webPreferences.preload === 'string' && webPreferences.preload.length > 0
    if (unsafeNodeIntegration || hasPreload) {
      event.preventDefault()
      return
    }
    webPreferences.nodeIntegration = false
    delete webPreferences.preload
  })

  const sendWindowState = (maximized: boolean): void => {
    if (!win.isDestroyed()) win.webContents.send('window:state', maximized)
  }
  win.on('maximize', () => sendWindowState(true))
  win.on('unmaximize', () => sendWindowState(false))
  win.webContents.on('did-finish-load', () => sendWindowState(win.isMaximized()))

  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        win.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
  }

  win.on('closed', () => {
    abortAllRuns()
    state.mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl && /^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(devUrl)) {
    void win.loadURL(devUrl)
  } else {
    void win.loadURL('app://bundle/index.html')
  }

  attachScreenshotHarness(win)
}

/** 打包/截图脚本用：加载完成后按需打开设置页并截图，然后退出。 */
function attachScreenshotHarness(win: BrowserWindow): void {
  const screenshotPath = process.env.HQ_SCREENSHOT_PATH
  if (!screenshotPath) return
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        if (process.env.HQ_SCREENSHOT_ACTION === 'settings') {
          await win.webContents.executeJavaScript(
            'document.querySelector(\'[data-testid="open-settings"]\')?.click()'
          )
          await new Promise((resolve) => setTimeout(resolve, 900))
        }
        const image = await win.webContents.capturePage()
        if (image) writeFileSync(screenshotPath, image.toPNG())
        console.log('Screenshot written:', screenshotPath)
      } catch (error) {
        console.error('Screenshot failed:', error)
      } finally {
        app.quit()
      }
    }, 3000)
  })
}

export function registerAppProtocol(): void {
  protocol.handle('app', serveRenderer)
}
