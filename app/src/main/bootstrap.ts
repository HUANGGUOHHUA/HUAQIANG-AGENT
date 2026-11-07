import { app, dialog } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ApprovalService } from './approval'
import { BrowserBridge } from './browser-bridge'
import { setToolTempBase } from './child-env'
import { registerIpc } from './ipc'
import {
  ELEVATED_FLAG,
  canWriteDirectory,
  clearElevationMarker,
  elevationLog,
  ensureWritableOrElevate,
  findAlternativeWorkspace,
  hadRecentElevationAttempt,
  integrityLevel,
  isElevated,
  openSecurityCenter,
  relaunchElevated
} from './elevation'
import { McpManager } from './mcp'
import { BuiltinMcpService } from './mcp-builtin'
import { PythonEnvironment } from './python-env'
import { SessionStore } from './sessions'
import { SettingsStore } from './settings'
import { state } from './state'
import { createWindow, registerAppProtocol, sendToWindow } from './window'
import { AgentWorkerBridge } from './worker-bridge'
import { WorkspaceService } from './workspace'

const BUILTIN_MCP_SERVER = {
  id: 'builtin-huaqiang',
  name: '内置办公工具',
  enabled: true,
  transport: 'stdio' as const,
  command: '',
  args: [],
  env: {},
  url: '',
  headers: {}
}

/** 应用主流程：完整性检查 → 服务初始化 → IPC → 窗口 → 后台任务。 */
export async function bootstrap(): Promise<void> {
  reportLowIntegrity()
  if (!(await ensureWritableOrElevate(app.getPath('userData'), '用户数据目录'))) return
  setToolTempBase(app.getPath('userData'))

  state.settings = new SettingsStore()
  state.python = new PythonEnvironment()
  if (shouldElevateOnStart()) {
    if (relaunchElevated()) {
      app.quit()
      return
    }
  }

  const startAgentOnLaunch = await resolveWorkspace()
  createServices()
  registerAppProtocol()
  state.mcp.onStatus((statuses) => sendToWindow({ type: 'mcp-status', statuses }))
  registerIpc()
  createWindow()

  // The startup succeeded; allow future launches to request elevation again.
  setTimeout(clearElevationMarker, 5000)
  if (startAgentOnLaunch) void startAgentWorker()
  startBackgroundTasks()
}

function shouldElevateOnStart(): boolean {
  return (
    state.settings.getRaw().elevateOnStart &&
    !isElevated() &&
    !process.argv.includes(ELEVATED_FLAG) &&
    process.env.HQ_ELEVATED !== '1' &&
    !hadRecentElevationAttempt()
  )
}

/** 返回是否需要在启动时拉起提权 Agent worker。 */
async function resolveWorkspace(): Promise<boolean> {
  const canElevateAgent = !isElevated()
  let startAgentOnLaunch = canElevateAgent && state.settings.getRaw().agentElevated
  const currentWorkspace = state.settings.getRaw().workspace
  if (await canWriteDirectory(currentWorkspace)) return startAgentOnLaunch
  if (startAgentOnLaunch) {
    elevationLog('workspace not writable; relying on elevated agent worker')
    return startAgentOnLaunch
  }

  const alternative = findAlternativeWorkspace(currentWorkspace)
  const buttons: string[] = []
  if (canElevateAgent) buttons.push('以管理员权限运行 Agent（推荐）')
  if (alternative) buttons.push(`改用 ${alternative}`)
  buttons.push('打开火绒设置', '继续使用原工作区')
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
    // Remember the choice so the prompt does not reappear every launch.
    state.settings.setAgentElevated(true)
    startAgentOnLaunch = true
  } else if (chosen.startsWith('改用') && alternative) {
    state.settings.setWorkspace(alternative)
  } else if (chosen === '打开火绒设置') {
    openSecurityCenter()
  }
  return startAgentOnLaunch
}

function createServices(): void {
  state.sessions = new SessionStore()
  state.workspace = new WorkspaceService(state.settings)
  state.mcp = new McpManager()
  state.builtinMcp = new BuiltinMcpService({
    workspace: () => state.settings.getRaw().workspace,
    pythonPath: () => state.python.currentPythonPath(),
    version: app.getVersion()
  })
  state.approval = new ApprovalService()
  state.browserBridge = new BrowserBridge('browser')
  state.browserBridge.registerIpc()
  state.appBridge = new BrowserBridge('app')
  state.appBridge.registerIpc()
}

function startBackgroundTasks(): void {
  const servers = state.settings.getRaw().mcpServers
  void state.mcp.sync(
    state.settings.getRaw().networkLocked
      ? servers.filter((server) => server.transport !== 'http')
      : servers
  )
  void state.builtinMcp
    ?.start()
    .then((transport) => state.mcp.attachBuiltin(BUILTIN_MCP_SERVER, transport))
    .catch((error) => console.error('Built-in MCP failed:', error))
  void state.python
    .refresh()
    .then((status) => {
      if (status.available && !status.ready) return state.python.setup()
      return undefined
    })
    .catch((error) => console.error('Python environment setup failed:', error))
}

function reportLowIntegrity(): void {
  const level = integrityLevel()
  elevationLog(`integrity=${level}`)
  if (level !== 'low') return
  // 低完整性级别下，系统会拒绝写入用户目录、拒绝启动资源管理器等外部程序，
  // 表现为「Windows 无法访问指定设备、路径或文件」。
  setTimeout(() => {
    const win = state.mainWindow
    if (!win || win.isDestroyed()) return
    void dialog
      .showMessageBox(win, {
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
    pythonPath: state.python.currentPythonPath() || 'python.exe',
    logFile: join(app.getPath('userData'), 'agent-worker.log'),
    elevated: !isElevated(),
    scriptDir: app.getPath('userData')
  })
  const ok = await bridge.start().catch((error) => {
    console.error('Agent worker failed:', error)
    return false
  })
  if (ok) {
    state.worker = bridge
    state.mcp.setRemoteBuiltin((tool, args) => bridge.executeBuiltin(tool, args))
    elevationLog('agent worker ready')
    return
  }
  bridge.close()
  elevationLog('agent worker failed to start')
  const win = state.mainWindow
  if (!win || win.isDestroyed()) return
  void dialog
    .showMessageBox(win, {
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
