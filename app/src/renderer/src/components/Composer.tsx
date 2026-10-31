import { useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Check,
  ChevronUp,
  Cpu,
  ChevronRight,
  Download,
  FileText,
  FolderOpen,
  HelpCircle,
  KeyRound,
  Paperclip,
  Plus,
  Scissors,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  X
} from 'lucide-react'
import type {
  ApiProfile,
  ApprovalMode,
  AttachmentPayload,
  ModelInfo,
  ReasoningEffort
} from '../../../shared/types'
import {
  filterCommands,
  type SlashCommandDefinition
} from '../lib/slash-commands'
import type { ContextUsage } from '../lib/context-usage'
import { cn, baseName } from '../lib/utils'
import ContextRing from './ContextRing'

interface ComposerProps {
  value: string
  running: boolean
  busy?: boolean
  activeProfile?: ApiProfile
  sessionModel?: string
  attachments?: AttachmentPayload[]
  queue?: Array<{ text: string; attachments: AttachmentPayload[] }>
  models?: ModelInfo[]
  modelsLoading?: boolean
  modelsError?: string
  reasoningEffort?: ReasoningEffort
  contextUsage?: ContextUsage
  approvalMode: ApprovalMode
  elevated?: boolean
  showStartPanel?: boolean
  workspace?: string
  onChooseWorkspace?: () => void
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  onOpenModelPicker: () => void
  onSelectModel: (model: ModelInfo) => void
  onOpenModelSettings: () => void
  onSetReasoning: (effort: ReasoningEffort | undefined) => void
  onSetApproval: (mode: 'ask' | 'auto') => void
  onPickAttachments: () => void
  onPasteAttachments: (files: File[]) => void
  onScreenshot: () => void
  onInsertCommand: (command: string) => void
  onRemoveAttachment: (path: string) => void
  onRemoveQueued: (index: number) => void
}

function formatTokenShort(value?: number): string {
  if (!value || value <= 0) return '上下文未知'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}

function CommandIcon({ name }: { name: string }): React.JSX.Element {
  if (name === 'compact') return <Sparkles size={14} />
  if (name === 'model') return <Cpu size={14} />
  if (name === 'export') return <Download size={14} />
  if (name === 'file') return <FileText size={14} />
  return <HelpCircle size={14} />
}


function splitScriptRuns(text: string): Array<{ latin: boolean; value: string }> {
  const runs: Array<{ latin: boolean; value: string }> = []
  for (const ch of text) {
    const latin = ch.charCodeAt(0) < 128
    const last = runs[runs.length - 1]
    if (last && last.latin === latin) last.value += ch
    else runs.push({ latin, value: ch })
  }
  return runs
}

function MixedText({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {splitScriptRuns(text).map((run, index) =>
        run.latin ? (
          <span className="latin-run" key={index}>
            {run.value}
          </span>
        ) : (
          <span key={index}>{run.value}</span>
        )
      )}
    </>
  )
}

