import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type {
  McpServerConfig,
  ProfileTestInput,
  SettingsSaveInput
} from '../../shared/types'
import { listProfileModels, testProfileConnection } from '../profile-test'
import {
  clearReadyMarker,
  elevationLog,
  isElevated,
  relaunchElevated,
  waitForElevatedInstance
} from '../elevation'
import { NETWORK_LOCKED_ERROR, state } from '../state'

/** 应用级 IPC：版本信息、设置、模型连通性、会话、MCP、Python、窗口控制、提权。 */
export function registerAppIpc(): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    dataDir: app.getPath('userData'),
    elevated: isElevated()
  }))

  ipcMain.handle('settings:get', () => state.settings.getPublic())

  ipcMain.handle('settings:save', (_event, input: SettingsSaveInput) => {
    const settings = state.settings.save(input)
    const servers = state.settings.getRaw().mcpServers
    void state.mcp.sync(
      settings.networkLocked ? servers.filter((server) => server.transport !== 'http') : servers
    )
    return settings
  })

  registerProfileIpc()
  registerSessionIpc()
  registerMcpIpc()
  registerPythonIpc()
  registerWindowIpc()
  registerAppShellIpc()
  registerElevateIpc()
}

function resolveProfileApiKey(input: ProfileTestInput): string {
  if (input.apiKey !== undefined) return input.apiKey ?? ''
  return state.settings.getProfileById(input.profile?.id ?? '')?.apiKey ?? ''
}

function registerProfileIpc(): void {
  ipcMain.handle('profile:test', async (_event, input: ProfileTestInput) => {
    if (!input?.profile) return { ok: false, message: '配置为空' }
    return testProfileConnection(input.profile, resolveProfileApiKey(input))
  })

  ipcMain.handle('profile:models', async (_event, input: ProfileTestInput) => {
    if (!input?.profile) return { ok: false, message: '配置为空' }
    return listProfileModels(input.profile, resolveProfileApiKey(input))
  })
}

function registerSessionIpc(): void {
  ipcMain.handle('sessions:list', () => state.sessions.list())
  ipcMain.handle('sessions:load', (_event, id: string) => state.sessions.load(id))
  ipcMain.handle('sessions:save', (_event, session) => state.sessions.save(session))
  ipcMain.handle('sessions:delete', (_event, id: string) => state.sessions.remove(id))
}

function registerMcpIpc(): void {
  ipcMain.handle('mcp:statuses', () => state.mcp.statuses())
  ipcMain.handle('mcp:restart', () => {
    const servers = state.settings.getRaw().mcpServers
    return state.mcp.sync(
      state.settings.getRaw().networkLocked
        ? servers.filter((server) => server.transport !== 'http')
        : servers
    )
  })
  ipcMain.handle('mcp:test', (_event, config: McpServerConfig) => {
    if (state.settings.getRaw().networkLocked && config.transport === 'http') {
      return { ok: false, message: NETWORK_LOCKED_ERROR, tools: [] }
    }
    return state.mcp.test(config)
  })
}

function registerPythonIpc(): void {
  ipcMain.handle('python:status', () => state.python.refresh())
  ipcMain.handle('python:setup', () => state.python.setup())
}

function registerWindowIpc(): void {
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
}

function registerAppShellIpc(): void {
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
}

function registerElevateIpc(): void {
  ipcMain.handle('app:elevate', async () => {
    if (isElevated()) return false
    clearReadyMarker()
    if (!relaunchElevated()) return false
    // Wait for the new instance to claim the single-instance lock. Only then
    // quit, so a failed relaunch never leaves the user with nothing.
    if (await waitForElevatedInstance()) {
      setTimeout(() => app.quit(), 150)
      return true
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
}
