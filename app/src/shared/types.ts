export type ProviderKind = 'openai' | 'anthropic'
export type ApprovalMode = 'ask' | 'auto'
export type ToolRisk = 'read' | 'write' | 'exec' | 'network' | 'mcp'
export type ToolCallStatus = 'running' | 'ok' | 'error' | 'denied' | 'cancelled'

export interface Usage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheMissTokens: number
  cacheCreationTokens: number
}

export interface LineStats {
  additions: number
  deletions: number
}

export type WorkspaceChangeKind =
  | 'created'
  | 'updated'
  | 'edited'
  | 'deleted'
  | 'moved'
  | 'directory'

export interface WorkspaceChange extends LineStats {
  path: string
  kind: WorkspaceChangeKind
  target?: string
}

export interface FileAsset {
  path: string
  mime: string
  size: number
  dataUrl: string
  binary: boolean
  truncated: boolean
}

export interface PythonStatus {
  available: boolean
  ready: boolean
  installing: boolean
  version?: string
  venvPath: string
  pythonPath?: string
  installed: string[]
  missing: string[]
  progress?: string
  error?: string
}

export type AttachmentKind = 'text' | 'image' | 'binary'

export interface AttachmentPayload {
  id?: string
  path: string
  kind: AttachmentKind
  content?: string
  dataUrl?: string
  mime?: string
  size?: number
  ocrText?: string
}

export interface ToolCallView {
  id: string
  name: string
  displayName?: string
  risk?: ToolRisk
  args: Record<string, unknown>
  status: ToolCallStatus
  result?: string
  isError?: boolean
  stats?: LineStats
  startedAt?: number
  endedAt?: number
}

export interface AppMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  toolCalls?: ToolCallView[]
  createdAt: number
  model?: string
  error?: string
  attachments?: AttachmentPayload[]
}

export interface SessionStats {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  outputTokens: number
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: AppMessage[]
  workspace?: string
  model?: string
  modelContextWindow?: number
  modelMaxTokens?: number
  modelVision?: boolean
  reasoningEffort?: ReasoningEffort
  tokenUsage?: Usage
  stats?: SessionStats
  contextSummary?: string
  contextInstruction?: string
  lastChanges?: WorkspaceChange[]
}

export interface SessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  workspace?: string
}

export interface ModelInfo {
  id: string
  name?: string
  contextWindow?: number
  maxOutputTokens?: number
  ownedBy?: string
  vision?: boolean
  reasoning?: boolean
}

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max'

export interface ApiProfile {
  id: string
  name: string
  provider: ProviderKind
  baseUrl: string
  model: string
  contextWindow: number
  temperature: number
  maxTokens: number
  hasKey: boolean
  vision?: boolean
}

export interface ProfileDraft {
  id: string
  name: string
  provider: ProviderKind
  baseUrl: string
  model: string
  contextWindow: number
  temperature: number
  maxTokens: number
  vision?: boolean
}

export interface McpServerConfig {
  id: string
  name: string
  enabled: boolean
  transport: 'stdio' | 'http'
  command: string
  args: string[]
  env: Record<string, string>
  url: string
  headers: Record<string, string>
}

export interface UiSettings {
  version: number
  profiles: ApiProfile[]
  activeProfileId: string
  workspace: string
  elevateOnStart: boolean
  agentElevated: boolean
  approvalMode: ApprovalMode
  maxSteps: number
  mcpServers: McpServerConfig[]
  systemPromptExtra: string
  encryptionAvailable: boolean
}

export interface SettingsSaveInput {
  profiles: ProfileDraft[]
  activeProfileId: string
  workspace: string
  elevateOnStart?: boolean
  agentElevated?: boolean
  approvalMode: ApprovalMode
  maxSteps: number
  mcpServers: McpServerConfig[]
  systemPromptExtra: string
  apiKeys?: Record<string, string | null>
}

export interface McpToolInfo {
  name: string
  description: string
}