export default function Composer({
  value,
  running,
  busy = false,
  activeProfile,
  sessionModel,
  attachments = [],
  queue = [],
  models = [],
  modelsLoading = false,
  modelsError = '',
  reasoningEffort,
  contextUsage,
  approvalMode,
  elevated = false,
  showStartPanel = false,
  workspace = '',
  onChooseWorkspace,
  onChange,
  onSend,
  onStop,
  onOpenModelPicker,
  onSelectModel,
  onOpenModelSettings,
  onSetReasoning,
  onSetApproval,
  onPickAttachments,
  onPasteAttachments,
  onScreenshot,
  onInsertCommand,
  onRemoveAttachment,
  onRemoveQueued
}: ComposerProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuDismissed, setMenuDismissed] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)
  const [permissionOpen, setPermissionOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [reasonOpen, setReasonOpen] = useState(false)

  useEffect(() => {
    const close = (event: MouseEvent): void => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setPlusOpen(false)
        setPermissionOpen(false)
        setModelMenuOpen(false)
        setReasonOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setPlusOpen(false)
        setPermissionOpen(false)
        setModelMenuOpen(false)
        setReasonOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const currentModel = models.find((model) => model.id === (sessionModel ?? activeProfile?.model))
  const modelLabel = currentModel?.name || sessionModel || activeProfile?.model || '选择模型'
  const reasoningLabel =
    reasoningEffort === 'low'
      ? '低'
      : reasoningEffort === 'medium'
        ? '中'
        : reasoningEffort === 'high'
          ? '高'
          : reasoningEffort === 'max'
            ? 'Max'
            : '自动'

  const commandQuery =
    value.startsWith('/') && !value.includes('\n') && !value.includes(' ')
      ? value.slice(1).toLowerCase()
      : null
  const matches = commandQuery === null ? [] : filterCommands(commandQuery)
  const menuOpen = !running && !busy && commandQuery !== null && !menuDismissed && matches.length > 0

  useEffect(() => {
    setMenuDismissed(false)
    setMenuIndex(0)
  }, [value])

  const chooseCommand = (command: SlashCommandDefinition): void => {
    const needsArgument = command.name === 'compact' || command.name === 'file'
    onChange(`/${command.name}${needsArgument ? ' ' : ''}`)
    setMenuDismissed(true)
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`
  }, [value])

  useEffect(() => {
    if (!running && !busy) textareaRef.current?.focus()
  }, [running, busy])

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    if (busy) return
    const files: File[] = []
    for (const item of Array.from(event.clipboardData.items)) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }
    // Explorer file copies populate `files` but not always `items`.
    for (const file of Array.from(event.clipboardData.files ?? [])) {
      if (!files.includes(file)) files.push(file)
    }
    if (!files.length) return
    event.preventDefault()
    onPasteAttachments(files)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (busy) return
    if (menuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMenuIndex((index) => (index + 1) % matches.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMenuIndex((index) => (index - 1 + matches.length) % matches.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        chooseCommand(matches[menuIndex] ?? matches[0])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenuDismissed(true)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (value.trim() || attachments.length > 0) onSend()
    }
  }

  const isLocal =
    !!activeProfile &&
    /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?/i.test(activeProfile.baseUrl)
  const noKey = !!activeProfile && !activeProfile.hasKey && !isLocal

  const quickCommands = [
    { label: '压缩上下文', command: '/compact ' },
    { label: '添加工作区文件', command: '/file ' },
    { label: '导出会话', command: '/export' },
    { label: '指令帮助', command: '/help' }
  ]
  const reasoningOptions: Array<{ value: ReasoningEffort | undefined; label: string }> = [
    { value: undefined, label: '自动' },
    { value: 'low', label: '低' },
    { value: 'medium', label: '中' },
    { value: 'high', label: '高' },
    { value: 'max', label: 'Max' }
  ]

  return (
    <div className="composer-wrap">
      <div className={cn('composer', running && 'is-running')} ref={popoverRef}>
        {showStartPanel && (
          <div className="composer-start">
            <div className="composer-start-copy">
              <strong>从新对话开始</strong>
              <span><MixedText text="Agent 只读写这个工作区，随时可切换。" /></span>
            </div>
            <button
              type="button"
              className="composer-start-workspace"
              onClick={onChooseWorkspace}
              title={workspace}
            >
              <FolderOpen size={15} strokeWidth={1.7} />
              <span className="composer-start-path">
                <small>当前工作区</small>
                <strong>{workspace}</strong>
              </span>
              <span className="composer-start-action">
                <MixedText text="选择工作区" />
                <ChevronRight size={13} />
              </span>
            </button>
          </div>
        )}
        <div className="composer-topline">
          <span className={cn('run-state', running || busy ? 'active' : 'idle')}>
            <i />
            {busy ? '正在压缩上下文…' : running ? 'Agent 正在执行任务' : '准备就绪'}
          </span>
          {busy && <span className="run-hint">正在调用当前模型生成摘要</span>}
          {running && <span className="run-hint">任务执行中 · Enter 加入队列</span>}
          {!running && !busy && <span className="run-hint">Enter 发送 · Shift + Enter 换行 · 开头输入 / 使用指令</span>}
          {contextUsage && (
            <ContextRing
              percent={contextUsage.percent}
              tokens={contextUsage.tokens}
              limit={contextUsage.limit}
              systemTokens={contextUsage.systemTokens}
              toolTokens={contextUsage.toolTokens}
              messageTokens={contextUsage.messageTokens}
            />
          )}
        </div>

        {menuOpen && (
          <div className="command-menu" role="listbox" aria-label="对话指令">
            <div className="command-menu-head">
              <span>指令</span>
              <small>↑↓ 选择 · Enter 填入</small>
            </div>
            {matches.map((command, index) => (
              <button
                type="button"
                key={command.name}
                role="option"
                aria-selected={index === menuIndex}
                className={cn('command-row', index === menuIndex && 'active')}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setMenuIndex(index)}
                onClick={() => chooseCommand(command)}
              >
                <span className="command-icon">
                  <CommandIcon name={command.name} />
                </span>
                <span className="command-main">
                  <strong>/{command.name}</strong>
                  <small>{command.description}</small>
                </span>
                <span className="command-usage">{command.usage}</span>
              </button>
            ))}
          </div>
        )}

        {queue.length > 0 && (
          <div className="composer-queue">
            <span className="queue-label">待发送 {queue.length}</span>
            {queue.map((item, index) => (
              <span className="queued-chip" key={`${item.text}-${index}`} title={item.text}>
                <span>{item.text.slice(0, 36)}</span>
                <button type="button" onClick={() => onRemoveQueued(index)} aria-label="移除排队消息">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {elevated && (
          <div className="composer-elevated-hint">
            当前以管理员身份运行：Windows 会阻止从资源管理器拖入文件，请用「+ → 上传文件」或 Ctrl+V 粘贴。
          </div>
        )}

        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((attachment) => (
              <span
                className="attachment-chip"
                key={attachment.id ?? attachment.path}
                title={attachment.path}
              >
                {attachment.kind === 'image' && attachment.dataUrl ? (
                  <img className="attachment-thumb" src={attachment.dataUrl} alt="" />
                ) : (
                  <Paperclip size={11} />
                )}
                <span>{baseName(attachment.path)}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(attachment.id ?? attachment.path)}
                  aria-label={`移除 ${attachment.path}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="composer-input-row">
          <textarea
            id="composer-input"
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              busy
                ? '正在压缩上下文，请稍候…'
                : running
                  ? '任务执行中，可以继续输入，Enter 加入队列…'
                  : '描述你想完成的事情…'
            }
            rows={1}
            disabled={busy}
            spellCheck={false}
          />
          {running ? (
            <div className="composer-actions">
              <button
                type="button"
                className="send-btn queue"
                onClick={onSend}
                disabled={!value.trim() && attachments.length === 0}
                title="加入队列"
              >
                <ArrowUp size={17} strokeWidth={2.2} />
              </button>
              <button type="button" className="send-btn stop" onClick={onStop} title="停止任务">
                <Square size={16} fill="currentColor" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="send-btn"
              onClick={onSend}
              disabled={(!value.trim() && attachments.length === 0) || busy}
              title="发送"
            >
              <ArrowUp size={19} strokeWidth={2.2} />
            </button>
          )}
        </div>

        <div className="composer-bottom">
          <div className="composer-left-tools">
            <div className="composer-menu-anchor">
              <button
                type="button"
                className={cn('composer-tool-btn', plusOpen && 'active')}
                onClick={() => {
                  setPlusOpen((current) => !current)
                  setPermissionOpen(false)
                  setModelMenuOpen(false)
                  setReasonOpen(false)
                }}
                title="添加文件或快捷指令"
              >
                <Plus size={15} />
              </button>
              {plusOpen && (
                <div className="composer-popover plus-popover">
                  <div className="popover-label">添加</div>
                  <button
                    type="button"
                    className="popover-item"
                    onClick={() => {
                      setPlusOpen(false)
                      onPickAttachments()
                    }}
                  >
                    <Paperclip size={13} />
                    <span>上传文件…</span>
                  </button>
                  <button
                    type="button"
                    className="popover-item"
                    onClick={() => {
                      setPlusOpen(false)
                      onScreenshot()
                    }}
                  >
                    <Scissors size={13} />
                    <span>截图画框…</span>
                  </button>
                  <button
                    type="button"
                    className="popover-item"
                    onClick={() => {
                      setPlusOpen(false)
                      onInsertCommand('/file ')
                    }}
                  >
                    <FileText size={13} />
                    <span>从工作区选择…</span>
                  </button>
                  <div className="popover-label">快捷指令</div>
                  {quickCommands.map((item) => (
                    <button
                      type="button"
                      className="popover-item"
                      key={item.label}
                      onClick={() => {
                        setPlusOpen(false)
                        onInsertCommand(item.command)
                      }}
                    >
                      <Terminal size={13} />
                      <span>{item.label}</span>
                      <code>{item.command.trim()}</code>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="composer-menu-anchor">
              <button
                type="button"
                className={cn(
                  'composer-permission-chip',
                  approvalMode === 'auto' && 'danger',
                  permissionOpen && 'active'
                )}
                onClick={() => {
                  setPermissionOpen((current) => !current)
                  setPlusOpen(false)
                  setModelMenuOpen(false)
                  setReasonOpen(false)
                }}
                title="选择权限策略"
              >
                {approvalMode === 'ask' ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
                <span>{approvalMode === 'ask' ? '执行前确认' : '自动执行'}</span>
                <ChevronUp size={12} className={cn('chevron', permissionOpen && 'open')} />
              </button>
              {permissionOpen && (
                <div className="composer-popover permission-popover">
                  <div className="popover-label">权限策略</div>
                  {[
                    { value: 'ask' as const, label: '执行前确认', hint: '写文件、命令、网络前询问' },
                    { value: 'auto' as const, label: '自动执行', hint: '不再逐项确认，适合受控项目' }
                  ].map((item) => (
                    <button
                      type="button"
                      key={item.value}
                      className={cn('popover-item', approvalMode === item.value && 'selected')}
                      onClick={() => {
                        setPermissionOpen(false)
                        onSetApproval(item.value)
                      }}
                    >
                      {item.value === 'ask' ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
                      <span className="popover-item-text">
                        <strong>{item.label}</strong>
                        <small>{item.hint}</small>
                      </span>
                      {approvalMode === item.value && <Check size={13} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="composer-right-model">
            <div className="composer-menu-anchor">
              <button
                type="button"
                className={cn('composer-model-chip', modelMenuOpen && 'active')}
                onClick={() => {
                  if (!modelMenuOpen) onOpenModelPicker()
                  setModelMenuOpen((current) => !current)
                  setPlusOpen(false)
                  setPermissionOpen(false)
                  setReasonOpen(false)
                }}
                title="切换当前会话模型"
              >
                {noKey ? <KeyRound size={12} /> : <Sparkles size={12} />}
                <span>{modelLabel}</span>
                {noKey && <i className="chip-warning-dot" />}
                <ChevronUp size={12} className={cn('chevron', modelMenuOpen && 'open')} />
              </button>
              {modelMenuOpen && (
                <div className="composer-popover model-menu-popover">
                  <div className="model-menu-head">
                    <span>切换模型</span>
                    <small>{sessionModel ?? '使用默认模型'}</small>
                  </div>
                  {modelsLoading && (
                    <div className="popover-empty">
                      <Cpu size={14} className="spin" /> 正在读取模型…
                    </div>
                  )}
                  {!modelsLoading && modelsError && (
                    <div className="popover-empty error">{modelsError}</div>
                  )}
                  {!modelsLoading && !modelsError && models.length === 0 && (
                    <div className="popover-empty">接口没有返回模型列表</div>
                  )}
                  {!modelsLoading && !modelsError && (
                    <div className="model-menu-list">
                      {models.map((model) => (
                        <button
                          type="button"
                          key={model.id}
                          className={cn(
                            'model-menu-item',
                            model.id === (sessionModel ?? activeProfile?.model) && 'selected'
                          )}
                          onClick={() => {
                            onSelectModel(model)
                            setModelMenuOpen(false)
                          }}
                        >
                          <span className="model-menu-name">
                            <strong>{model.name || model.id}</strong>
                            {model.name && <small>{model.id}</small>}
                          </span>
                          <span className="model-menu-meta">
                            {model.vision && <span className="vision-badge">视觉</span>}
                            <span>
                              {formatTokenShort(model.contextWindow)} ·{' '}
                              {formatTokenShort(model.maxOutputTokens)}
                            </span>
                          </span>
                          {model.id === (sessionModel ?? activeProfile?.model) && <Check size={13} />}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="model-menu-foot">
                    <button type="button" onClick={onOpenModelPicker}>
                      刷新
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setModelMenuOpen(false)
                        onOpenModelSettings()
                      }}
                    >
                      模型设置
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="composer-menu-anchor">
              <button
                type="button"
                className={cn('composer-reasoning-chip', reasonOpen && 'active')}
                onClick={() => {
                  setReasonOpen((current) => !current)
                  setPlusOpen(false)
                  setPermissionOpen(false)
                  setModelMenuOpen(false)
                }}
                title="选择推理等级"
              >
                {reasoningLabel}
                <ChevronUp size={11} className={cn('chevron', reasonOpen && 'open')} />
              </button>
              {reasonOpen && (
                <div className="composer-popover reasoning-popover">
                  <div className="popover-label">推理等级</div>
                  {reasoningOptions.map((option) => (
                    <button
                      type="button"
                      key={option.label}
                      className={cn(
                        'popover-item',
                        (reasoningEffort ?? undefined) === option.value && 'selected'
                      )}
                      onClick={() => {
                        onSetReasoning(option.value)
                        setReasonOpen(false)
                      }}
                    >
                      <span>{option.label}</span>
                      {(reasoningEffort ?? undefined) === option.value && <Check size={13} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="composer-disclaimer">
        模型可能会出错。执行重要操作前请检查命令与文件内容，密钥仅加密保存在本机。
      </p>
    </div>
  )
}
