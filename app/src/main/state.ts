import type { BrowserWindow } from 'electron'
import type { ApprovalService } from './approval'
import type { BrowserBridge } from './browser-bridge'
import type { BuiltinMcpService } from './mcp-builtin'
import type { McpManager } from './mcp'
import type { PythonEnvironment } from './python-env'
import type { SessionStore } from './sessions'
import type { SettingsStore } from './settings'
import type { AgentWorkerBridge } from './worker-bridge'
import type { WorkspaceService } from './workspace'

export interface ActiveRun {
  controller: AbortController
  sessionId: string
}

/**
 * 主进程在 bootstrap 里一次性填好这些服务，之后所有模块只读引用。
 * 这样 IPC、窗口、提权等模块不必互相 import，也不会形成循环依赖。
 */
export interface AppState {
  mainWindow: BrowserWindow | null
  settings: SettingsStore
  sessions: SessionStore
  workspace: WorkspaceService
  mcp: McpManager
  python: PythonEnvironment
  approval: ApprovalService
  browserBridge: BrowserBridge
  appBridge: BrowserBridge
  worker: AgentWorkerBridge | null
  builtinMcp: BuiltinMcpService | null
}

/** 在 bootstrap 完成前为空；此时还没有任何窗口或 IPC 能访问它。 */
export const state = {} as AppState

export const activeRuns = new Map<string, ActiveRun>()

export const NETWORK_LOCKED_ERROR =
  '断网锁已开启：模型 API 仍可用，但禁止网页抓取、浏览器导航、联网 MCP 和联网命令。'

/** 中止所有正在运行的任务，并取消它们挂起的审批。 */
export function abortAllRuns(): void {
  for (const [runId, run] of activeRuns) {
    run.controller.abort()
    state.approval?.cancelRun(runId)
  }
}
