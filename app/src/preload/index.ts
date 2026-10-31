import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AgentEvent,
  AgentRunRequest,
  AgentRunResult,
  AppCommand,
  AppCommandResult,
  AppInfo,
  ApprovalDecision,
  AttachmentPayload,
  BrowserCommand,
  BrowserCommandResult,
  ChatSession,
  CompactRequest,
  CompactResult,
  FileContent,
  FileEntry,
  FileAsset,
  HqApi,
  McpServerConfig,
  McpStatus,
  McpTestResult,
  ProfileTestInput,
  ProfileTestResult,
  PythonStatus,
  ScreenshotResult,
  SessionMeta,
  SettingsSaveInput,
  UiSettings
} from '../shared/types'

const api: HqApi = {
  info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  getSettings: (): Promise<UiSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (input: SettingsSaveInput): Promise<UiSettings> =>
    ipcRenderer.invoke('settings:save', input),
  chooseWorkspace: (): Promise<string | null> => ipcRenderer.invoke('workspace:choose'),
  testProfile: (input: ProfileTestInput): Promise<ProfileTestResult> =>
    ipcRenderer.invoke('profile:test', input),
  listProfileModels: (input: ProfileTestInput): Promise<ProfileTestResult> =>
    ipcRenderer.invoke('profile:models', input),
  listSessions: (): Promise<SessionMeta[]> => ipcRenderer.invoke('sessions:list'),
  loadSession: (id: string): Promise<ChatSession | null> => ipcRenderer.invoke('sessions:load', id),
  saveSession: (session: ChatSession): Promise<SessionMeta> =>
    ipcRenderer.invoke('sessions:save', session),
  deleteSession: (id: string): Promise<void> => ipcRenderer.invoke('sessions:delete', id),
  runAgent: (input: AgentRunRequest): Promise<AgentRunResult> =>
    ipcRenderer.invoke('agent:run', input),
  compactConversation: (input: CompactRequest): Promise<CompactResult> =>
    ipcRenderer.invoke('agent:compact', input),
  abortAgent: (runId: string): Promise<void> => ipcRenderer.invoke('agent:abort', runId),
  approveTool: (requestId: string, decision: ApprovalDecision): Promise<void> =>
    ipcRenderer.invoke('agent:approve', requestId, decision),
  onAgentEvent: (listener: (event: AgentEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AgentEvent): void => listener(payload)
    ipcRenderer.on('agent:event', handler)
    return () => ipcRenderer.removeListener('agent:event', handler)
  },
  onBrowserCommand: (listener: (cmd: BrowserCommand) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, cmd: BrowserCommand): void => listener(cmd)
    ipcRenderer.on('browser:command', handler)
    return () => ipcRenderer.removeListener('browser:command', handler)
  },
  browserResult: (result: BrowserCommandResult): Promise<void> =>
    ipcRenderer.invoke('browser:result', result),
  onAppCommand: (listener: (cmd: AppCommand) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, cmd: AppCommand): void => listener(cmd)
    ipcRenderer.on('app:command', handler)
    return () => ipcRenderer.removeListener('app:command', handler)
  },
  appControlResult: (result: AppCommandResult): Promise<void> =>
    ipcRenderer.invoke('app:result', result),
  captureScreenshot: (): Promise<ScreenshotResult | null> =>
    ipcRenderer.invoke('screenshot:capture'),
  requestElevation: (): Promise<boolean> => ipcRenderer.invoke('app:elevate'),
  filePath: (file: unknown): string => {
    try {
      return webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0])
    } catch {
      return ''
    }
  },
  setZoom: (factor: number): Promise<number> => ipcRenderer.invoke('window:setZoom', factor),
  getZoom: (): Promise<number> => ipcRenderer.invoke('window:getZoom'),
  setFullscreen: (value: boolean): Promise<void> => ipcRenderer.invoke('window:setFullscreen', value),
  workspaceList: (path?: string): Promise<FileEntry[]> => ipcRenderer.invoke('workspace:list', path),
  workspaceRead: (path: string): Promise<FileContent> => ipcRenderer.invoke('workspace:read', path),
  workspaceReadAsset: (path: string): Promise<FileAsset> =>
    ipcRenderer.invoke('workspace:readAsset', path),
  workspaceExtract: (path: string): Promise<{ path: string; text: string; truncated: boolean }> =>
    ipcRenderer.invoke('workspace:extract', path),
  workspaceOcr: (path: string): Promise<{ path: string; text: string }> =>
    ipcRenderer.invoke('workspace:ocr', path),
  pythonStatus: (): Promise<PythonStatus> => ipcRenderer.invoke('python:status'),
  pythonSetup: (): Promise<PythonStatus> => ipcRenderer.invoke('python:setup'),
  pickAttachments: (): Promise<AttachmentPayload[]> => ipcRenderer.invoke('attachments:pick'),
  readDroppedAttachments: (
    paths: string[]
  ): Promise<{ attachments: AttachmentPayload[]; errors: string[] }> =>
    ipcRenderer.invoke('attachments:readPaths', paths),
  workspaceWrite: (path: string, content: string): Promise<FileContent> =>
    ipcRenderer.invoke('workspace:write', path, content),
  workspaceReveal: (path?: string): Promise<void> => ipcRenderer.invoke('workspace:reveal', path),
  workspaceOpen: (path?: string): Promise<void> => ipcRenderer.invoke('workspace:open', path),
  workspaceOpenWith: (path?: string): Promise<void> =>
    ipcRenderer.invoke('workspace:openWith', path),
  workspaceOpenOffice: (path?: string): Promise<void> =>
    ipcRenderer.invoke('workspace:openOffice', path),
  mcpStatuses: (): Promise<McpStatus[]> => ipcRenderer.invoke('mcp:statuses'),
  mcpRestart: (): Promise<McpStatus[]> => ipcRenderer.invoke('mcp:restart'),
  mcpTest: (config: McpServerConfig): Promise<McpTestResult> => ipcRenderer.invoke('mcp:test', config),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('app:openDataFolder'),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  onWindowState: (listener: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void => listener(maximized)
    ipcRenderer.on('window:state', handler)
    return () => ipcRenderer.removeListener('window:state', handler)
  }
}

contextBridge.exposeInMainWorld('hq', api)
