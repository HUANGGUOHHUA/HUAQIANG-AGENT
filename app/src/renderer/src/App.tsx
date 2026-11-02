import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Info,
  LoaderCircle,
  X
} from 'lucide-react'
import type {
  AgentEvent,
  ApiProfile,
  AppInfo,
  AppMessage,
  ApprovalDecision,
  ApprovalRequest,
  AttachmentPayload,
  ChatSession,
  McpStatus,
  ModelInfo,
  ProfileDraft,
  ReasoningEffort,
  ScreenshotResult,
  SessionMeta,
  SessionStats,
  SettingsSaveInput,
  UiSettings,
  Usage
} from '../../shared/types'
import type { SettingsTab } from './components/SettingsModal'
import type { LiveMessage, ToastMessage } from './types'
import { cn, deriveTitle, isImagePath, isTextPreviewPath, stripIpcError, uid } from './lib/utils'
import { mergeStats, mergeUsage } from './lib/usage'
import { compactMessages, parseSlashCommand, sessionMarkdown } from './lib/slash-commands'
import { createZipBytes } from './lib/zip'
import { estimateContextUsage, shouldAutoCompact } from './lib/context-usage'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatHeader from './components/ChatHeader'
import Conversation from './components/Conversation'
import Composer from './components/Composer'
import RightPanel from './components/RightPanel'
import ScreenshotOverlay from './components/ScreenshotOverlay'
import ImageViewer from './components/ImageViewer'
import {
  MAX_ATTACHMENT_IMAGE_CHARS,
  attachmentsImageChars,
  filesToAttachments,
  shrinkImageAttachment
} from './lib/attachments'
import SettingsModal from './components/SettingsModal'
import ApprovalModal from './components/ApprovalModal'
import emblem from './assets/emblem.png'

function createSession(workspace?: string): ChatSession {
  const now = Date.now()
  return {
    id: uid(),
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    messages: [],
    workspace
  }
}

function toSaveInput(settings: UiSettings, overrides: Partial<SettingsSaveInput> = {}): SettingsSaveInput {
  return {
    profiles: settings.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      contextWindow: profile.contextWindow,
      temperature: profile.temperature,
      maxTokens: profile.maxTokens
    })),
    activeProfileId: settings.activeProfileId,
    workspace: settings.workspace,
    elevateOnStart: settings.elevateOnStart,
    agentElevated: settings.agentElevated,
    approvalMode: settings.approvalMode,
    maxSteps: settings.maxSteps,
    mcpServers: settings.mcpServers,
    systemPromptExtra: settings.systemPromptExtra,
    ...overrides
  }
}

function Toast({
  toast,
  onClose
}: {
  toast: ToastMessage
  onClose: () => void
}): React.JSX.Element {
  const Icon = toast.type === 'success' ? CheckCircle2 : toast.type === 'error' ? AlertCircle : Info
  return (
    <div className={cn('app-toast', toast.type)} role="status">
      <Icon size={16} />
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="关闭提示">
        <X size={13} />
      </button>
    </div>
  )
}

