import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  shell
} from 'electron'
import { readFile } from 'node:fs/promises'
import { stat } from 'node:fs/promises'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import type {
  AgentEvent,
  AgentRunRequest,
  AgentRunResult,
  ApprovalDecision,
  AttachmentPayload,
  CompactRequest,
  CompactResult,
  McpServerConfig,
  ProfileTestInput,
  SettingsSaveInput
} from '../shared/types'
import { ApprovalService } from './approval'
import { buildSystemPrompt } from './agent/prompt'
import { runAgent } from './agent/loop'
import { streamModel } from './agent/providers'
import { createFileTools } from './agent/tools/files'
import { prepareAttachmentsForModel } from './agent/vision'
import { runCommandTool } from './agent/tools/shell'
import { systemInfoTool, webFetchTool } from './agent/tools/system'
import type { ToolDefinition } from './agent/tools/types'
import { extractPdfText } from './attachments/pdf'
import { ocrImage } from './attachments/ocr'
import { McpManager } from './mcp'
import { BuiltinMcpService } from './mcp-builtin'
import { BrowserBridge } from './browser-bridge'
import { setToolTempBase } from './child-env'
import { AgentWorkerBridge } from './worker-bridge'
import { createBrowserTools, createAppControlTool } from './agent/tools/browser'
import { registerScreenshotIpc } from './screenshot'
import { testProfileConnection, listProfileModels } from './profile-test'
import { SessionStore } from './sessions'
import { SettingsStore } from './settings'
import { PythonEnvironment } from './python-env'
import { WorkspaceService } from './workspace'
import { diffWorkspace, snapshotWorkspace } from './workspace-changes'

app.setName('华强以太')
app.setAppUserModelId('cn.edu.szft.hqzx.agent')

if (!app.isPackaged) {
  // Keep development data inside the project and use the same compatibility
  // flags as the packaged shortcut on this machine. HQ_DEV_PROFILE lets a
  // second instance run beside the user's window for local testing.
  const devProfile = process.env.HQ_DEV_PROFILE
    ? resolve(process.env.HQ_DEV_PROFILE)
    : join(app.getAppPath(), '.dev-profile')
  mkdirSync(devProfile, { recursive: true })
  app.setPath('userData', devProfile)
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
}

protocol.registerSchemesAsPrivileged([
  {    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

// A UAC relaunch starts the new instance before the old one exits; retry the
// single-instance lock briefly instead of quitting silently.
function acquireSingleInstanceLock(): boolean {
  if (app.requestSingleInstanceLock()) return true
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    } catch {
      const until = Date.now() + 250
      while (Date.now() < until) {
        // Fallback busy wait.
      }
    }
    if (app.requestSingleInstanceLock()) return true
  }
  return false
}

// Signal aliveness before waiting for the lock: the instance that requested the
// elevation is waiting on this marker while still holding the lock itself.
markReady()
const gotLock = acquireSingleInstanceLock()
elevationLog(
  `start argv=${JSON.stringify(process.argv.slice(1))} elevated=${isElevated()} lock=${gotLock} marker=${hadRecentElevationAttempt()}`
)
if (!gotLock) {
  try {
    dialog.showMessageBoxSync({
      type: 'info',
      title: '华强以太已在运行',
      message: '已有一个实例正在运行（可能正在以管理员身份重启）。',
      buttons: ['知道了'],
      noLink: true
    })
  } catch {
    // Dialog may not be ready on some systems; quitting is still correct.
  }
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } else {
      // The primary instance lost its window (e.g. renderer crash); reopen one
      // instead of leaving the user with a locked, invisible app.
      createWindow()
    }
  })

  app.whenReady().then(bootstrap).catch((error) => {
    console.error('Failed to start:', error)
    dialog.showErrorBox('华强以太启动失败', error instanceof Error ? error.message : String(error))
    app.quit()
  })
}

let mainWindow: BrowserWindow | null = null
let settingsStore: SettingsStore
let sessionStore: SessionStore
let workspaceService: WorkspaceService
let mcpManager: McpManager
let pythonEnv: PythonEnvironment
let builtinMcp: BuiltinMcpService | null = null
let approvalService: ApprovalService
let browserBridge: BrowserBridge
let appBridge: BrowserBridge
let agentWorker: AgentWorkerBridge | null = null
const activeRuns = new Map<string, { controller: AbortController; sessionId: string }>()

function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8'
}

async function readPickedAttachment(filePath: string): Promise<AttachmentPayload> {
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error('不是文件')
  if (info.size > 20 * 1024 * 1024) throw new Error('文件超过 20MB 限制')
  const ext = extname(filePath).toLowerCase()
  const mime = MIME_TYPES[ext]?.split(';')[0] ?? 'application/octet-stream'
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(filePath)) {
    const buffer = await readFile(filePath)
    const ocrText = await ocrImage(filePath).catch(() => '')
    return {
      path: filePath,
      kind: 'image',
      mime,
      size: info.size,
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
      ocrText: ocrText || undefined
    }
  }
  if (ext === '.pdf') {
    const buffer = await readFile(filePath)
    const text = extractPdfText(buffer)
    return text.trim()
      ? {
          path: filePath,
          kind: 'text',
          mime: 'application/pdf',
          size: info.size,
          content: `--- PDF 提取文本：${filePath} ---\n${text.slice(0, 120_000)}`
        }
      : { path: filePath, kind: 'binary', mime: 'application/pdf', size: info.size }
  }
  const buffer = await readFile(filePath)
  if (buffer.subarray(0, 8_000).includes(0)) {
    return { path: filePath, kind: 'binary', mime, size: info.size }
  }
  return {
    path: filePath,
    kind: 'text',
    mime,
    size: info.size,
    content: buffer.toString('utf8').slice(0, 120_000)
  }
}

