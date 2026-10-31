import { useEffect, useRef, useState } from 'react'
import { ChevronRight, LoaderCircle } from 'lucide-react'
import type { ToolCallView } from '../../../shared/types'
import { cn } from '../lib/utils'
import ToolCard from './ToolCard'

function ThoughtRow({
  text,
  streaming
}: {
  text: string
  streaming: boolean
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  return (
    <button
      type="button"
      className={cn('step-row step-thought', expanded && 'expanded')}
      onClick={() => setExpanded((value) => !value)}
      title={expanded ? '收起思考' : '展开思考'}
    >
      <span className="step-symbol">※</span>
      <span className="step-body">
        <span className="step-title">
          思考
          {streaming && <i className="step-live-dot" />}
        </span>
        <span className={cn('step-text', expanded && 'expanded')}>{text}</span>
      </span>
    </button>
  )
}

export default function StepTimeline({
  reasoning,
  toolCalls = [],
  toolDraft,
  streaming = false
}: {
  reasoning?: string
  toolCalls?: ToolCallView[]
  toolDraft?: { name: string; chars: number }
  streaming?: boolean
}): React.JSX.Element | null {
  const thoughts = (reasoning ?? '')
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
  const hasAnything = thoughts.length > 0 || toolCalls.length > 0 || Boolean(toolDraft)
  const [open, setOpen] = useState(streaming)
  const wasStreaming = useRef(streaming)

  useEffect(() => {
    if (streaming) {
      setOpen(true)
      wasStreaming.current = true
    } else if (wasStreaming.current) {
      setOpen(false)
      wasStreaming.current = false
    }
  }, [streaming])

  if (!hasAnything) return null

  if (!open) {
    return (
      <button
        type="button"
        className="step-summary"
        onClick={() => setOpen(true)}
        title="展开思考与工具步骤"
      >
        <span className="step-summary-symbol">≡</span>
        <span className="step-summary-title">思考与工具</span>
        <span className="step-summary-meta">
          {thoughts.length} 段思考 · {toolCalls.length} 个工具
        </span>
        <ChevronRight size={16} />
      </button>
    )
  }

  return (
    <div className="step-timeline">
      {thoughts.map((text, index) => (
        <ThoughtRow
          key={`thought-${index}`}
          text={text}
          streaming={streaming && index === thoughts.length - 1}
        />
      ))}
      {toolCalls.map((call) => (
        <ToolCard call={call} key={call.id} compact />
      ))}
      {streaming && toolDraft && (
        <div className="step-row step-tool-draft">
          <span className="step-symbol">
            <LoaderCircle size={12} className="spin" />
          </span>
          <span className="step-body">
            <span className="step-title">正在生成</span>
            <span className="step-text">
              {toolDraft.name} 参数 · {toolDraft.chars.toLocaleString()} 字符
            </span>
          </span>
        </div>
      )}
      {!streaming && (
        <button type="button" className="step-collapse" onClick={() => setOpen(false)}>
          收起思考链
        </button>
      )}
    </div>
  )
}
