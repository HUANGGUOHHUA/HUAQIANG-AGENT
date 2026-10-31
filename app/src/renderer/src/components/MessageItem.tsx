import { memo, useState } from 'react'
import { AlertTriangle, Check, Copy, Paperclip } from 'lucide-react'
import type { AppMessage } from '../../../shared/types'
import type { LiveMessage } from '../types'
import emblem from '../assets/emblem.png'
import { baseName, cn, formatTime } from '../lib/utils'
import Markdown from './Markdown'
import StepTimeline from './StepTimeline'

function TypingDots(): React.JSX.Element {
  return (
    <span className="typing-dots" aria-label="正在生成">
      <i />
      <i />
      <i />
    </span>
  )
}

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      // Ignore clipboard errors.
    }
  }
  return (
    <button type="button" className="message-copy" onClick={() => void copy()} title="复制内容">
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? '已复制' : '复制'}
    </button>
  )
}

function MessageItem({
  message,
  streaming = false,
  displayName,
  continuation = false,
  onOpenImage
}: {
  message: AppMessage | LiveMessage
  streaming?: boolean
  displayName?: string
  continuation?: boolean
  onOpenImage?: (dataUrl: string) => void
}): React.JSX.Element {
  const [contentExpanded, setContentExpanded] = useState(false)
  if (message.role === 'user') {
    const attachments = 'attachments' in message ? message.attachments ?? [] : []
    return (
      <article className="message user-message">
        <div className="user-bubble-wrap">
          {attachments.length > 0 && (
            <div className="user-attachments">
              {attachments.map((attachment) =>
                attachment.kind === 'image' && attachment.dataUrl ? (
                  <button
                    type="button"
                    key={attachment.id ?? attachment.path}
                    className="user-image"
                    title="点击查看大图"
                    onClick={() => onOpenImage?.(attachment.dataUrl as string)}
                  >
                    <img src={attachment.dataUrl} alt={baseName(attachment.path)} loading="lazy" />
                  </button>
                ) : (
                  <span
                    className="user-file"
                    key={attachment.id ?? attachment.path}
                    title={attachment.path}
                  >
                    <Paperclip size={11} />
                    {baseName(attachment.path)}
                  </span>
                )
              )}
            </div>
          )}
          {message.content.trim() && <div className="user-bubble">{message.content}</div>}
          <div className="user-meta">
            <time>{formatTime(message.createdAt)}</time>
            {message.content.trim() && <CopyButton text={message.content} />}
          </div>
        </div>
        <div className="user-avatar" aria-hidden="true">
          你
        </div>
      </article>
    )
  }

  const hasTools = Boolean(message.toolCalls?.length)
  const toolDraft = streaming && 'toolDraft' in message ? message.toolDraft : undefined
  const longContent = !streaming && message.content.length > 20_000
  const empty =
    !message.content.trim() && !hasTools && !message.reasoning?.trim() && !message.error

  return (
    <article
      className={cn(
        'message assistant-message',
        streaming && 'streaming',
        continuation && 'continuation'
      )}
    >
      {!continuation && (
        <div className="assistant-avatar">
          <img src={emblem} alt="" />
        </div>
      )}
      <div className="assistant-body">
        {!continuation && (
          <div className="assistant-meta">
            <span className="assistant-name">{displayName ?? '华强以太'}</span>
            <time>{formatTime(message.createdAt)}</time>
            {message.content.trim() && <CopyButton text={message.content} />}
          </div>
        )}

        <StepTimeline
          reasoning={message.reasoning}
          toolCalls={message.toolCalls}
          toolDraft={toolDraft}
          streaming={streaming}
        />

        {message.content.trim() && (
          <div className="assistant-content">
            {streaming && message.content.length > 12_000 ? (
              <pre className="streaming-plain">{message.content}</pre>
            ) : longContent && !contentExpanded ? (
              <div className="long-message-preview">
                <pre>{message.content.slice(0, 6000)}</pre>
                <button
                  type="button"
                  className="long-message-expand"
                  onClick={() => setContentExpanded(true)}
                >
                  展开全文（{message.content.length.toLocaleString()} 字符）
                </button>
              </div>
            ) : (
              <Markdown
                content={message.content}
                highlight={!streaming && message.content.length < 80_000}
              />
            )}
            {streaming && <span className="stream-caret" />}
          </div>
        )}

        {streaming && !message.content.trim() && !hasTools && !message.reasoning?.trim() && !toolDraft && (
            <div className="thinking-row">
              <span className="thinking-label">正在思考</span>
              <TypingDots />
            </div>
          )}

        {empty && !streaming && <div className="empty-response">模型没有返回内容。</div>}

        {message.error && (
          <div className="message-error">
            <span className="error-icon">
              <AlertTriangle size={15} />
            </span>
            <div>
              <strong>运行中断</strong>
              <p>{message.error}</p>
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

export default memo(MessageItem)
