import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Gauge } from 'lucide-react'
import { cn } from '../lib/utils'

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}

export default function ContextRing({
  percent,
  tokens,
  limit,
  systemTokens = 0,
  toolTokens = 0,
  messageTokens = 0
}: {
  percent: number
  tokens: number
  limit: number
  systemTokens?: number
  toolTokens?: number
  messageTokens?: number
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, bottom: 0 })
  const anchorRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const safe = Math.max(0, Math.min(100, percent))
  const radius = 9
  const circumference = 2 * Math.PI * radius
  const dash = (safe / 100) * circumference
  const toggle = (): void => {
    if (!open && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect()
      const width = 252
      setPosition({
        left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)),
        bottom: window.innerHeight - rect.top + 9
      })
    }
    setOpen((value) => !value)
  }

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent): void => {
      if (anchorRef.current?.contains(event.target as Node)) return
      if (popoverRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    return () => document.removeEventListener('pointerdown', closeOnOutside)
  }, [open])
  return (
    <div className="context-ring-wrap">
      <button
        ref={anchorRef}
        type="button"
        className={cn('context-ring', safe >= 70 && 'warn', safe >= 90 && 'high', open && 'open')}
        aria-label={`上下文已用 ${Math.round(safe)}%`}
        aria-expanded={open}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle className="context-ring-track" cx="12" cy="12" r={radius} />
          <circle
            className="context-ring-value"
            cx="12"
            cy="12"
            r={radius}
            strokeDasharray={`${dash} ${circumference - dash}`}
          />
        </svg>
        <span>{Math.round(safe)}%</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="stat-popover context-popover"
            role="dialog"
            aria-label="上下文已用"
            style={{ left: position.left, bottom: position.bottom }}
          >
          <div className="stat-popover-head context-popover-head">
            <span className="context-title">
              <Gauge size={13} />
              <strong>上下文已用 {Math.round(safe)}%</strong>
            </span>
            <span className="context-ratio">
              ~{formatTokens(tokens)} / {formatTokens(limit)}
            </span>
          </div>
          <div className="context-meter" aria-hidden="true">
            <span style={{ width: `${safe}%` }} />
          </div>
          <ul className="context-breakdown">
            <li>
              <i className="context-dot system" />
              系统提示词
              <b>~{formatTokens(systemTokens)}</b>
            </li>
            <li>
              <i className="context-dot tools" />
              工具定义
              <b>~{formatTokens(toolTokens)}</b>
            </li>
            <li>
              <i className="context-dot messages" />
              对话消息
              <b>~{formatTokens(messageTokens)}</b>
            </li>
          </ul>
          </div>,
          document.body
        )}
    </div>
  )
}
