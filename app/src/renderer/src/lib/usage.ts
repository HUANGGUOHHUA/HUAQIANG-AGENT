import type { SessionStats, Usage } from '../../../shared/types'

export function mergeUsage(total: Usage | undefined, next: Usage | undefined): Usage | undefined {
  if (!next) return total
  if (!total) return next
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    totalTokens: total.totalTokens + next.totalTokens,
    cacheReadTokens: total.cacheReadTokens + next.cacheReadTokens,
    cacheMissTokens: total.cacheMissTokens + next.cacheMissTokens,
    cacheCreationTokens: total.cacheCreationTokens + next.cacheCreationTokens
  }
}

export function cacheHitRate(usage: Usage): number | null {
  const input = usage.cacheReadTokens + usage.cacheMissTokens + usage.cacheCreationTokens
  if (input <= 0) return null
  return (usage.cacheReadTokens / input) * 100
}

export function formatTokens(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('en-US')
}

export function mergeStats(
  total: SessionStats | undefined,
  next: SessionStats | undefined
): SessionStats | undefined {
  if (!next) return total
  if (!total) return next
  return {
    turns: total.turns + next.turns,
    steps: total.steps + next.steps,
    llmMs: total.llmMs + next.llmMs,
    toolMs: total.toolMs + next.toolMs,
    ttftMs: total.ttftMs + next.ttftMs,
    ttftSteps: total.ttftSteps + next.ttftSteps,
    decodeMs: total.decodeMs + next.decodeMs,
    outputTokens: total.outputTokens + next.outputTokens
  }
}

export function tokensPerSecond(stats: SessionStats): number | null {
  if (stats.decodeMs <= 0) return null
  return stats.outputTokens / (stats.decodeMs / 1000)
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes}分${seconds}秒`
  return `${seconds}秒`
}