export interface McpResourceInfo {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface McpPromptInfo {
  name: string
  description?: string
}

export interface McpStatus {
  id: string
  name: string
  enabled: boolean
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
  tools: McpToolInfo[]
  resources?: McpResourceInfo[]
  prompts?: McpPromptInfo[]
  instructions?: string
  builtin?: boolean
}

export interface McpTestResult {
  ok: boolean
  message: string
  tools?: McpToolInfo[]
  resources?: McpResourceInfo[]
  prompts?: McpPromptInfo[]
}

export interface ProfileTestInput {
  profile: ProfileDraft
  apiKey?: string | null
}

export interface ProfileTestResult {
  ok: boolean
  message: string
  models?: string[]
  modelDetails?: ModelInfo[]
}

export interface ApprovalRequest {
  id: string
  runId: string
  toolName: string
  displayName: string
  risk: ToolRisk
  summary: string
  preview: string
}

export type ApprovalDecision = 'deny' | 'allow' | 'always'

export type BrowserAction =
  | 'open'
  | 'snapshot'
  | 'click'
  | 'type'
  | 'scroll'
  | 'back'
  | 'forward'
  | 'stop'
  | 'reload'

export interface BrowserCommand {
  id: string
  action: BrowserAction
  params: Record<string, unknown>
}

export interface BrowserCommandResult {
  id: string
  ok: boolean
  data?: unknown
  error?: string
}

export type AppControlAction = 'open-panel' | 'close-panel' | 'show-tab' | 'open-settings'

export interface AppCommand {
  id: string
  action: AppControlAction
  params: Record<string, unknown>
}

export interface AppCommandResult {
  id: string
  ok: boolean
  data?: unknown
  error?: string
}

export interface ScreenshotResult {
  dataUrl: string
  width: number
  height: number
  scaleFactor: number
}

export interface AgentRunRequest {
  runId: string
  sessionId: string
  messages: AppMessage[]
  model?: string
  contextWindow?: number
  maxTokens?: number
  vision?: boolean
  reasoningEffort?: ReasoningEffort
  contextSummary?: string
  attachments?: AttachmentPayload[]
}

export interface AgentRunResult {
  ok: boolean
  error?: string
  aborted?: boolean
  usage?: Usage
  stats?: SessionStats
  workspaceChanges?: WorkspaceChange[]
}

export interface CompactRequest {
  messages: AppMessage[]
  instruction: string
  model?: string
  priorSummary?: string
}

export interface CompactResult {
  ok: boolean
  summary?: string
  error?: string
}

export type AgentEvent =
  | { type: 'run-start'; runId: string }
  | { type: 'notice'; runId: string; message: string }
  | { type: 'assistant-start'; runId: string; messageId: string }
  | { type: 'text-delta'; runId: string; messageId: string; delta: string }
  | { type: 'reasoning-delta'; runId: string; messageId: string; delta: string }
  | {
      type: 'tool-draft'
      runId: string
      messageId: string
      name: string
      chars: number
    }
  | {
      type: 'tool-start'
      runId: string
      messageId: string
      callId: string
      name: string
      displayName: string
      risk: ToolRisk
      args: Record<string, unknown>
    }
  | { type: 'tool-output'; runId: string; messageId: string; callId: string; delta: string }
  | {
      type: 'tool-end'
      runId: string
      messageId: string
      callId: string
      status: ToolCallStatus
      result: string
      isError: boolean
      stats?: LineStats
    }
  | { type: 'assistant-end'; runId: string; message: AppMessage }
  | { type: 'approval-request'; runId: string; request: ApprovalRequest }
  | { type: 'approval-closed'; runId: string; requestId: string }
  | { type: 'usage'; runId: string; usage: Usage }
  | { type: 'context-compressed'; runId: string; dropped: number; summaryChars: number }
  | { type: 'run-end'; runId: string; status: 'done' | 'aborted' | 'error'; error?: string; usage?: Usage; stats?: SessionStats }
  | { type: 'mcp-status'; statuses: McpStatus[] }

export interface FileEntry {
  name: string
  path: string
  type: 'dir' | 'file'
  size?: number
}

export interface FileContent {
  path: string
  content: string
  size: number
  binary: boolean
  truncated: boolean
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  dataDir: string
  elevated: boolean
}

export interface HqApi {
  info: () => Promise<AppInfo>
  getSettings: () => Promise<UiSettings>
  saveSettings: (input: SettingsSaveInput) => Promise<UiSettings>
  chooseWorkspace: () => Promise<string | null>
  testProfile: (input: ProfileTestInput) => Promise<ProfileTestResult>
  listProfileModels: (input: ProfileTestInput) => Promise<ProfileTestResult>
  listSessions: () => Promise<SessionMeta[]>
  loadSession: (id: string) => Promise<ChatSession | null>
  saveSession: (session: ChatSession) => Promise<SessionMeta>
  deleteSession: (id: string) => Promise<void>
  runAgent: (input: AgentRunRequest) => Promise<AgentRunResult>
  compactConversation: (input: CompactRequest) => Promise<CompactResult>
  abortAgent: (runId: string) => Promise<void>
  approveTool: (requestId: string, decision: ApprovalDecision) => Promise<void>
  onAgentEvent: (listener: (event: AgentEvent) => void) => () => void
  onBrowserCommand: (listener: (cmd: BrowserCommand) => void) => () => void
  browserResult: (result: BrowserCommandResult) => Promise<void>
  onAppCommand: (listener: (cmd: AppCommand) => void) => () => void
  appControlResult: (result: AppCommandResult) => Promise<void>
  captureScreenshot: () => Promise<ScreenshotResult | null>
  requestElevation: () => Promise<boolean>
  filePath: (file: unknown) => string
  setZoom: (factor: number) => Promise<number>
  getZoom: () => Promise<number>
  setFullscreen: (value: boolean) => Promise<void>
  workspaceList: (path?: string) => Promise<FileEntry[]>
  workspaceRead: (path: string) => Promise<FileContent>
  workspaceWrite: (path: string, content: string) => Promise<FileContent>
  workspaceReadAsset: (path: string) => Promise<FileAsset>
  workspaceExtract: (path: string) => Promise<{ path: string; text: string; truncated: boolean }>
  workspaceOcr: (path: string) => Promise<{ path: string; text: string }>
  pickAttachments: () => Promise<AttachmentPayload[]>
  readDroppedAttachments: (
    paths: string[]
  ) => Promise<{ attachments: AttachmentPayload[]; errors: string[] }>
  pythonStatus: () => Promise<PythonStatus>
  pythonSetup: () => Promise<PythonStatus>
  workspaceReveal: (path?: string) => Promise<void>
  workspaceOpen: (path?: string) => Promise<void>
  workspaceOpenWith: (path?: string) => Promise<void>
  workspaceOpenOffice: (path?: string) => Promise<void>
  mcpStatuses: () => Promise<McpStatus[]>
  mcpRestart: () => Promise<McpStatus[]>
  mcpTest: (config: McpServerConfig) => Promise<McpTestResult>
  openExternal: (url: string) => Promise<void>
  openDataFolder: () => Promise<void>
  minimizeWindow: () => Promise<void>
  toggleMaximize: () => Promise<boolean>
  closeWindow: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onWindowState: (listener: (maximized: boolean) => void) => () => void
}
