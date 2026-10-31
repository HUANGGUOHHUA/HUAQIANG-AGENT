import { useEffect, useMemo, useRef } from 'react'
import { AlertTriangle, RefreshCw, Sparkles, X } from 'lucide-react'
import type {
  ApiProfile,
  AppMessage,
  SessionStats,
  Usage,
  WorkspaceChange
} from '../../../shared/types'
import type { LiveMessage } from '../types'
import { collectTurnFileChanges } from '../lib/turn-changes'
import Welcome from './Welcome'
import MessageItem from './MessageItem'
import TurnChanges from './TurnChanges'
import SessionStatsBar from './SessionStatsBar'

interface ConversationProps {
  messages: AppMessage[]
  live: LiveMessage | null
  running: boolean
  activeProfile?: ApiProfile
  runError: string | null
  usage: Usage | null
  stats?: SessionStats
  contextSummary?: string
  contextInstruction?: string
  lastChanges?: WorkspaceChange[]
  onDismissError: () => void
  onRetry: () => void
  onOpenSettings: () => void
  onOpenFile?: (path: string) => void
  onOpenImage?: (dataUrl: string) => void
}

export default function Conversation({
  messages,
  live,
  running,
  activeProfile,
  runError,
  usage,
  stats,
  contextSummary,
  contextInstruction,
  lastChanges,
  onDismissError,
  onRetry,
  onOpenSettings,
  onOpenFile,
  onOpenImage
}: ConversationProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const turnChanges = useMemo(
    () => lastChanges ?? collectTurnFileChanges(messages),
    [messages, lastChanges]
  )

  const liveSignature = live
    ? live.content.length +
      live.reasoning.length +
      (live.toolDraft?.chars ?? 0) +
      live.toolCalls.reduce((total, call) => total + (call.result?.length ?? 0), 0)
    : 0

  const scrollDependency = useMemo(
    () => `${messages.length}:${messages[messages.length - 1]?.id ?? ''}:${liveSignature}:${running}`,
    [messages, liveSignature, running]
  )

  useEffect(() => {
    if (stickRef.current) endRef.current?.scrollIntoView({ block: 'end' })
  }, [scrollDependency])

  const onScroll = (): void => {
    const element = scrollRef.current
    if (!element) return
    stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 140
  }

  const isEmpty = messages.length === 0 && !live && !running && !runError

  return (
    <div className="conversation-wrap">
      <div className="motto-watermark" aria-hidden="true">
        <span>华而实</span>
        <span>善则强</span>
      </div>

      {contextSummary && (
        <div className="context-summary-banner">
          <span className="context-summary-icon">
            <Sparkles size={14} />
          </span>
          <div className="context-summary-copy">
            <strong>上下文已压缩</strong>
            <span>{contextInstruction || '较早的对话已压缩为摘要，当前任务继续保留。'}</span>
          </div>
        </div>
      )}

      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-inner">
          {isEmpty ? (
            <Welcome activeProfile={activeProfile} onOpenSettings={onOpenSettings} />
          ) : (
            <div className="message-list" role="log" aria-live="polite">
              {messages.map((message, index) => (
                <MessageItem
                  message={message}
                  key={message.id}
                  onOpenImage={onOpenImage}
                  continuation={
                    message.role === 'assistant' && messages[index - 1]?.role === 'assistant'
                  }
                />
              ))}
              {live && (
                <MessageItem
                  message={live}
                  streaming
                  displayName="华强以太"
                  continuation={messages[messages.length - 1]?.role === 'assistant'}
                />
              )}
              {running && !live && (
                <div className="waiting-message">
                  <span className="waiting-dot" />
                  正在准备下一步…
                </div>
              )}
              {!running && turnChanges.length > 0 && (
                <TurnChanges changes={turnChanges} onOpenFile={onOpenFile} />
              )}
            </div>
          )}
          {runError && (
            <div className="run-error" role="alert">
              <span className="run-error-icon">
                <AlertTriangle size={16} />
              </span>
              <div className="run-error-text">
                <strong>本次运行没有完成</strong>
                <span>{runError}</span>
              </div>
              <button type="button" className="run-error-close" onClick={onDismissError} aria-label="关闭">
                <X size={14} />
              </button>
              <button type="button" className="run-retry" onClick={onRetry}>
                <RefreshCw size={13} /> 重试上一条
              </button>
            </div>
          )}
          <div className="chat-end" ref={endRef} />
        </div>
      </div>

      <SessionStatsBar stats={stats} usage={usage} />
    </div>
  )
}
