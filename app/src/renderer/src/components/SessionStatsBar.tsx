import { useState } from 'react'
import { Database, Gauge } from 'lucide-react'
import type { SessionStats, Usage } from '../../../shared/types'
import {
  cacheHitRate,
  formatDuration,
  formatTokens,
  tokensPerSecond
} from '../lib/usage'

function compactTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(Math.round(value))
}

export default function SessionStatsBar({
  stats,
  usage
}: {
  stats?: SessionStats
  usage?: Usage | null
}): React.JSX.Element | null {
  const [open, setOpen] = useState<'activity' | 'usage' | null>(null)
  const speed = stats ? tokensPerSecond(stats) : null
  const hit = usage ? cacheHitRate(usage) : null
  const showActivity = Boolean(stats && stats.steps > 0)
  const showUsage = Boolean(usage && usage.totalTokens > 0)
  if (!showActivity && !showUsage) return null

  const activityLabel = stats
    ? `${stats.turns} 轮 ${stats.steps} 步${speed !== null ? ` · ${Math.round(speed)} tok/s` : ''}`
    : ''
  const usageLabel = usage
    ? `${compactTokens(usage.totalTokens)} tok${hit !== null ? ` · 缓存命中 ${Math.round(hit)}%` : ''}`
    : ''

  return (
    <div
      className="stats-pills"
      onMouseLeave={() => setOpen(null)}
      aria-label="会话统计与 Token 用量"
    >
      {showActivity && stats && (
        <div className="stat-pill-wrap">
          <button
            type="button"
            className={`stat-pill ${open === 'activity' ? 'open' : ''}`}
            onClick={() => setOpen((value) => (value === 'activity' ? null : 'activity'))}
            aria-expanded={open === 'activity'}
          >
            <Gauge size={12} strokeWidth={1.8} />
            <span>{activityLabel}</span>
          </button>
          {open === 'activity' && (
            <div className="stat-popover" role="dialog" aria-label="会话统计">
              <div className="stat-popover-head">
                <Gauge size={13} />
                <strong>会话统计</strong>
              </div>
              <dl className="stat-rows">
                {stats.llmMs > 0 && (
                  <>
                    <dt>模型用时</dt>
                    <dd>{formatDuration(stats.llmMs)}</dd>
                  </>
                )}
                {stats.toolMs > 0 && (
                  <>
                    <dt>工具调用用时</dt>
                    <dd>{formatDuration(stats.toolMs)}</dd>
                  </>
                )}
                {stats.ttftSteps > 0 && (
                  <>
                    <dt>首 token 平均（TTFT）</dt>
                    <dd>
                      {stats.ttftMs / stats.ttftSteps < 10_000
                        ? `${(stats.ttftMs / stats.ttftSteps / 1000).toFixed(1)}秒`
                        : formatDuration(stats.ttftMs / stats.ttftSteps)}
                    </dd>
                  </>
                )}
                {speed !== null && (
                  <>
                    <dt>输出速度（TPS）</dt>
                    <dd>{Math.round(speed)} tok/s</dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </div>
      )}

      {showUsage && usage && (
        <div className="stat-pill-wrap">
          <button
            type="button"
            className={`stat-pill ${open === 'usage' ? 'open' : ''}`}
            onClick={() => setOpen((value) => (value === 'usage' ? null : 'usage'))}
            aria-expanded={open === 'usage'}
          >
            <Database size={12} strokeWidth={1.8} />
            <span>{usageLabel}</span>
          </button>
          {open === 'usage' && (
            <div className="stat-popover usage-popover" role="dialog" aria-label="Token 用量">
              <div className="stat-popover-head">
                <Database size={13} />
                <strong>Token 用量</strong>
                <span className="stat-popover-value">{formatTokens(usage.totalTokens)} tok</span>
              </div>
              <dl className="stat-rows">
                {hit !== null && (
                  <>
                    <dt>缓存命中</dt>
                    <dd>{Math.round(hit)}%</dd>
                  </>
                )}
                <dt>未缓存输入</dt>
                <dd>{formatTokens(usage.cacheMissTokens)} tok</dd>
                <dt>缓存读取</dt>
                <dd>{formatTokens(usage.cacheReadTokens)} tok</dd>
                {usage.cacheCreationTokens > 0 && (
                  <>
                    <dt>缓存写入</dt>
                    <dd>{formatTokens(usage.cacheCreationTokens)} tok</dd>
                  </>
                )}
                <dt>输出</dt>
                <dd>{formatTokens(usage.outputTokens)} tok</dd>
              </dl>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
