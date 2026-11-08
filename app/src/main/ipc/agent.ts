import { app, clipboard, globalShortcut, ipcMain } from 'electron'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AgentEvent,
  AgentRunRequest,
  AgentRunResult,
  ApprovalDecision,
  AttachmentPayload,
  CompactRequest,
  CompactResult
} from '../../shared/types'
import { runAgent } from '../agent/loop'
import { buildSystemPrompt } from '../agent/prompt'
import { streamModel } from '../agent/providers'
import { createAppControlTool, createBrowserTools } from '../agent/tools/browser'
import { createDesktopTools } from '../agent/tools/desktop'
import { restoreDesktopWindow } from '../agent/tools/desktop/session'
import { createFileTools } from '../agent/tools/files'
import { runCommandTool } from '../agent/tools/shell'
import { systemInfoTool, webFetchTool } from '../agent/tools/system'
import type { ToolDefinition } from '../agent/tools/types'
import { prepareAttachmentsForModel } from '../agent/vision'
import {
  hideControlOverlay,
  highlightControl,
  releaseControlOverlay,
  restoreControlOverlay,
  resumeControlOverlay,
  showControlOverlay,
  suspendControlOverlay
} from '../control-overlay'
import { withNetworkLock } from '../network-lock'
import { activeRuns, state } from '../state'
import { analyzeBrowserImage, analyzeDesktopImage } from '../vision-analyze'
import { diffWorkspace, snapshotWorkspace } from '../workspace-changes'

const PYTHON_FALLBACK = 'python.exe'

/** 组装本次运行可用的工具：本地工具 → 提权 worker 代理 → 断网锁 → 桌面/浏览器工具。 */
function buildCoreTools(): ToolDefinition[] {
  const base: ToolDefinition[] = [
    ...createFileTools(),
    runCommandTool,
    systemInfoTool,
    webFetchTool
  ]
  const proxied = state.worker?.ready ? base.map((tool) => state.worker!.proxyTool(tool)) : base
  return [
    ...proxied.map(withNetworkLock),
    ...createBrowserTools(
      state.browserBridge,
      () => state.mainWindow,
      () => state.settings.getRaw().networkLocked,
      analyzeBrowserImage,
      (text) => clipboard.writeText(text)
    ),
    createAppControlTool(state.appBridge, () => state.mainWindow),
    ...createDesktopTools(() => state.mainWindow, {
      suspendOverlay: suspendControlOverlay,
      resumeOverlay: resumeControlOverlay,
      highlight: highlightControl,
      analyzeImage: analyzeDesktopImage,
      pythonPath: () =>
        state.python.currentPythonPath() ||
        (app.isPackaged
          ? join(process.resourcesPath, 'runtime', 'python', 'python.exe')
          : PYTHON_FALLBACK)
    })
  ]
}

async function loadMcpTools(): Promise<ToolDefinition[]> {
  let tools: ToolDefinition[] = []
  try {
    tools = await state.mcp.tools()
  } catch (error) {
    console.error('Failed to load MCP tools:', error)
    return []
  }
  if (!state.settings.getRaw().networkLocked) return tools
  const remoteNames = state.settings
    .getRaw()
    .mcpServers.filter((server) => server.transport === 'http')
    .map((server) => server.name)
  return tools.filter(
    (tool) => !remoteNames.some((name) => tool.description.includes(`[MCP 服务器：${name}]`))
  )
}

function normalizeAttachments(input: AgentRunRequest): AttachmentPayload[] {
  return (Array.isArray(input.attachments) ? input.attachments : [])
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
      ocrText: typeof item.ocrText === 'string' ? item.ocrText.slice(0, 100_000) : undefined
    }))
}

