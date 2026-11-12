export interface RepetitionMatch {
  start: number
  sample: string
}

/**
 * Detect text that has entered a repeated generation loop. This is deliberately
 * conservative: short answers are ignored and a block must occur at least three
 * times before it is considered a loop.
 */
export function findRepetition(text: string): RepetitionMatch | null {
  if (text.length < 240) return null
  const tail = text.slice(-8_000)
  const offset = text.length - tail.length

  // Repeated sentence/line blocks (most common chat-model loop).
  const chunks = tail.match(/[^\n。！？.!?]{12,300}[。！？.!?]?/g) ?? []
  const positions = new Map<string, Array<{ index: number; length: number }>>()
  let cursor = 0
  for (const chunk of chunks) {
    const normalized = chunk.replace(/\s+/g, ' ').trim()
    const index = tail.indexOf(chunk, cursor)
    cursor = index >= 0 ? index + chunk.length : cursor
    if (normalized.length < 12) continue
    const list = positions.get(normalized) ?? []
    list.push({ index: index >= 0 ? index : 0, length: chunk.length })
    positions.set(normalized, list)
  }
  for (const [sample, list] of positions) {
    if (list.length < 3) continue
    const last = list[list.length - 1]
    const prev = list[list.length - 2]
    const prev2 = list[list.length - 3]
    // Only a truly contiguous block is a generation loop. Repeated phrases with
    // other prose in between are legitimate content and must be preserved.
    if (
      last.index === prev.index + prev.length &&
      prev.index === prev2.index + prev2.length
    ) {
      return { start: offset + last.index, sample: sample.slice(0, 120) }
    }
  }

  // Repeated suffix block, including loops without sentence punctuation.
  for (const size of [40, 60, 80, 120, 180, 260, 400, 600]) {
    if (tail.length < size * 3) continue
    const block = tail.slice(-size)
    if (block.trim().length < 20) continue
    if (tail.endsWith(block + block + block)) {
      return { start: text.length - size * 3, sample: block.slice(0, 120) }
    }
  }
  return null
}

export function cleanRepetition(text: string): string {
  const match = findRepetition(text)
  if (!match) return text
  return text.slice(0, Math.max(0, match.start)).trimEnd()
}
