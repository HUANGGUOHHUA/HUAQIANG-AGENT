import type { AppMessage, AttachmentPayload } from '../../../shared/types'

export interface ContextUsage {
  tokens: number
  limit: number
  percent: number
  systemTokens: number
  toolTokens: number
  messageTokens: number
}

export interface ContextUsageInput {
  messages: AppMessage[]
  contextSummary?: string
  systemPromptExtra?: string
  attachments?: AttachmentPayload[]
  contextWindow?: number
}

export const AUTO_COMPACT_PERCENT = 65

export function shouldAutoCompact(
  usage: Pick<ContextUsage, 'percent'>,
  locked: boolean,
  queued: boolean
): boolean {
  return !locked && !queued && usage.percent >= AUTO_COMPACT_PERCENT
}

function estimateTextTokens(text: string | undefined): number {
  if (!text) return 0
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  return Math.ceil(cjk + (text.length - cjk) / 4)
}

export function estimateMessageTokens(message: AppMessage): number {
  let tokens = 24 + estimateTextTokens(message.content) + estimateTextTokens(message.reasoning)
  for (const call of message.toolCalls ?? []) {
    tokens += estimateTextTokens(call.name)
    tokens += estimateTextTokens(call.displayName)
    tokens += estimateTextTokens(JSON.stringify(call.args ?? {}))
    tokens += estimateTextTokens(call.result)
  }
  return Math.ceil(tokens)
}

/**
 * Lightweight token estimate used for the capacity ring and the 65% compaction trigger.
 * It is intentionally approximate: CJK is about one token per character, ASCII/code
 * about four characters per token, matching the main-process estimator.
 */
export function estimateContextUsage(input: ContextUsageInput): ContextUsage {
  // Match the main-process token estimator: CJK is close to one token per
  // character, while ASCII/code is roughly four characters per token.
  const systemTokens =
    1_250 +
    estimateTextTokens(input.systemPromptExtra) +
    estimateTextTokens(input.contextSummary)
  const toolTokens = 10_000

  let messageTokens = 0
  for (const message of input.messages) {
    messageTokens += estimateMessageTokens(message)
  }

  for (const attachment of input.attachments ?? []) {
    if (attachment.kind === 'image') {
      messageTokens += 1_500
      messageTokens += estimateTextTokens(attachment.ocrText)
    } else {
      messageTokens += 40
      messageTokens += estimateTextTokens(attachment.content ?? attachment.ocrText)
    }
  }

  const limit = Math.max(4_000, Math.round(input.contextWindow || 128_000))
  const tokens = Math.max(0, systemTokens + toolTokens + messageTokens)
  return {
    tokens,
    limit,
    percent: Math.max(0, Math.min(100, (tokens / limit) * 100)),
    systemTokens,
    toolTokens,
    messageTokens
  }
}