async function serveRenderer(request: Request): Promise<Response> {
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
        'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': app.isPackaged ? 'public, max-age=3600' : 'no-store'
      }
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

function sendToWindow(event: AgentEvent): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('agent:event', event)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
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

  Menu.setApplicationMenu(null)
  mainWindow.removeMenu()

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.webContents.setZoomFactor(1)
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences) => {
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:state', maximized)
    }
  }
  mainWindow.on('maximize', () => sendWindowState(true))
  mainWindow.on('unmaximize', () => sendWindowState(false))
  mainWindow.webContents.on('did-finish-load', () => sendWindowState(mainWindow?.isMaximized() ?? false))

  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        mainWindow?.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
  }

  mainWindow.on('closed', () => {
    for (const [runId, run] of activeRuns) {
      run.controller.abort()
      approvalService?.cancelRun(runId)
    }
    mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl && /^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(devUrl)) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadURL('app://bundle/index.html')
  }

  const screenshotPath = process.env.HQ_SCREENSHOT_PATH
  if (screenshotPath) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (process.env.HQ_SCREENSHOT_ACTION === 'settings') {
            await mainWindow?.webContents.executeJavaScript(
              'document.querySelector(\'[data-testid="open-settings"]\')?.click()'
            )
            await new Promise((resolve) => setTimeout(resolve, 900))
          }
          const image = await mainWindow?.webContents.capturePage()
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
}