/** 每次运行一次廉价写探测，提前发现安全软件拦截的工作区。 */
async function probeWorkspace(workspace: string, sender: Electron.WebContents, runId: string): Promise<void> {
  if (state.worker?.ready) return
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

function registerCompactIpc(): void {
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

      const { profile, apiKey } = state.settings.getActiveProfile()
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
}

/** ESC 是任务运行期间的紧急停止；只在有任务时注册，避免抢走其他程序的 Esc。 */
function registerEscapeStop(): boolean {
  if (globalShortcut.isRegistered('Escape')) return false
  try {
    return globalShortcut.register('Escape', () => {
      hideControlOverlay()
      for (const [id, run] of activeRuns) {
        run.controller.abort()
        state.approval.cancelRun(id)
      }
    })
  } catch {
    return false
  }
}

function registerRunIpc(): void {
  ipcMain.handle(
    'agent:run',
    async (event, input: AgentRunRequest): Promise<AgentRunResult> => {
      if (!input || typeof input !== 'object' || !Array.isArray(input.messages)) {
        return { ok: false, error: '请求格式不正确' }
      }
      if (activeRuns.size > 0) {
        return { ok: false, error: '已有任务正在运行，请先停止或等待完成。' }
      }
      const runId = typeof input.runId === 'string' && input.runId ? input.runId : crypto.randomUUID()
      const sessionId = typeof input.sessionId === 'string' ? input.sessionId : 'default'
      const controller = new AbortController()
      activeRuns.set(runId, { controller, sessionId })
      const escapeRegistered = registerEscapeStop()
      const sender = event.sender
      const onDestroyed = (): void => {
        controller.abort()
        state.approval.cancelRun(runId)
      }
      sender.once('destroyed', onDestroyed)

      try {
        const result = await runSession({
          input,
          runId,
          sessionId,
          controller,
          sender
        })
        return result
      } finally {
        activeRuns.delete(runId)
        state.approval.cancelRun(runId)
        sender.removeListener('destroyed', onDestroyed)
        hideControlOverlay()
        restoreDesktopWindow()
        if (escapeRegistered) {
          try {
            globalShortcut.unregister('Escape')
          } catch {
            // The app may be shutting down; unregister must not mask the result.
          }
        }
      }
    }
  )
}

interface SessionInput {
  input: AgentRunRequest
  runId: string
  sessionId: string
  controller: AbortController
  sender: Electron.WebContents
}

async function runSession({
  input,
  runId,
  sessionId,
  controller,
  sender
}: SessionInput): Promise<AgentRunResult> {
  try {
    const { profile, apiKey } = state.settings.getActiveProfile()
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

    const coreTools = buildCoreTools()
    const mcpTools = await loadMcpTools()
    const attachments = normalizeAttachments(input)
    const prepared = prepareAttachmentsForModel(
      attachments,
      typeof input.vision === 'boolean' ? input.vision : profile.vision,
      model
    )
    if (prepared.warning && !sender.isDestroyed()) {
      sender.send('agent:event', { type: 'notice', runId, message: prepared.warning })
    }

    const settings = state.settings.getRaw()
    const enabledMcp = settings.mcpServers.filter((server) => server.enabled).map((server) => server.name)
    const systemPrompt = buildSystemPrompt({
      workspace: settings.workspace,
      extra: settings.systemPromptExtra,
      model,
      mcpServerNames: enabledMcp,
      mcpInstructions: state.mcp.instructions(),
      pythonContext: await state.python.promptContext(),
      approvalMode: settings.approvalMode
    })

    state.worker?.setWorkspace(settings.workspace)
    await probeWorkspace(settings.workspace, sender, runId)

    let beforeSnapshot: Awaited<ReturnType<typeof snapshotWorkspace>> | null = null
    try {
      beforeSnapshot = await snapshotWorkspace(settings.workspace)
    } catch (error) {
      console.error('Failed to snapshot workspace:', error)
    }

    const result = await runAgent({
      runId,
      sessionId,
      workspace: settings.workspace,
      provider: {
        provider: profile.provider,
        baseUrl: profile.baseUrl,
        model,
        apiKey,
        temperature: profile.temperature,
        maxTokens: effectiveMaxTokens
      },
      contextWindow: effectiveContextWindow,
      contextSummary:
        typeof input.contextSummary === 'string' ? input.contextSummary.slice(0, 20_000) : undefined,
      attachments: prepared.attachments,
      reasoningEffort: input.reasoningEffort,
      approvalMode: settings.approvalMode,
      maxSteps: settings.maxSteps,
      systemPrompt,
      messages: input.messages.slice(-200),
      tools: [...coreTools, ...mcpTools],
      signal: controller.signal,
      emit: (payload) => {
        if (!sender.isDestroyed()) sender.send('agent:event', payload)
        if (payload.type === 'notice' && payload.message.includes('屏幕接管已开启')) {
          showControlOverlay()
        }
      },
      requestApproval: async (request) => {
        // The takeover overlay is always-on-top and the low-level hook blocks
        // the physical mouse. Release both before showing an approval dialog.
        releaseControlOverlay()
        const win = state.mainWindow
        if (win && !win.isDestroyed()) {
          win.show()
          win.focus()
          win.moveTop()
        }
        try {
          return await state.approval.request(request, sessionId, sender)
        } finally {
          restoreControlOverlay()
        }
      }
    })

    if (beforeSnapshot) {
      try {
        const afterSnapshot = await snapshotWorkspace(settings.workspace)
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
  }
}

function registerApprovalIpc(): void {
  ipcMain.handle('agent:abort', (_event, runId: string) => {
    const run = activeRuns.get(runId)
    if (!run) return
    run.controller.abort()
    state.approval.cancelRun(runId)
  })

  ipcMain.handle('agent:approve', (_event, requestId: string, decision: ApprovalDecision) => {
    if (!['deny', 'allow', 'always'].includes(decision)) return
    state.approval.decide(requestId, decision)
  })
}

export function registerAgentIpc(): void {
  registerCompactIpc()
  registerRunIpc()
  registerApprovalIpc()
}