export default function App(): React.JSX.Element {
  const initialSession = useRef<ChatSession>(createSession()).current
  const [settings, setSettings] = useState<UiSettings | null>(null)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [session, setSession] = useState<ChatSession>(initialSession)
  const [activeId, setActiveId] = useState(initialSession.id)
  const [booting, setBooting] = useState(true)
  const [bootError, setBootError] = useState('')
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [mcpStatuses, setMcpStatuses] = useState<McpStatus[]>([])
  const [running, setRunning] = useState(false)
  const [compactBusy, setCompactBusy] = useState(false)
  const [live, setLive] = useState<LiveMessage | null>(null)
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [composer, setComposer] = useState('')
  const [attachments, setAttachments] = useState<AttachmentPayload[]>([])
  const [queue, setQueue] = useState<
    Array<{ text: string; attachments: AttachmentPayload[] }>
  >([])
  const [rightOpen, setRightOpen] = useState(false)
  const [panelTabSignal, setPanelTabSignal] = useState<{ tab: 'files' | 'mcp' | 'web'; nonce: number } | null>(null)
  const [fileRequest, setFileRequest] = useState<{ path: string; nonce: number } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('model')
  const [modelPickerModels, setModelPickerModels] = useState<ModelInfo[]>([])
  const [modelPickerLoading, setModelPickerLoading] = useState(false)
  const [modelPickerError, setModelPickerError] = useState('')
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [screenshotShot, setScreenshotShot] = useState<ScreenshotResult | null>(null)
  const [viewingImage, setViewingImage] = useState<string | null>(null)

  const sessionRef = useRef<ChatSession>(initialSession)
  const liveRef = useRef<LiveMessage | null>(null)
  const runIdRef = useRef<string | null>(null)
  const lastRunIdRef = useRef<string | null>(null)
  const liveFlushTimer = useRef<number | null>(null)
  const toastTimer = useRef<number | null>(null)
  const submitRef = useRef<
    (text: string, runAttachments: AttachmentPayload[]) => void
  >(() => undefined)
  const queueBusyRef = useRef(false)
  const autoCompactLockRef = useRef(false)

  const showToast = useCallback((type: ToastMessage['type'], message: string): void => {
    const id = uid()
    setToast({ id, type, message })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current))
    }, 4200)
  }, [])

  const commitSession = useCallback((next: ChatSession): void => {
    sessionRef.current = next
    setSession(next)
    setActiveId(next.id)
  }, [])

  const publishLive = useCallback((next: LiveMessage | null): void => {
    if (liveFlushTimer.current !== null) {
      window.clearTimeout(liveFlushTimer.current)
      liveFlushTimer.current = null
    }
    liveRef.current = next
    setLive(next)
  }, [])

  const scheduleLiveFlush = useCallback((): void => {
    if (liveFlushTimer.current !== null) return
    liveFlushTimer.current = window.setTimeout(() => {
      liveFlushTimer.current = null
      if (liveRef.current) setLive(liveRef.current)
    }, 50)
  }, [])

  const cancelLiveFlush = useCallback((): void => {
    if (liveFlushTimer.current !== null) {
      window.clearTimeout(liveFlushTimer.current)
      liveFlushTimer.current = null
    }
  }, [])

  const persistSession = useCallback(
    async (target: ChatSession): Promise<void> => {
      if (!target.messages.length) return
      try {
        const meta = await window.hq.saveSession(target)
        setSessions((list) =>
          [meta, ...list.filter((item) => item.id !== meta.id)].sort(
            (a, b) => b.updatedAt - a.updatedAt
          )
        )
      } catch (error) {
        showToast('error', `会话保存失败：${stripIpcError(String(error))}`)
      }
    },
    [showToast]
  )

  useEffect(() => {
    return () => cancelLiveFlush()
  }, [cancelLiveFlush])

  useEffect(() => {
    let cancelled = false
    const boot = async (): Promise<void> => {
      try {
        const [loadedSettings, loadedSessions, statuses, info] = await Promise.all([
          window.hq.getSettings(),
          window.hq.listSessions(),
          window.hq.mcpStatuses(),
          window.hq.info()
        ])
        if (cancelled) return
        setSettings(loadedSettings)
        setSessions(loadedSessions)
        setMcpStatuses(statuses)
        setAppInfo(info)
        // DeepSeek Harness style: always open a fresh conversation and choose
        // the workspace on the start screen instead of restoring the last chat.
        commitSession(createSession(loadedSettings.workspace))
      } catch (error) {
        if (!cancelled) setBootError(stripIpcError(String(error)))
      } finally {
        if (!cancelled) setBooting(false)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [commitSession])

  // 浏览器命令由 BrowserPane 执行，这里只负责把面板露出来并切到网页标签
  useEffect(() => {
    const unsubscribe = window.hq.onBrowserCommand?.(() => {
      setRightOpen(true)
      setPanelTabSignal({ tab: 'web', nonce: Date.now() })
    })
    return () => unsubscribe?.()
  }, [])

  // 界面管控命令（来自 app_control 工具）
  useEffect(() => {
    const unsubscribe = window.hq.onAppCommand?.(async (cmd) => {
      const params = cmd.params ?? {}
      try {
        switch (cmd.action) {
          case 'open-panel':
            setRightOpen(true)
            break
          case 'close-panel':
            setRightOpen(false)
            break
          case 'show-tab': {
            const tab = String(params.tab ?? '')
            if (tab === 'files' || tab === 'mcp' || tab === 'web') {
              setRightOpen(true)
              setPanelTabSignal({ tab, nonce: Date.now() })
            } else {
              await window.hq.appControlResult({ id: cmd.id, ok: false, error: '参数 tab 无效' })
              return
            }
            break
          }
          case 'open-settings': {
            const tab = String(params.settingsTab ?? 'model')
            if (tab === 'model' || tab === 'mcp' || tab === 'workspace' || tab === 'about') {
              setSettingsTab(tab)
              setSettingsOpen(true)
            } else {
              await window.hq.appControlResult({ id: cmd.id, ok: false, error: '参数 settingsTab 无效' })
              return
            }
            break
          }
          default:
            await window.hq.appControlResult({ id: cmd.id, ok: false, error: '未知的界面操作' })
            return
        }
        await window.hq.appControlResult({ id: cmd.id, ok: true, data: { done: true } })
      } catch {
        await window.hq.appControlResult({ id: cmd.id, ok: false, error: '界面操作失败' })
      }
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = window.hq.onAgentEvent((event: AgentEvent) => {
      if (event.type === 'mcp-status') {
        setMcpStatuses(event.statuses)
        return
      }
      const isCurrentRun = runIdRef.current === event.runId
      const isLateFinal =
        runIdRef.current === null &&
        lastRunIdRef.current === event.runId &&
        (event.type === 'assistant-end' || event.type === 'run-end')
      if (!isCurrentRun && !isLateFinal) return
      switch (event.type) {
        case 'notice': {
          showToast('info', event.message)
          break
        }
        case 'assistant-start': {
          publishLive({
            id: event.messageId,
            role: 'assistant',
            content: '',
            reasoning: '',
            toolCalls: [],
            createdAt: Date.now()
          })
          break
        }
        case 'text-delta': {
          const current = liveRef.current
          if (current && current.id === event.messageId) {
            liveRef.current = { ...current, content: current.content + event.delta }
            scheduleLiveFlush()
          }
          break
        }
        case 'reasoning-delta': {
          const current = liveRef.current
          if (current && current.id === event.messageId) {
            liveRef.current = { ...current, reasoning: current.reasoning + event.delta }
            scheduleLiveFlush()
          }
          break
        }
        case 'tool-draft': {
          const current = liveRef.current
          if (current && current.id === event.messageId) {
            liveRef.current = {
              ...current,
              toolDraft: { name: event.name, chars: event.chars }
            }
            scheduleLiveFlush()
          }
          break
        }
        case 'tool-start': {
          const current = liveRef.current
          if (!current || current.id !== event.messageId) break
          if (current.toolCalls.some((call) => call.id === event.callId)) break
          publishLive({
            ...current,
            toolDraft: undefined,
            toolCalls: [
              ...current.toolCalls,
              {
                id: event.callId,
                name: event.name,
                displayName: event.displayName,
                risk: event.risk,
                args: event.args,
                status: 'running',
                startedAt: Date.now()
              }
            ]
          })
          break
        }
        case 'tool-output': {
          const current = liveRef.current
          if (!current || current.id !== event.messageId) break
          publishLive({
            ...current,
            toolCalls: current.toolCalls.map((call) =>
              call.id === event.callId
                ? { ...call, result: `${call.result ?? ''}${event.delta}` }
                : call
            )
          })
          break
        }
        case 'tool-end': {
          const current = liveRef.current
          if (!current || current.id !== event.messageId) break
          publishLive({
            ...current,
            toolCalls: current.toolCalls.map((call) =>
              call.id === event.callId
                ? {
                    ...call,
                    status: event.status,
                    result: event.result,
                    isError: event.isError,
                    stats: event.stats,
                    endedAt: Date.now()
                  }
                : call
            )
          })
          break
        }
        case 'assistant-end': {
          const current = sessionRef.current
          const alreadySaved = current.messages.some((message) => message.id === event.message.id)
          const next: ChatSession = {
            ...current,
            title:
              current.title === '新对话' && current.messages.some((message) => message.role === 'user')
                ? deriveTitle(current.messages.find((message) => message.role === 'user')?.content ?? '')
                : current.title,
            messages: alreadySaved
              ? current.messages.map((message) =>
                  message.id === event.message.id ? event.message : message
                )
              : [...current.messages, event.message],
            updatedAt: Date.now()
          }
          commitSession(next)
          publishLive(null)
          // Persist as soon as the assistant message is complete, not only when
          // the whole run finishes, so a crash/close cannot drop the reply.
          void persistSession(next)
          break
        }
        case 'approval-request':
          setApproval(event.request)
          break
        case 'approval-closed':
          setApproval((current) => (current?.id === event.requestId ? null : current))
          break
        case 'usage':
          setUsage(event.usage)
          break
        case 'context-compressed':
          showToast('info', `上下文过长，已压缩 ${event.dropped} 条较早消息`)
          break
        case 'run-end': {
          const pending = liveRef.current
          const currentSession = sessionRef.current
          const sessionWithUsage: ChatSession = {
            ...currentSession,
            tokenUsage: mergeUsage(currentSession.tokenUsage, event.usage),
            stats: mergeStats(currentSession.stats, event.stats)
          }
          const hasPendingMessage =
            pending &&
            !currentSession.messages.some((message) => message.id === pending.id) &&
            (pending.content.trim() ||
              (pending.reasoning ?? '').trim() ||
              pending.toolCalls.length > 0)
          if (pending && hasPendingMessage) {
            const next: ChatSession = {
              ...sessionWithUsage,
              title:
                currentSession.title === '新对话' &&
                currentSession.messages.some((message) => message.role === 'user')
                  ? deriveTitle(
                      currentSession.messages.find((message) => message.role === 'user')?.content ??
                        ''
                    )
                  : currentSession.title,
              messages: [...currentSession.messages, pending],
              updatedAt: Date.now()
            }
            commitSession(next)
            void persistSession(next)
          } else if (event.usage || event.stats) {
            commitSession(sessionWithUsage)
            void persistSession(sessionWithUsage)
          }
          setRunning(false)
          publishLive(null)
          setApproval(null)
          const currentRun = runIdRef.current
          runIdRef.current = null
          if (event.status === 'aborted') {
            showToast('info', '任务已停止')
            setRunError(null)
          } else if (event.status === 'error') {
            const last = sessionRef.current.messages[sessionRef.current.messages.length - 1]
            if (!last?.error) setRunError(event.error ?? '运行未完成')
          } else {
            setRunError(null)
          }
          if (event.usage) setUsage(event.usage)
          if (currentRun) void persistSession(sessionRef.current)
          break
        }
        case 'run-start':
          break
      }
    })
    return unsubscribe
  }, [commitSession, persistSession, showToast])

  const activeProfile: ApiProfile | undefined =
    settings?.profiles.find((profile) => profile.id === settings.activeProfileId) ??
    settings?.profiles[0]

  const contextUsage = useMemo(
    () =>
      estimateContextUsage({
        messages: session.messages,
        contextSummary: session.contextSummary,
        systemPromptExtra: settings?.systemPromptExtra,
        attachments,
        contextWindow: session.modelContextWindow ?? activeProfile?.contextWindow
      }),
    [
      session.messages,
      session.contextSummary,
      session.modelContextWindow,
      settings?.systemPromptExtra,
      attachments,
      activeProfile?.contextWindow
    ]
  )

  const conversationStats = useMemo<SessionStats | undefined>(() => {
    const turns = session.messages.filter((message) => message.role === 'user').length
    const steps = session.messages.filter((message) => message.role === 'assistant').length
    if (session.stats) {
      return {
        ...session.stats,
        turns: Math.max(session.stats.turns, turns),
        steps: Math.max(session.stats.steps, steps)
      }
    }
    if (!turns && !steps) return undefined
    return {
      turns,
      steps,
      llmMs: 0,
      toolMs: 0,
      ttftMs: 0,
      ttftSteps: 0,
      decodeMs: 0,
      outputTokens: 0
    }
  }, [session.messages, session.stats])

  const openModelPicker = (): void => {
    if (!activeProfile) {
      showToast('info', '请先在设置中配置模型接口')
      openSettings('model')
      return
    }
    if (!activeProfile.baseUrl.trim()) {
      showToast('info', '请先在设置中填写 Base URL')
      openSettings('model')
      return
    }
    setModelPickerLoading(true)
    setModelPickerError('')
    const profileDraft: ProfileDraft = {
      id: activeProfile.id,
      name: activeProfile.name,
      provider: activeProfile.provider,
      baseUrl: activeProfile.baseUrl,
      model: activeProfile.model,
      contextWindow: activeProfile.contextWindow,
      temperature: activeProfile.temperature,
      maxTokens: activeProfile.maxTokens
    }
    void window.hq
      .listProfileModels({ profile: profileDraft })
      .then((result) => {
        if (!result.ok) {
          setModelPickerError(result.message)
          setModelPickerModels([])
          return
        }
        setModelPickerModels(
          result.modelDetails ?? (result.models ?? []).map((id) => ({ id }) as ModelInfo)
        )
      })
      .catch((error) => {
        setModelPickerError(stripIpcError(error instanceof Error ? error.message : String(error)))
      })
      .finally(() => setModelPickerLoading(false))
  }

  const selectSessionModel = (model: ModelInfo): void => {
    const next: ChatSession = {
      ...sessionRef.current,
      model: model.id,
      modelContextWindow: model.contextWindow,
      modelMaxTokens: model.maxOutputTokens,
      modelVision: model.vision,
      updatedAt: Date.now()
    }
    commitSession(next)
    void persistSession(next)
    showToast('success', `本会话已切换到 ${model.id}`)
  }

  const selectReasoning = (effort: ReasoningEffort | undefined): void => {
    const next: ChatSession = {
      ...sessionRef.current,
      reasoningEffort: effort,
      updatedAt: Date.now()
    }
    commitSession(next)
    void persistSession(next)
  }

  const saveSettings = async (input: SettingsSaveInput): Promise<UiSettings | null> => {
    try {
      const updated = await window.hq.saveSettings(input)
      setSettings(updated)
      return updated
    } catch (error) {
      showToast('error', stripIpcError(error instanceof Error ? error.message : String(error)))
      return null
    }
  }

  // Route by file type: images open the built-in viewer, Office/other binary
  // files open with the system default app, text/code opens the side panel.
  const openWorkspaceFile = (path: string): void => {
    if (isImagePath(path)) {
      void window.hq
        .workspaceReadAsset(path)
        .then((asset) => setViewingImage(asset.dataUrl))
        .catch((error) => showToast('error', stripIpcError(String(error))))
      return
    }
    if (isTextPreviewPath(path)) {
      setRightOpen(true)
      setFileRequest({ path, nonce: Date.now() })
      return
    }
    // Office/binary files open a preview card in the side panel with explicit
    // "open with default app" / "choose app" actions.
    setRightOpen(true)
    setFileRequest({ path, nonce: Date.now() })
  }

  const openWorkspaceFiles = (): void => {
    setRightOpen(true)
    setFileRequest({ path: '', nonce: Date.now() })
  }

  // Attachments use a stable key: real files keep their full path, pasted or
  // dropped blobs get an `id`, so same-named files from different folders never
  // collide when adding or removing.
  const attachmentKeyOf = (item: AttachmentPayload): string => item.id ?? item.path

  const addAttachments = (incoming: AttachmentPayload[]): number => {
    const current = attachments
    const next = [...current]
    let added = 0
    let imageChars = attachmentsImageChars(current)
    for (const item of incoming) {
      if (next.length >= 8) break
      const prepared = item.id ? item : { ...item, id: uid() }
      // Blob-backed items carry a unique id; real files are deduped by their
      // absolute path so the same file is not added twice, while files with
      // identical names in different folders stay independent.
      const duplicate = item.id
        ? next.some((existing) => attachmentKeyOf(existing) === item.id)
        : next.some((existing) => existing.path === item.path)
      if (duplicate) continue
      const itemChars =
        prepared.kind === 'image' && prepared.dataUrl ? prepared.dataUrl.length : 0
      if (imageChars + itemChars > MAX_ATTACHMENT_IMAGE_CHARS) continue
      next.push(prepared)
      imageChars += itemChars
      added += 1
    }
    if (added > 0) setAttachments(next)
    return added
  }

  const pickAttachments = async (): Promise<void> => {
    try {
      const picked = await window.hq.pickAttachments()
      if (!picked.length) return
      const added = addAttachments(picked)
      showToast(
        added > 0 ? 'success' : 'info',
        added > 0 ? `已附加 ${added} 个文件` : '这些文件已在附件里，或附件已满 8 个'
      )
    } catch (error) {
      showToast('error', stripIpcError(String(error)))
    }
  }

  const pasteFromClipboard = async (files: File[]): Promise<void> => {
    if (!files.length) return
    try {
      const items = await filesToAttachments(files)
      if (!items.length) {
        showToast('error', '粘贴的内容无法识别为图片或文本文件')
        return
      }
      const added = addAttachments(items)
      showToast(
        added > 0 ? 'success' : 'info',
        added > 0 ? `已附加 ${added} 个粘贴内容` : '粘贴内容已在附件里，或附件已满 8 个'
      )
    } catch (error) {
      showToast('error', stripIpcError(String(error)))
    }
  }

  const dropFiles = async (files: File[]): Promise<void> => {
    if (!files.length) return
    const paths: string[] = []
    const blobs: File[] = []
    for (const file of files) {
      let path = ''
      try {
        path = window.hq.filePath(file)
      } catch {
        path = ''
      }
      if (path) paths.push(path)
      else blobs.push(file)
    }
    if (paths.length > 0) {
      try {
        const { attachments: dropped, errors } = await window.hq.readDroppedAttachments(paths)
        const prepared = await Promise.all(dropped.map(shrinkImageAttachment))
        const added = addAttachments(prepared)
        if (added > 0) {
          showToast('success', `已附加 ${added} 个文件`)
        } else if (errors.length > 0) {
          showToast('error', `无法读取：${errors[0]}`)
        } else if (prepared.length > 0) {
          showToast('info', '这些文件已在附件里，或附件已满 8 个')
        }
      } catch (error) {
        showToast('error', stripIpcError(String(error)))
      }
    }
    if (blobs.length > 0) {
      const items = await filesToAttachments(blobs)
      if (items.length) {
        const added = addAttachments(items)
        if (added > 0) showToast('success', `已附加 ${added} 个文件`)
      }
    }
  }

  const dropFilesRef = useRef<(files: File[]) => void>(() => undefined)
  dropFilesRef.current = (files: File[]) => {
    void dropFiles(files)
  }

  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      const types = Array.from(event.dataTransfer?.types ?? [])
      if (!types.includes('Files')) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (event: DragEvent): void => {
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (!files.length) return
      event.preventDefault()
      dropFilesRef.current(files)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  const insertQuickCommand = (command: string): void => {
    setComposer(command)
    requestAnimationFrame(() => document.getElementById('composer-input')?.focus())
  }

  const captureScreenshot = async (): Promise<void> => {
    try {
      const shot = await window.hq.captureScreenshot()
      if (!shot) {
        showToast('error', '截图失败：无法获取屏幕画面')
        return
      }
      setScreenshotShot(shot)
    } catch (error) {
      showToast('error', stripIpcError(String(error)))
    }
  }

  const appendScreenshot = (dataUrl: string): void => {
    const stamp = new Date()
    const label = `截图-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}${String(stamp.getSeconds()).padStart(2, '0')}`
    const item: AttachmentPayload = {
      path: `${label}.png`,
      kind: 'image',
      mime: 'image/png',
      dataUrl,
      size: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
    }
    addAttachments([item])
    setScreenshotShot(null)
    showToast('success', '已附加截图')
  }

  const attachFile = async (path: string): Promise<void> => {    try {
      const isImage = /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(path)
      const isPdf = /\.pdf$/i.test(path)
      if (isPdf) {
        const extracted = await window.hq.workspaceExtract(path)
        if (!extracted.text.trim()) {
          showToast('info', 'PDF 没有可提取的文本（可能是扫描版），已作为文件引用附加')
          addAttachments([{ path, kind: 'binary', mime: 'application/pdf' }])
          return
        }
        const content = `--- PDF 提取文本：${path} ---\n${extracted.text.slice(0, 120_000)}`
        addAttachments([{ path, kind: 'text', content, mime: 'application/pdf' }])
        showToast(
          'success',
          `已提取 PDF 文本 ${path}${extracted.truncated || extracted.text.length > 120_000 ? '（已截断）' : ''}`
        )
        return
      }
      if (isImage) {
        const asset = await window.hq.workspaceReadAsset(path)
        const effectiveVision = sessionRef.current.modelVision ?? activeProfile?.vision
        let ocrText = ''
        try {
          const ocr = await window.hq.workspaceOcr(path)
          ocrText = ocr.text
        } catch {
          // Keep the image as a reference if OCR is unavailable.
        }
        addAttachments([
          {
            path,
            kind: 'image',
            dataUrl: asset.dataUrl,
            mime: asset.mime,
            size: asset.size,
            ocrText: ocrText || undefined
          }
        ])
        showToast(
          effectiveVision === true
            ? 'success'
            : ocrText
              ? 'success'
              : 'info',
          effectiveVision === true
            ? `已附加图片 ${path}`
            : ocrText
              ? `已附加图片 ${path}，当前模型无视觉，已准备 OCR 文本`
              : `已附加图片 ${path}，当前模型无视觉且 OCR 不可用，将作为文件引用`
        )
        return
      }
      const file = await window.hq.workspaceRead(path)
      if (file.binary) {
        const asset = await window.hq.workspaceReadAsset(path)
        setAttachments((current) =>
          current.some((item) => item.path === path)
            ? current
            : [
                ...current,
                {
                  path,
                  kind: 'binary',
                  mime: asset.mime,
                  size: asset.size
                }
              ]
        )
        showToast('info', `已附加二进制文件 ${path}（仅提供文件引用）`)
        return
      }
      const content = file.content.slice(0, 120_000)
      setAttachments((current) =>
        current.some((item) => item.path === path)
          ? current
          : [...current, { path, kind: 'text', content, size: file.size }]
      )
      showToast(
        'success',
        `已附加 ${path}${file.content.length > content.length ? '（内容已截断）' : ''}`
      )
    } catch (error) {
      showToast('error', `读取文件失败：${stripIpcError(String(error))}`)
    }
  }

  const exportSession = (): void => {
    const current = sessionRef.current
    const markdown = sessionMarkdown({
      title: current.title,
      workspace: current.workspace ?? settings?.workspace,
      messages: current.messages,
      contextSummary: current.contextSummary,
      contextInstruction: current.contextInstruction
    })
    const name = (current.title || '华强以太会话').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60)
    const zipBytes = createZipBytes(`${name}.md`, markdown)
    const zipBuffer = zipBytes.buffer.slice(
      zipBytes.byteOffset,
      zipBytes.byteOffset + zipBytes.byteLength
    ) as ArrayBuffer
    const blob = new Blob([zipBuffer], {
      type: 'application/zip'
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${name}.zip`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1500)
    showToast('success', '会话已导出为 ZIP（内含 Markdown 日志）')
  }

  const compactChat = async (instruction: string): Promise<void> => {
    const current = sessionRef.current
    const result = compactMessages(current.messages, instruction, {
      contextWindow: current.modelContextWindow ?? activeProfile?.contextWindow,
      maxOutputTokens: current.modelMaxTokens ?? activeProfile?.maxTokens,
      priorSummary: current.contextSummary,
      force: true
    })
    if (!result) {
      showToast('info', '至少需要两条消息（一问一答）才能压缩')
      return
    }
    setCompactBusy(true)
    showToast('info', '正在用当前模型压缩上下文…')
    let summary = result.summary
    let usedModel = false
    if (result.older.length >= 2) {
      try {
        const remote = await window.hq.compactConversation({
          messages: result.older,
          instruction,
          model: current.model,
          priorSummary: current.contextSummary
        })
        if (remote.ok && remote.summary) {
          summary = [
            'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it.',
            '',
            '<compacted-summary>',
            remote.summary,
            '</compacted-summary>'
          ].join('\n')
          usedModel = true
        } else if (remote.error) {
          showToast('info', `模型摘要失败，已使用本地摘要：${stripIpcError(remote.error)}`)
        }
      } catch (error) {
        showToast('info', `模型摘要失败，已使用本地摘要：${stripIpcError(String(error))}`)
      } finally {
        setCompactBusy(false)
      }
    } else {
      setCompactBusy(false)
    }
    const next: ChatSession = {
      ...sessionRef.current,
      messages: result.messages,
      contextSummary: summary.slice(0, 20_000),
      contextInstruction: instruction.trim() || current.contextInstruction,
      updatedAt: Date.now()
    }
    commitSession(next)
    await persistSession(next)
    showToast('success', `已压缩 ${result.removed} 条较早消息${usedModel ? '（模型摘要）' : '（本地摘要）'}`)
  }

  useEffect(() => {
    if (running || compactBusy || !settings || !activeProfile) return
    if (!shouldAutoCompact(contextUsage, session.messages.length, autoCompactLockRef.current, queue.length > 0)) {
      return
    }
    autoCompactLockRef.current = true
    showToast(
      'info',
      `上下文容量约 ${Math.round(contextUsage.percent)}%，已自动触发压缩…`
    )
    void compactChat(
      '自动压缩：保留代码改动、关键决策、错误信息和未完成任务，删除重复的中间过程。'
    )
  }, [
    running,
    compactBusy,
    settings,
    activeProfile,
    queue.length,
    contextUsage.percent,
    session.messages.length
  ])

  const runSlashCommand = (text: string): void => {
    const parsed = parseSlashCommand(text)
    if (!parsed) return
    setComposer('')
    if (parsed.name === 'compact') {
      void compactChat(parsed.args)
      return
    }
    if (parsed.name === 'model') {
      openModelPicker()
      return
    }
    if (parsed.name === 'export') {
      exportSession()
      return
    }
    if (parsed.name === 'file') {
      if (parsed.args) {
        void attachFile(parsed.args)
      } else {
        openWorkspaceFiles()
        showToast('info', '在右侧工作区选择要打开的文件，或输入 /file 路径 附加文件')
      }
      return
    }
    if (parsed.name === 'help') {
      showToast('info', '可用指令：/compact [说明] · /model · /export · /file [路径]')
      return
    }
    showToast('info', `未知指令 /${parsed.name}，在输入框开头输入 / 查看可用指令`)
  }

  const beginRun = (
    next: ChatSession,
    runAttachments: AttachmentPayload[]
  ): void => {
    autoCompactLockRef.current = false
    commitSession(next)
    setComposer('')
    setAttachments([])
    setRunError(null)
    setUsage(null)
    setApproval(null)
    publishLive(null)
    setRunning(true)

    const runId = uid()
    runIdRef.current = runId
    lastRunIdRef.current = runId
    void persistSession(next)

    window.hq
      .runAgent({
        runId,
        sessionId: next.id,
        // Attachments of this turn are sent separately; historical image data
        // only needs to stay in the UI/session, not in every IPC payload.
        messages: next.messages.map(({ attachments: _attachments, ...rest }) => rest),
        model: next.model,
        contextWindow: next.modelContextWindow,
        maxTokens: next.modelMaxTokens,
        vision: next.modelVision,
        reasoningEffort: next.reasoningEffort,
        attachments: runAttachments,
        contextSummary: next.contextSummary
      })
      .then((result) => {
        if (runIdRef.current !== runId && lastRunIdRef.current !== runId) return
        // Keep runIdRef/live until run-end/assistant-end arrives; this avoids
        // dropping the final reply when the promise resolves first.
        if (!result.ok && !result.aborted) {
          setRunError(result.error ?? '运行未完成')
        }
        if (result.workspaceChanges && sessionRef.current.id === next.id) {
          const withChanges: ChatSession = {
            ...sessionRef.current,
            lastChanges: result.workspaceChanges,
            updatedAt: Date.now()
          }
          commitSession(withChanges)
          void persistSession(withChanges)
        } else {
          void persistSession(sessionRef.current)
        }
        // Fallback if the run-end event was lost.
        window.setTimeout(() => {
          if (runIdRef.current === runId) setRunning(false)
        }, 1200)
      })
      .catch((error) => {
        if (runIdRef.current !== runId) return
        runIdRef.current = null
        setRunning(false)
        publishLive(null)
        setRunError(stripIpcError(error instanceof Error ? error.message : String(error)))
        void persistSession(sessionRef.current)
      })
  }

  const submitMessage = (
    text: string,
    runAttachments: AttachmentPayload[]
  ): void => {
    if (!settings) return
    if (!activeProfile || !activeProfile.baseUrl.trim() || !activeProfile.model.trim()) {
      showToast('info', '请先在设置中填写 Base URL 并读取或填写 Model ID')
      openSettings('model')
      return
    }
    const userMessage: AppMessage = {
      id: uid(),
      role: 'user',
      content: text,
      createdAt: Date.now(),
      attachments: runAttachments.length ? runAttachments : undefined
    }
    const current = sessionRef.current
    const next: ChatSession = {
      ...current,
      workspace: settings.workspace,
      title: current.messages.length
        ? current.title
        : text.trim()
          ? deriveTitle(text)
          : '图片附件',
      messages: [...current.messages, userMessage],
      lastChanges: undefined,
      updatedAt: Date.now()
    }
    beginRun(next, runAttachments)
  }

  submitRef.current = submitMessage

  const sendMessage = (): void => {
    const text = composer.trim()
    if ((!text && attachments.length === 0) || !settings) return
    if (running) {
      if (text.startsWith('/')) {
        showToast('info', '任务运行中暂不能执行指令')
        return
      }
      setQueue((current) => [...current, { text, attachments }])
      setComposer('')
      setAttachments([])
      showToast('info', '已加入队列，当前任务结束后自动发送')
      return
    }
    if (compactBusy) {
      showToast('info', '正在压缩上下文，请稍候')
      return
    }
    if (text.startsWith('/')) {
      runSlashCommand(text)
      return
    }
    submitMessage(text, attachments)
  }

  useEffect(() => {
    if (queueBusyRef.current || running || compactBusy || !settings || queue.length === 0) return
    queueBusyRef.current = true
    const first = queue[0]
    setQueue((current) => current.slice(1))
    submitRef.current(first.text, first.attachments)
    window.setTimeout(() => {
      queueBusyRef.current = false
    }, 0)
  }, [running, compactBusy, settings, queue])

  const retryLast = (): void => {
    if (running || compactBusy) {
      showToast('info', '请先等待当前任务结束')
      return
    }
    const messages = sessionRef.current.messages
    let index = -1
    for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
      if (messages[cursor].role === 'user') {
        index = cursor
        break
      }
    }
    if (index < 0) {
      showToast('info', '没有可重试的用户消息')
      return
    }
    const next: ChatSession = {
      ...sessionRef.current,
      messages: messages.slice(0, index + 1),
      lastChanges: undefined,
      updatedAt: Date.now()
    }
    beginRun(next, [])
  }

  const stopRun = (): void => {
    const runId = runIdRef.current
    if (!runId) return
    if (queue.length) {
      setQueue([])
      showToast('info', '正在停止任务，已清空排队消息…')
    } else {
      showToast('info', '正在停止任务…')
    }
    void window.hq
      .abortAgent(runId)
      .catch((error) => showToast('error', stripIpcError(String(error))))
    window.setTimeout(() => {
      if (runIdRef.current === runId) {
        runIdRef.current = null
        setRunning(false)
        publishLive(null)
        setApproval(null)
        setRunError('任务已请求停止')
      }
    }, 8000)
  }

  const decideApproval = (decision: ApprovalDecision): void => {
    const request = approval
    setApproval(null)
    if (request)
      void window.hq
        .approveTool(request.id, decision)
        .catch((error) => showToast('error', stripIpcError(String(error))))
  }

  const newChat = (): void => {
    if (running || compactBusy) {
      showToast('info', running ? '请先停止当前任务' : '正在压缩上下文，请稍候')
      return
    }
    autoCompactLockRef.current = false
    const next = createSession(settings?.workspace)
    commitSession(next)
    setComposer('')
    setAttachments([])
    publishLive(null)
    setRunError(null)
    setUsage(null)
    setApproval(null)
    requestAnimationFrame(() => document.getElementById('composer-input')?.focus())
  }

  const selectSession = async (id: string): Promise<void> => {
    if (running || compactBusy) {
      showToast('info', running ? '请先停止当前任务' : '正在压缩上下文，请稍候')
      return
    }
    if (id === activeId) return
    try {
      const loaded = await window.hq.loadSession(id)
      if (!loaded) {
        showToast('error', '会话不存在或已损坏')
        return
      }
      if (settings && loaded.workspace && loaded.workspace !== settings.workspace) {
        const updated = await saveSettings(toSaveInput(settings, { workspace: loaded.workspace }))
        if (!updated) return
      }
      commitSession(loaded)
      autoCompactLockRef.current = false
      setAttachments([])
      publishLive(null)
      setRunError(null)
      setUsage(null)
      setApproval(null)
    } catch (error) {
      showToast('error', stripIpcError(String(error)))
    }
  }

  const deleteSession = async (id: string): Promise<void> => {
    if (running || compactBusy) {
      showToast('info', '任务运行或压缩中不能删除会话')
      return
    }
    if (!window.confirm('确定删除这个会话吗？此操作不可恢复。')) return
    try {
      await window.hq.deleteSession(id)
      const remaining = sessions.filter((item) => item.id !== id)
      setSessions(remaining)
      if (id === activeId) {
        if (remaining.length) await selectSession(remaining[0].id)
        else newChat()
      }
      showToast('success', '会话已删除')
    } catch (error) {
      showToast('error', stripIpcError(String(error)))
    }
  }

  const chooseWorkspace = async (): Promise<void> => {
    if (!settings || running) {
      if (running) showToast('info', '请先停止当前任务')
      return
    }
    const path = await window.hq.chooseWorkspace()
    if (!path) return
    const updated = await saveSettings(toSaveInput(settings, { workspace: path }))
    if (updated) showToast('success', '工作区已切换')
  }

  const setApprovalMode = async (next: 'ask' | 'auto'): Promise<void> => {
    if (!settings || running) {
      if (running) showToast('info', '任务运行中不能修改权限策略')
      return
    }
    if (settings.approvalMode === next) return
    const updated = await saveSettings(toSaveInput(settings, { approvalMode: next }))
    if (updated) {
      showToast(
        next === 'ask' ? 'success' : 'info',
        next === 'ask' ? '已切换为执行前确认' : '已切换为自动执行，请谨慎使用'
      )
    }
  }

  const openSettings = (tab: SettingsTab = 'model'): void => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }

  const onSettingsSaved = (updated: UiSettings): void => {
    setSettings(updated)
    setSettingsOpen(false)
    showToast('success', '设置已保存')
    window.setTimeout(() => {
      void window.hq.mcpStatuses().then(setMcpStatuses).catch(() => undefined)
    }, 700)
    window.setTimeout(() => {
      void window.hq.mcpStatuses().then(setMcpStatuses).catch(() => undefined)
    }, 2800)
  }

  const refreshMcp = async (): Promise<void> => {
    showToast('info', '正在重新连接 MCP 服务…')
    try {
      const statuses = await window.hq.mcpRestart()
      setMcpStatuses(statuses)
      showToast('success', 'MCP 服务已刷新')
    } catch (error) {
      showToast('error', stripIpcError(String(error)))
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      if (event.key.toLowerCase() === 'n' && !settingsOpen && !approval) {
        event.preventDefault()
        newChat()
      }
      if (event.key === ',' && !settingsOpen) {
        event.preventDefault()
        openSettings('model')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (booting) {
    return (
      <div className="boot-screen">
        <TitleBar />
        <div className="boot-center">
          <div className="boot-logo-ring">
            <img src={emblem} alt="华强职校校徽" />
          </div>
          <h1>华强以太</h1>
          <p>华而实，善则强</p>
          <span className="boot-loading">
            <LoaderCircle size={15} className="spin" /> 正在准备本地工作台…
          </span>
        </div>
      </div>
    )
  }

  if (!settings || bootError) {
    return (
      <div className="boot-screen">
        <TitleBar />
        <div className="boot-center">
          <div className="boot-logo-ring">
            <img src={emblem} alt="" />
          </div>
          <h1>无法启动工作台</h1>
          <p>{bootError || '设置加载失败'}</p>
          <button type="button" className="btn primary" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <TitleBar />
      <div className="app-shell">
        <Sidebar
          sessions={sessions}
          activeSessionId={activeId}
          settings={settings}
          running={running}
          appVersion={appInfo?.version ?? '1.0.0'}
          onNewChat={newChat}
          onSelectSession={(id) => void selectSession(id)}
          onDeleteSession={(id) => void deleteSession(id)}
          onOpenSettings={() => openSettings('model')}
          onChooseWorkspace={() => void chooseWorkspace()}
        />

        <main className="main-panel">
          <ChatHeader
            title={session.title === '新对话' ? '新的对话' : session.title}
            settings={settings}
            running={running}
            rightOpen={rightOpen}
            onToggleRight={() => setRightOpen((value) => !value)}
            onOpenSettings={() => openSettings('model')}
            onChooseWorkspace={() => void chooseWorkspace()}
          />
          <div className="chat-stage">
            <Conversation
              messages={session.messages}
              live={live}
              running={running}
              activeProfile={activeProfile}
              runError={runError}
              usage={running ? usage : (session.tokenUsage ?? usage)}
              stats={conversationStats}
              contextSummary={session.contextSummary}
              contextInstruction={session.contextInstruction}
              lastChanges={session.lastChanges}
              onDismissError={() => setRunError(null)}
              onRetry={retryLast}
              onOpenSettings={() => openSettings('model')}
              onOpenFile={openWorkspaceFile}
              onOpenImage={setViewingImage}
            />
            <Composer
              value={composer}
              running={running}
              busy={compactBusy}
              activeProfile={activeProfile}
              sessionModel={session.model}
              attachments={attachments}
              queue={queue}
              models={modelPickerModels}
              modelsLoading={modelPickerLoading}
              modelsError={modelPickerError}
              reasoningEffort={session.reasoningEffort}
              contextUsage={contextUsage}
              approvalMode={settings.approvalMode}
              elevated={appInfo?.elevated ?? false}
              showStartPanel={session.messages.length === 0}
              workspace={settings.workspace}
              onChooseWorkspace={() => void chooseWorkspace()}
              onChange={setComposer}
              onSend={sendMessage}
              onStop={stopRun}
              onOpenModelPicker={openModelPicker}
              onSelectModel={selectSessionModel}
              onOpenModelSettings={() => openSettings('model')}
              onSetReasoning={selectReasoning}
              onSetApproval={(mode) => void setApprovalMode(mode)}
              onPickAttachments={() => void pickAttachments()}
              onPasteAttachments={(files) => void pasteFromClipboard(files)}
              onScreenshot={() => void captureScreenshot()}
              onInsertCommand={insertQuickCommand}
              onRemoveAttachment={(key) =>
                setAttachments((current) =>
                  current.filter((item) => attachmentKeyOf(item) !== key)
                )
              }
              onRemoveQueued={(index) =>
                setQueue((current) => current.filter((_, cursor) => cursor !== index))
              }
            />
          </div>
        </main>

        <RightPanel
          key={settings.workspace}
          settings={settings}
          statuses={mcpStatuses}
          fileRequest={fileRequest}
          tabSignal={panelTabSignal}
          hidden={!rightOpen}
          onClose={() => setRightOpen(false)}
          onOpenSettings={(tab) => openSettings(tab)}
          onRefreshMcp={() => void refreshMcp()}
          onNotify={showToast}
        />
      </div>

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          initialTab={settingsTab}
          appVersion={appInfo?.version ?? '1.0.0'}
          statuses={mcpStatuses}
          onClose={() => setSettingsOpen(false)}
          onSaved={onSettingsSaved}
        />
      )}

      {approval && <ApprovalModal request={approval} onDecision={decideApproval} />}

      {screenshotShot && (
        <ScreenshotOverlay
          shot={screenshotShot}
          onCancel={() => setScreenshotShot(null)}
          onConfirm={appendScreenshot}
        />
      )}

      {viewingImage && <ImageViewer dataUrl={viewingImage} onClose={() => setViewingImage(null)} />}

      {toast && (
        <Toast
          toast={toast}
          onClose={() => {
            setToast(null)
            if (toastTimer.current) window.clearTimeout(toastTimer.current)
          }}
        />
      )}
    </div>
  )
}
