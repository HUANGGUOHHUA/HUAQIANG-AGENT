import { describe, expect, it } from 'vitest'
import { estimateContextUsage, shouldAutoCompact } from '../app/src/renderer/src/lib/context-usage'
import type { AppMessage } from '../app/src/shared/types'

function message(content: string, index: number): AppMessage {
  return {
    id: `m-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    content,
    createdAt: Date.now()
  }
}

describe('context usage estimate', () => {
  it('counts messages and clamps the percentage to 100', () => {
    const usage = estimateContextUsage({
      messages: [message('你好', 0)],
      contextWindow: 128000
    })
    expect(usage.limit).toBe(128000)
    expect(usage.percent).toBeGreaterThan(0)
    expect(usage.percent).toBeLessThan(10)
  })

  it('crosses the 70% threshold for a large history', () => {
    const messages = Array.from({ length: 30 }, (_, index) =>
      message('x'.repeat(12_000), index)
    )
    const usage = estimateContextUsage({ messages, contextWindow: 100_000 })
    expect(usage.percent).toBeGreaterThan(70)
    expect(usage.percent).toBeLessThanOrEqual(100)
  })

  it('counts image and text attachments', () => {
    const text = estimateContextUsage({
      messages: [],
      contextWindow: 100_000,
      attachments: [{ path: 'a.txt', kind: 'text', content: 'x'.repeat(10_000) }]
    })
    const image = estimateContextUsage({
      messages: [],
      contextWindow: 100_000,
      attachments: [{ path: 'a.png', kind: 'image', dataUrl: 'data:image/png;base64,AA' }]
    })
    expect(text.tokens).toBeGreaterThan(image.tokens)
  })

  it('only auto compacts above 70% with enough history and no lock/queue', () => {
    const low = { tokens: 1000, limit: 100_000, percent: 1 }
    const high = { tokens: 80_000, limit: 100_000, percent: 80 }
    expect(shouldAutoCompact(high, 8, false, false)).toBe(true)
    expect(shouldAutoCompact(high, 5, false, false)).toBe(false)
    expect(shouldAutoCompact(high, 8, true, false)).toBe(false)
    expect(shouldAutoCompact(high, 8, false, true)).toBe(false)
    expect(shouldAutoCompact(low, 8, false, false)).toBe(false)
  })
})