function registerIpc(): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    dataDir: app.getPath('userData'),
    elevated: isElevated()
  }))

  ipcMain.handle('settings:get', () => settingsStore.getPublic())

  ipcMain.handle('settings:save', (_event, input: SettingsSaveInput) => {
    const settings = settingsStore.save(input)
    void mcpManager.sync(settingsStore.getRaw().mcpServers)
    return settings
  })

  ipcMain.handle('workspace:choose', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择工作区文件夹',
      defaultPath: settingsStore.getRaw().workspace,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('profile:test', async (_event, input: ProfileTestInput) => {
    if (!input?.profile) return { ok: false, message: '配置为空' }
    let apiKey = ''
    if (input.apiKey === undefined) {
      apiKey = settingsStore.getProfileById(input.profile.id)?.apiKey ?? ''
    } else {
      apiKey = input.apiKey ?? ''
    }
    return testProfileConnection(input.profile, apiKey)
  })

  ipcMain.handle('profile:models', async (_event, input: ProfileTestInput) => {
    if (!input?.profile) return { ok: false, message: '配置为空' }
    let apiKey = ''
    if (input.apiKey === undefined) {
      apiKey = settingsStore.getProfileById(input.profile.id)?.apiKey ?? ''
    } else {
      apiKey = input.apiKey ?? ''
    }
    return listProfileModels(input.profile, apiKey)
  })

  ipcMain.handle('sessions:list', () => sessionStore.list())
  ipcMain.handle('sessions:load', (_event, id: string) => sessionStore.load(id))
  ipcMain.handle('sessions:save', (_event, session) => sessionStore.save(session))
  ipcMain.handle('sessions:delete', (_event, id: string) => sessionStore.remove(id))

  ipcMain.handle('workspace:list', (_event, path?: string) => workspaceService.list(path))
  ipcMain.handle('workspace:read', (_event, path: string) => workspaceService.read(path))
  ipcMain.handle('workspace:readAsset', (_event, path: string) => workspaceService.readAsset(path))
  ipcMain.handle('workspace:extract', (_event, path: string) => workspaceService.extract(path))
  ipcMain.handle('workspace:ocr', (_event, path: string) => workspaceService.ocr(path))
  ipcMain.handle('python:status', () => pythonEnv.refresh())
  ipcMain.handle('python:setup', () => pythonEnv.setup())
  ipcMain.handle('attachments:pick', async (): Promise<AttachmentPayload[]> => {
    const options: Parameters<typeof dialog.showOpenDialog>[0] = {
      title: '选择要附加的文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '常用文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'pdf', 'txt', 'md', 'json', 'ts', 'tsx', 'js', 'jsx', 'html', 'css', 'py', 'java', 'cs'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    const attachments: AttachmentPayload[] = []
    for (const filePath of result.filePaths.slice(0, 8)) {
      try {
        attachments.push(await readPickedAttachment(filePath))
      } catch (error) {
        console.error('Failed to read picked attachment:', error)
      }
    }
    return attachments
  })

  // Files dropped from Explorer (any directory). Each read is bounded by
  // `readPickedAttachment` (20MB cap, text/PDF truncation), batches are capped
  // at 8, and nothing is cached in the main process afterwards.
  ipcMain.handle('attachments:readPaths', async (_event, paths: unknown) => {
    if (!Array.isArray(paths)) return { attachments: [], errors: ['参数不正确'] }
    const attachments: AttachmentPayload[] = []
    const errors: string[] = []
    const unique = [
      ...new Set(
        paths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      )
    ].slice(0, 8)
    const MAX_BATCH_BYTES = 48 * 1024 * 1024
    let totalBytes = 0
    for (const raw of unique) {
      try {
        const target = raw.trim()
        if (!isAbsolute(target)) throw new Error('路径必须是绝对路径')
        const info = await stat(target)
        if (!info.isFile()) throw new Error('不是文件')
        if (totalBytes + info.size > MAX_BATCH_BYTES) {
          throw new Error('本次拖入的文件总量超过 48MB')
        }
        totalBytes += info.size
        attachments.push(await readPickedAttachment(target))
      } catch (error) {
        errors.push(`${raw}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return { attachments, errors }
  })
  ipcMain.handle('workspace:write', (_event, path: string, content: string) =>
    workspaceService.write(path, content)
  )
  ipcMain.handle('workspace:reveal', async (_event, path?: string) => {
    elevationLog(`reveal: ${String(path)}`)
    // 主进程可能被安全软件限制拉起资源管理器，优先交给辅助进程执行。
    if (agentWorker?.ready) {
      try {
        const absolute = await workspaceService.absolutePath(path)
        const result = await agentWorker.executeBuiltin('system_reveal', { path: absolute })
        if (!result.isError) {
          elevationLog(`reveal ok via worker: ${absolute}`)
          return
        }
        elevationLog(`reveal worker error: ${result.output}`)
      } catch (error) {
        elevationLog(`reveal worker failed: ${String(error)}`)
      }
    }
    try {
      await workspaceService.reveal(path)
      elevationLog(`reveal ok: ${String(path)}`)
    } catch (error) {
      elevationLog(`reveal failed: ${String(path)}: ${String(error)}`)
      throw error
    }
  })
  ipcMain.handle('workspace:openWith', async (_event, path?: string) => {
    elevationLog(`openWith: ${String(path)}`)
    try {
      await workspaceService.openWith(path)
      elevationLog(`openWith spawned: ${String(path)}`)
    } catch (error) {
      elevationLog(`openWith failed: ${String(path)}: ${String(error)}`)
      throw error
    }
  })
  ipcMain.handle('workspace:openOffice', async (_event, path?: string) => {
    elevationLog(`openOffice: ${String(path)}`)
    try {
      await workspaceService.openOffice(path)
      elevationLog(`openOffice spawned: ${String(path)}`)
    } catch (error) {
      elevationLog(`openOffice failed: ${String(path)}: ${String(error)}`)
      throw error
    }
  })

  ipcMain.handle('workspace:open', async (_event, path?: string) => {
    try {
      await workspaceService.open(path)
      elevationLog(`workspace open ok: ${String(path)}`)
    } catch (error) {
      elevationLog(`workspace open failed: ${String(path)}: ${String(error)}`)
      throw error
    }
  })

  ipcMain.handle('mcp:statuses', () => mcpManager.statuses())
  ipcMain.handle('mcp:restart', () => mcpManager.sync(settingsStore.getRaw().mcpServers))
  ipcMain.handle('mcp:test', (_event, config: McpServerConfig) => mcpManager.test(config))

  ipcMain.handle('app:openExternal', async (_event, url: string) => {
    if (typeof url !== 'string') return
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
      await shell.openExternal(parsed.toString())
    } catch {
      // Ignore invalid URLs.
    }
  })

  ipcMain.handle('app:openDataFolder', async () => {
    await shell.openPath(app.getPath('userData'))
  })

  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('window:toggleMaximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('window:isMaximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })
  ipcMain.handle('window:setZoom', (event, factor: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return 1
    const clamped = Math.max(0.8, Math.min(2, Math.round((Number(factor) || 1) * 100) / 100))
    win.webContents.setZoomFactor(clamped)
    return win.webContents.getZoomFactor()
  })
  ipcMain.handle('window:getZoom', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.webContents.getZoomFactor() ?? 1
  })
  ipcMain.handle('window:setFullscreen', (event, value: boolean) => {
    BrowserWindow.fromWebContents(event.sender)?.setFullScreen(Boolean(value))
  })

  ipcMain.handle('app:elevate', async () => {
    if (isElevated()) return false
    clearReadyMarker()
    const started = relaunchElevated()
    if (!started) return false
    // Wait for the new instance to claim the single-instance lock. Only then
    // quit, so a failed relaunch never leaves the user with nothing.
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (existsSync(readyMarker())) {
        clearReadyMarker()
        setTimeout(() => app.quit(), 150)
        return true
      }
    }
    elevationLog('relaunch handshake timed out; keeping current instance')
    dialog.showMessageBoxSync({
      type: 'warning',
      title: '提权重启失败',
      message: '新的管理员实例没有启动成功',
      detail:
        '可能是 UAC 被拒绝、被安全软件阻止，或新实例启动后立即退出。\n' +
        '当前窗口会继续以普通权限运行；可以改用非系统盘工作区，或把程序加入安全软件信任区。',
      buttons: ['知道了'],
      noLink: true
    })
    return false
  })

  registerScreenshotIpc(() => mainWindow)

  ipcMain.handle(
    'agent:compact',
    async (_event, input: CompactRequest): Promise<CompactResult> => {
      if (!input || !Array.isArray(input.messages)) {
        return { ok: false, error: '请求格式不正确' }
      }
      if (activeRuns.size > 0) {
        return { ok: false, error: '当前有任务正在运行，请稍后再压缩' }
      }
      const messages = input.messages
        .filter(
          (message) =>
            message &&
            typeof message === 'object' &&
            (message.role === 'user' || message.role === 'assistant') &&
            typeof message.content === 'string'
        )
        .slice(-40)
        .map((message) => ({
          ...message,
          content: message.content.slice(0, 3_000),
          reasoning: undefined,
          toolCalls: message.toolCalls?.slice(0, 12).map((call) => ({
            ...call,
            args: call.args,
            result: typeof call.result === 'string' ? call.result.slice(0, 2_000) : undefined
          }))
        }))
      if (messages.length < 2) return { ok: false, error: '没有足够的早期对话可压缩' }

      const { profile, apiKey } = settingsStore.getActiveProfile()
      const compactModel =
        typeof input.model === 'string' && input.model.trim()
          ? input.model.trim().slice(0, 200)
          : profile.model
      if (!profile.baseUrl || !compactModel) {
        return { ok: false, error: '模型配置不完整，无法生成压缩摘要' }
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 60_000)
      try {
        const instruction =
          typeof input.instruction === 'string' ? input.instruction.slice(0, 2_000).trim() : ''
        const system = [
          'You are now acting as the compaction engine for a coding assistant. Condense the conversation into a structured checkpoint that lets another model resume with no loss of essential context.',
          'Output exactly these Markdown sections in order, using terse bullets and "(none)" for empty sections:',
          '## Primary Request and Intent',
          '## Key Technical Concepts',
          '## Files and Code',
          '## Errors and Fixes',
          '## Pending Jobs',
          '## Current Work',
          '## Next Step',
          '## Critical Context',
          'Preserve exact file paths, commands, error strings, identifiers and numeric values. Do not mention the compaction request. Output only the checkpoint text.',
          `User requirement for this compaction: ${
            instruction || '保留代码改动、关键决策、错误和未完成任务，可以丢掉寒暄与重复解释。'
          }`,
          typeof input.priorSummary === 'string' && input.priorSummary.trim()
            ? `A previous checkpoint exists. Merge still-true facts into this new checkpoint and do not copy stale details:\n${input.priorSummary.slice(0, 12_000)}`
            : ''
        ]
          .filter(Boolean)
          .join('\n')
        const result = await streamModel(
          {
            provider: profile.provider,
            baseUrl: profile.baseUrl,
            model: compactModel,
            apiKey,
            temperature: 0.2,
            maxTokens: Math.min(Math.max(1_024, profile.maxTokens), 4_096)
          },
          { system, messages, tools: [], signal: controller.signal },
          { onText: () => undefined, onReasoning: () => undefined }
        )
        const summary = result.text.trim()
        if (!summary) return { ok: false, error: '模型没有返回压缩摘要' }
        return { ok: true, summary: summary.slice(0, 20_000) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          ok: false,
          error: controller.signal.aborted ? '压缩超时，请重试' : message
        }
      } finally {
        clearTimeout(timer)
      }
    }
  )

  ipcMain.handle('agent:run', async (event, input: AgentRunRequest): Promise<AgentRunResult> => {    if (!input || typeof input !== 'object' || !Array.isArray(input.messages)) {
      return { ok: false, error: '请求格式不正确' }
    }
    if (activeRuns.size > 0) {
      return { ok: false, error: '已有任务正在运行，请先停止或等待完成。' }
    }
    const runId = typeof input.runId === 'string' && input.runId ? input.runId : crypto.randomUUID()
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : 'default'
    const controller = new AbortController()
    activeRuns.set(runId, { controller, sessionId })
    const sender = event.sender
    const onDestroyed = (): void => {
      controller.abort()
      approvalService.cancelRun(runId)
    }
    sender.once('destroyed', onDestroyed)

    try {
      const { profile, apiKey } = settingsStore.getActiveProfile()
      const model =
        typeof input.model === 'string' && input.model.trim()
          ? input.model.trim().slice(0, 200)
          : profile.model
      if (!profile.baseUrl || !model) {
        return { ok: false, error: '模型配置不完整，请打开设置填写 Base URL 与 Model ID。' }
      }
      const effectiveContextWindow =
        typeof input.contextWindow === 'number' && Number.isFinite(input.contextWindow)
          ? Math.round(Math.min(2_000_000, Math.max(4_000, input.contextWindow)))
          : profile.contextWindow
      const effectiveMaxTokens =
        typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens)
          ? Math.round(Math.min(200_000, Math.max(256, input.maxTokens)))
          : profile.maxTokens
      const baseTools: ToolDefinition[] = [
        ...createFileTools(),
        runCommandTool,
        systemInfoTool,
        webFetchTool
      ]
      const workerReady = Boolean(agentWorker?.ready)
      const localOrProxied = workerReady
        ? baseTools.map((tool) => agentWorker!.proxyTool(tool))
        : baseTools
      const coreTools: ToolDefinition[] = [
        ...localOrProxied,
        ...createBrowserTools(browserBridge, () => mainWindow),
        createAppControlTool(appBridge, () => mainWindow)
      ]
      let mcpTools: ToolDefinition[] = []
      try {
        mcpTools = await mcpManager.tools()
      } catch (error) {
        console.error('Failed to load MCP tools:', error)
      }
      const enabledMcp = settingsStore
        .getRaw()
        .mcpServers.filter((server) => server.enabled)
        .map((server) => server.name)
      const attachments: AttachmentPayload[] = (Array.isArray(input.attachments)
        ? input.attachments
        : [])
        .filter(
          (item): item is AttachmentPayload =>
            Boolean(item) && typeof item === 'object' && typeof item.path === 'string'
        )
        .slice(0, 8)
        .map((item) => ({
          path: item.path.slice(0, 500),
          kind: item.kind === 'image' || item.kind === 'binary' ? item.kind : 'text',
          content:
            item.kind === 'text' && typeof item.content === 'string'
              ? item.content.slice(0, 120_000)
              : undefined,
          dataUrl:
            item.kind === 'image' && typeof item.dataUrl === 'string'
              ? item.dataUrl.slice(0, 30_000_000)
              : undefined,
          mime: typeof item.mime === 'string' ? item.mime.slice(0, 100) : undefined,
          size: typeof item.size === 'number' ? item.size : undefined,
          ocrText:
            typeof item.ocrText === 'string' ? item.ocrText.slice(0, 100_000) : undefined
        }))
      const preparedAttachments = prepareAttachmentsForModel(
        attachments,
        typeof input.vision === 'boolean' ? input.vision : profile.vision,
        model
      )
      if (preparedAttachments.warning && !sender.isDestroyed()) {
        sender.send('agent:event', {
          type: 'notice',
          runId,
          message: preparedAttachments.warning
        })
      }
      const systemPrompt = buildSystemPrompt({
        workspace: settingsStore.getRaw().workspace,
        extra: settingsStore.getRaw().systemPromptExtra,
        model,
        mcpServerNames: enabledMcp,
        mcpInstructions: mcpManager.instructions(),
        pythonContext: await pythonEnv.promptContext(),
        approvalMode: settingsStore.getRaw().approvalMode
      })

      const workspace = settingsStore.getRaw().workspace
      agentWorker?.setWorkspace(workspace)
      // One cheap write probe per run, unless the elevated worker handles the
      // writes: the UI process may be blocked while the worker is not.
      if (!agentWorker?.ready) {
        try {
          const probe = join(workspace, `.hq-write-probe-${Date.now()}.tmp`)
          await writeFile(probe, 'ok', 'utf8')
          await unlink(probe)
        } catch {
          if (!sender.isDestroyed()) {
            sender.send('agent:event', {
              type: 'notice',
              runId,
              message:
                '工作区当前不可写：安全软件（火绒 / Windows Defender 的文档保护）可能正在拦截本程序。可在设置 → 工作区开启「以管理员权限运行 Agent」，或把工作区目录加入信任区。'
            } satisfies AgentEvent)
          }
        }
      }
      let beforeSnapshot: Awaited<ReturnType<typeof snapshotWorkspace>> | null = null
      try {
        beforeSnapshot = await snapshotWorkspace(workspace)
      } catch (error) {
        console.error('Failed to snapshot workspace:', error)
      }

      const result = await runAgent({
        runId,
        sessionId,
        workspace,
        provider: {
          provider: profile.provider,
          baseUrl: profile.baseUrl,
          model,
          apiKey,
          temperature: profile.temperature,
          maxTokens: effectiveMaxTokens
        },
        contextWindow: effectiveContextWindow,
        contextSummary: typeof input.contextSummary === 'string' ? input.contextSummary.slice(0, 20_000) : undefined,
        attachments: preparedAttachments.attachments,
        reasoningEffort: input.reasoningEffort,
        approvalMode: settingsStore.getRaw().approvalMode,        maxSteps: settingsStore.getRaw().maxSteps,
        systemPrompt,
        messages: input.messages.slice(-200),
        tools: [...coreTools, ...mcpTools],
        signal: controller.signal,
        emit: (payload) => {
          if (!sender.isDestroyed()) sender.send('agent:event', payload)
        },
        requestApproval: (request) => approvalService.request(request, sessionId, sender)
      })

      if (beforeSnapshot) {
        try {
          const afterSnapshot = await snapshotWorkspace(workspace)
          result.workspaceChanges = diffWorkspace(beforeSnapshot, afterSnapshot)
        } catch (error) {
          console.error('Failed to diff workspace:', error)
        }
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!sender.isDestroyed()) {
        sender.send('agent:event', {
          type: 'run-end',
          runId,
          status: 'error',
          error: message
        } satisfies AgentEvent)
      }
      return { ok: false, error: message }
    } finally {
      activeRuns.delete(runId)
      approvalService.cancelRun(runId)
      sender.removeListener('destroyed', onDestroyed)
    }
  })

  ipcMain.handle('agent:abort', (_event, runId: string) => {
    const run = activeRuns.get(runId)
    if (run) {
      run.controller.abort()
      approvalService.cancelRun(runId)
    }
  })

  ipcMain.handle('agent:approve', (_event, requestId: string, decision: ApprovalDecision) => {
    if (!['deny', 'allow', 'always'].includes(decision)) return
    approvalService.decide(requestId, decision)
  })
}

const ELEVATED_FLAG = '--hq-elevated'

function elevationLog(line: string): void {
  try {
    const file = join(app.getPath('userData'), 'elevation.log')
    appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    // Logging must never break startup.
  }
}

function elevationMarker(): string {
  return join(app.getPath('userData'), '.elevation-attempt')
}

function hadRecentElevationAttempt(): boolean {
  try {
    return Date.now() - statSync(elevationMarker()).mtimeMs < 90_000
  } catch {
    return false
  }
}

function markElevationAttempt(): void {
  try {
    writeFileSync(elevationMarker(), String(Date.now()))
  } catch {
    // Ignore; the argv flag still guards against loops.
  }
}

function clearElevationMarker(): void {
  try {
    unlinkSync(elevationMarker())
  } catch {
    // Nothing to clear.
  }
}

function readyMarker(): string {
  return join(app.getPath('userData'), '.elevated-ready')
}

function clearReadyMarker(): void {
  try {
    unlinkSync(readyMarker())
  } catch {
    // Nothing to clear.
  }
}

function markReady(): void {
  try {
    writeFileSync(readyMarker(), String(Date.now()))
  } catch {
    // The handshake is best-effort.
  }
}

function integrityLevel(): 'low' | 'medium' | 'high' | 'unknown' {
  if (process.platform !== 'win32') return 'unknown'
  try {
    const output = execFileSync('whoami', ['/groups'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000
    })
    // S-1-16-4096 = Low, 8192 = Medium, 12288/16384 = High/System
    if (/S-1-16-4096/.test(output)) return 'low'
    if (/S-1-16-12288|S-1-16-16384/.test(output)) return 'high'
    return 'medium'
  } catch {
    return 'unknown'
  }
}

function isElevated(): boolean {
  if (process.platform !== 'win32') return true
  // `net session` depends on the Server service and can fail even when elevated.
  // The mandatory label SID is language-independent and reliable.
  try {
    const output = execFileSync('whoami', ['/groups'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000
    })
    return /S-1-16-12288|S-1-16-16384/.test(output)
  } catch {
    return false
  }
}

async function canWriteDirectory(dir: string): Promise<boolean> {
  const probe = join(dir, `.hq-access-${process.pid}-${Date.now()}.tmp`)
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(probe, 'ok', 'utf8')
    await unlink(probe)
    return true
  } catch {
    return false
  }
}

function relaunchElevated(): boolean {
  const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`
  const projectRoot = app.getAppPath()
  const devLauncher = join(projectRoot, '启动开发版.bat')
  let command: string
  if (!app.isPackaged && existsSync(devLauncher)) {
    // Restarting electron.exe alone would leave the electron-vite dev server
    // behind, so the new window loads nothing. Elevate the project launcher.
    command = [
      'try {',
      `Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c',${quote(`"${devLauncher}"`)})`,
      `-WorkingDirectory ${quote(projectRoot)}`,
      '-Verb RunAs -ErrorAction Stop',
      '} catch { exit 1 }'
    ].join(' ')
  } else {
    const args = process.argv.slice(1).filter((arg) => arg !== ELEVATED_FLAG)
    args.push(ELEVATED_FLAG)
    command = [
      'try {',
      `Start-Process -FilePath ${quote(process.execPath)}`,
      `-ArgumentList @(${args.map(quote).join(',')})`,
      `-WorkingDirectory ${quote(app.isPackaged ? dirname(process.execPath) : projectRoot)}`,
      '-Verb RunAs -ErrorAction Stop',
      '} catch { exit 1 }'
    ].join(' ')
  }
  markElevationAttempt()
  elevationLog(`relaunch: ${command}`)
  try {
    // Blocks until the UAC prompt is answered; non-zero means the user declined.
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', command],
      { encoding: 'utf8', windowsHide: true, timeout: 60_000 }
    )
    elevationLog(`relaunch spawned ok: ${String(output).trim().slice(0, 300)}`)
    return true
  } catch (error) {
    elevationLog(`relaunch failed/declined: ${String(error).slice(0, 500)}`)
    console.error('Elevation request failed or was declined:', error)
    return false
  }
}

function openSecurityCenter(): void {
  const candidates = [
    'C:\\Program Files (x86)\\Huorong\\Sysdiag\\bin\\HipsMain.exe',
    'C:\\Program Files\\Huorong\\Sysdiag\\bin\\HipsMain.exe'
  ]
  const target = candidates.find((item) => existsSync(item))
  if (target) {
    void shell.openPath(target)
    return
  }
  void shell.openPath('C:\\Program Files (x86)\\Huorong\\Sysdiag\\bin')
}

async function ensureWritableOrElevate(target: string, label: string): Promise<boolean> {
  if (await canWriteDirectory(target)) return true
  const alreadyTried =
    process.argv.includes(ELEVATED_FLAG) ||
    process.env.HQ_ELEVATED === '1' ||
    hadRecentElevationAttempt()
  const elevated = isElevated()
  if (!elevated && !alreadyTried) {
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: '需要写入权限',
      message: `${label}当前不可写`,
      detail:
        `目标：${target}\n\n` +
        '最常见的原因：火绒 / Windows Defender 的「文档保护（受控文件夹访问）」不信任本程序。\n' +
        'Kimi Code 等正式软件能直接写入，是因为它们已被安全软件放行（签名 / 信任区）。\n\n' +
        '推荐做法：打开安全软件，把工作区目录或本程序加入信任区 —— 一次配置，之后无需管理员权限，也保留拖拽功能。\n' +
        '「以管理员身份重启」通常无法绕过安全软件，且会失去拖拽功能。',
      buttons: ['打开火绒设置', '以管理员身份重启', '继续以普通权限运行'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    if (choice === 0) {
      openSecurityCenter()
      return true
    }
    if (choice === 1 && relaunchElevated()) {
      app.quit()
      return false
    }
    return true
  }
  if (alreadyTried) {
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: elevated ? '写入权限受限' : '仍未获得管理员权限',
      message: elevated
        ? `即使以管理员身份运行，仍无法写入${label}`
        : `未能提升权限，${label}当前不可写`,
      detail:
        `目标：${target}\n\n` +
        (elevated
          ? '这不是 NTFS 权限问题，而是火绒 / Windows Defender 的「文档保护」按进程拦截。\n'
          : '你取消了 UAC 授权，或系统策略禁止提权。\n') +
        '可以把工作区换到非系统盘（如 D:\\华强以太项目），或打开安全软件把工作区目录 / HuaqiangAgent / electron.exe 加入信任区。',
      buttons: ['打开火绒设置', '知道了'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    if (choice === 0) openSecurityCenter()
  }
  return true
}

function findAlternativeWorkspace(current: string): string | null {
  for (const drive of ['D', 'E', 'F', 'G']) {
    const root = `${drive}:\\`
    if (!existsSync(root)) continue
    const candidate = join(root, '华强以太项目')
    if (normalize(candidate).toLowerCase() === normalize(current).toLowerCase()) continue
    try {
      mkdirSync(candidate, { recursive: true })
      return candidate
    } catch {
      // Not writable; try the next drive.
    }
  }
  return null
}

async function startAgentWorker(): Promise<void> {
  const workerScript = app.isPackaged
    ? join(process.resourcesPath, 'worker.js')
    : join(app.getAppPath(), 'out', 'main', 'worker.js')
  if (!existsSync(workerScript)) {
    console.error('Agent worker script missing:', workerScript)
    return
  }
  const bridge = new AgentWorkerBridge({
    execPath: process.execPath,
    workerScript,
    workingDir: app.isPackaged ? dirname(process.execPath) : app.getAppPath(),
    pythonPath: pythonEnv.currentPythonPath() || 'python.exe',
    logFile: join(app.getPath('userData'), 'agent-worker.log'),
    elevated: !isElevated(),
    scriptDir: app.getPath('userData')
  })
  const ok = await bridge.start().catch((error) => {
    console.error('Agent worker failed:', error)
    return false
  })
  if (ok) {
    agentWorker = bridge
    mcpManager.setRemoteBuiltin((tool, args) => bridge.executeBuiltin(tool, args))
    elevationLog('agent worker ready')
  } else {
    bridge.close()
    elevationLog('agent worker failed to start')
    if (mainWindow && !mainWindow.isDestroyed()) {
      void dialog
        .showMessageBox(mainWindow, {
          type: 'warning',
          title: '提权辅助进程未启动',
          message: 'Agent 仍在以普通权限运行',
          detail:
            'UAC 被拒绝、被安全软件拦截，或辅助进程启动失败。\n' +
            '可查看 .dev-profile/agent-worker.log 与 elevation.log；把程序加入安全软件信任区，或改用非系统盘工作区也可以解决写入问题。',
          buttons: ['知道了'],
          noLink: true
        })
        .catch(() => undefined)
    }
  }
}

async function bootstrap(): Promise<void> {
  const integrity = integrityLevel()
  elevationLog(`integrity=${integrity}`)
  if (integrity === 'low') {
    // 低完整性级别下，系统会拒绝写入用户目录、拒绝启动资源管理器等外部程序，
    // 表现为「Windows 无法访问指定设备、路径或文件」。
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      void dialog
        .showMessageBox(mainWindow, {
          type: 'warning',
          title: '程序运行在受限（低完整性）模式',
          message: '当前进程被系统降级为低完整性级别',
          detail:
            '这通常由火绒 / 其他安全软件的「程序沙盒 / 应用控制」造成。\n\n' +
            '在该模式下：写文件、打开资源管理器、调用 Office 等都会被 Windows 拒绝，\n' +
            '错误提示为「Windows 无法访问指定设备、路径或文件」。\n\n' +
            '解决办法：\n' +
            '1. 打开火绒 → 防护中心，关闭「程序沙盒 / 应用控制」，或把本程序加入信任区；\n' +
            '2. 完全退出应用程序后重新启动；\n' +
            '3. 若仍不行，重启电脑后再启动。',
          buttons: ['知道了'],
          noLink: true
        })
        .catch(() => undefined)
    }, 1500)
  }
  if (!(await ensureWritableOrElevate(app.getPath('userData'), '用户数据目录'))) return
  setToolTempBase(app.getPath('userData'))
  settingsStore = new SettingsStore()
  pythonEnv = new PythonEnvironment()
  if (
    settingsStore.getRaw().elevateOnStart &&
    !isElevated() &&
    !process.argv.includes(ELEVATED_FLAG) &&
    process.env.HQ_ELEVATED !== '1' &&
    !hadRecentElevationAttempt()
  ) {
    if (relaunchElevated()) {
      app.quit()
      return
    }
  }
  const canElevateAgent = !isElevated()
  let startAgentOnLaunch = canElevateAgent && settingsStore.getRaw().agentElevated
  const currentWorkspace = settingsStore.getRaw().workspace
  if (!(await canWriteDirectory(currentWorkspace))) {
    if (startAgentOnLaunch) {
      elevationLog('workspace not writable; relying on elevated agent worker')
    } else {
      const alternative = findAlternativeWorkspace(currentWorkspace)
      const buttons: string[] = []
      if (canElevateAgent) buttons.push('以管理员权限运行 Agent（推荐）')
      if (alternative) buttons.push(`改用 ${alternative}`)
      buttons.push('打开火绒设置')
      buttons.push('继续使用原工作区')
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        title: '工作区不可写',
        message: `当前工作区无法写入：${currentWorkspace}`,
        detail:
          '原因通常是火绒 / Windows Defender 的「文档保护」不信任本程序。\n\n' +
          (canElevateAgent
            ? '推荐：让 Agent 以管理员权限运行（独立提权辅助进程），窗口保持普通权限，拖拽不受影响。\n'
            : '') +
          (alternative
            ? `也可以改用非系统盘的新工作区：${alternative}（原文件保留在原处）。\n`
            : '') +
          '或者打开安全软件，把工作区目录或本程序加入信任区。',
        buttons,
        defaultId: 0,
        cancelId: buttons.length - 1,
        noLink: true
      })
      const chosen = buttons[choice] ?? ''
      if (chosen.startsWith('以管理员权限运行')) {
        startAgentOnLaunch = true
        // Remember the choice so the prompt does not reappear every launch.
        settingsStore.setAgentElevated(true)
      } else if (chosen.startsWith('改用')) {
        if (alternative) settingsStore.setWorkspace(alternative)
      } else if (chosen === '打开火绒设置') {
        openSecurityCenter()
      }
    }
  }
  sessionStore = new SessionStore()
  workspaceService = new WorkspaceService(settingsStore)
  mcpManager = new McpManager()
  builtinMcp = new BuiltinMcpService({
    workspace: () => settingsStore.getRaw().workspace,
    pythonPath: () => pythonEnv.currentPythonPath(),
    version: app.getVersion()
  })
  approvalService = new ApprovalService()
  browserBridge = new BrowserBridge('browser')
  browserBridge.registerIpc()
  appBridge = new BrowserBridge('app')
  appBridge.registerIpc()

  protocol.handle('app', serveRenderer)

  mcpManager.onStatus((statuses) => {
    sendToWindow({ type: 'mcp-status', statuses })
  })

  registerIpc()
  createWindow()
  // The startup succeeded; allow future launches to request elevation again.
  setTimeout(clearElevationMarker, 5000)
  if (startAgentOnLaunch) {
    void startAgentWorker()
  }

  void mcpManager.sync(settingsStore.getRaw().mcpServers)
  void builtinMcp
    ?.start()
    .then((transport) =>
      mcpManager.attachBuiltin(
        {
          id: 'builtin-huaqiang',
          name: '内置办公工具',
          enabled: true,
          transport: 'stdio',
          command: '',
          args: [],
          env: {},
          url: '',
          headers: {}
        },
        transport
      )
    )
    .catch((error) => console.error('Built-in MCP failed:', error))
  void pythonEnv
    .refresh()
    .then((status) => {
      if (status.available && !status.ready) return pythonEnv.setup()
      return undefined
    })
    .catch((error) => console.error('Python environment setup failed:', error))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  for (const [runId, run] of activeRuns) {
    run.controller.abort()
    approvalService?.cancelRun(runId)
  }
  agentWorker?.close()
  void mcpManager?.closeAll()
  void builtinMcp?.close()
})
