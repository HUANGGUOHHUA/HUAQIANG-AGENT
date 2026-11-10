import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { handleTrusted } from './trust'
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
import { NETWORK_LOCKED_ERROR, activeRuns, state } from '../state'

/** 应用级 IPC：版本信息、设置、模型连通性、会话、MCP、Python、窗口控制、提权。 */
export function registerAppIpc(): void {
  handleTrusted('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    dataDir: app.getPath('userData'),
    elevated: isElevated()
  }))

  handleTrusted('settings:get', () => state.settings.getPublic())

  handleTrusted('settings:save', (_event, input: SettingsSaveInput) => {
    const settings = state.settings.save(input)
    const servers = state.settings.getRaw().mcpServers
    // Reconnecting while a run is active would close clients that in-flight
    // tool calls still hold, so defer the sync until the next run.
    if (activeRuns.size === 0) {
      void state.mcp.sync(
        settings.networkLocked ? servers.filter((server) => server.transport !== 'http') : servers
      )
    }
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
  const stored = state.settings.getProfileById(input.profile?.id ?? '')
  if (!stored) return ''
  const requested = (input.profile?.baseUrl ?? '').trim()
  return requested === stored.profile.baseUrl ? stored.apiKey : ''
}

function registerProfileIpc(): void {
  handleTrusted('profile:test', async (_event, input: ProfileTestInput) => {
    if (!input?.profile) return { ok: false, message: '配置为空' }
    return testProfileConnection(input.profile, resolveProfileApiKey(input))
  })

  handleTrusted('profile:models', async (_event, input: ProfileTestInput) => {
    if (!input?.profile) return { ok: false, message: '配置为空' }
    return listProfileModels(input.profile, resolveProfileApiKey(input))
  })
}

function registerSessionIpc(): void {
  handleTrusted('sessions:list', () => state.sessions.list())
  handleTrusted('sessions:load', (_event, id: string) => state.sessions.load(id))
  handleTrusted('sessions:save', (_event, session) => state.sessions.save(session))
  handleTrusted('sessions:delete', (_event, id: string) => {
    state.approval.forgetSession(id)
    return state.sessions.remove(id)
  })
}

function registerMcpIpc(): void {
  handleTrusted('mcp:statuses', () => state.mcp.statuses())
  handleTrusted('mcp:restart', () => {
    if (activeRuns.size > 0) return state.mcp.statuses()
    const servers = state.settings.getRaw().mcpServers
    return state.mcp.sync(
      state.settings.getRaw().networkLocked
        ? servers.filter((server) => server.transport !== 'http')
        : servers
    )
  })
  handleTrusted('mcp:test', (_event, config: McpServerConfig) => {
    if (state.settings.getRaw().networkLocked && config.transport === 'http') {
      return { ok: false, message: NETWORK_LOCKED_ERROR, tools: [] }
    }
    return state.mcp.test(config)
  })
}

function registerPythonIpc(): void {
  handleTrusted('python:status', () => state.python.refresh())
  handleTrusted('python:setup', () => state.python.setup())
}

function registerWindowIpc(): void {
  handleTrusted('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  handleTrusted('window:toggleMaximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  handleTrusted('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  handleTrusted('window:isMaximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })
  handleTrusted('window:setZoom', (event, factor: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return 1
    const clamped = Math.max(0.8, Math.min(2, Math.round((Number(factor) || 1) * 100) / 100))
    win.webContents.setZoomFactor(clamped)
    return win.webContents.getZoomFactor()
  })
  handleTrusted('window:getZoom', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.webContents.getZoomFactor() ?? 1
  })
  handleTrusted('window:setFullscreen', (event, value: boolean) => {
    BrowserWindow.fromWebContents(event.sender)?.setFullScreen(Boolean(value))
  })
}

function registerAppShellIpc(): void {
  handleTrusted('app:openExternal', async (_event, url: string) => {
    if (typeof url !== 'string') return
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
      await shell.openExternal(parsed.toString())
    } catch {
      // Ignore invalid URLs.
    }
  })

  handleTrusted('app:openDataFolder', async () => {
    await shell.openPath(app.getPath('userData'))
  })
}

function registerElevateIpc(): void {
  handleTrusted('app:elevate', async () => {
    if (isElevated()) return false
    clearReadyMarker()
    if (!(await relaunchElevated())) return false
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
