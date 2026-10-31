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

export const AUTO_COMPACT_PERCENT = 70

export function shouldAutoCompact(
  usage: Pick<ContextUsage, 'percent'>,
  messageCount: number,
  locked: boolean,
  queued: boolean
): boolean {
  return !locked && !queued && messageCount >= 6 && usage.percent >= AUTO_COMPACT_PERCENT
}

export function estimateMessageTokens(message: AppMessage): number {
  let chars = 24 + (message.content?.length ?? 0) + (message.reasoning?.length ?? 0)
  for (const call of message.toolCalls ?? []) {
    chars += call.name.length + (call.displayName?.length ?? 0)
    chars += JSON.stringify(call.args ?? {}).length
    chars += call.result?.length ?? 0
  }
  return Math.ceil(chars / 3.5)
}

/**
 * Lightweight token estimate used for the capacity ring and the 70% compaction trigger.
 * It is intentionally approximate: Chinese/code mix around 3.5 characters per token.
 */
export function estimateContextUsage(input: ContextUsageInput): ContextUsage {
  const systemTokens = Math.ceil(
    (5_000 + (input.systemPromptExtra?.length ?? 0) + (input.contextSummary?.length ?? 0)) / 3.5
  )
  const toolTokens = 7_200

  let messageTokens = 0
  for (const message of input.messages) {
    messageTokens += estimateMessageTokens(message)
  }

  for (const attachment of input.attachments ?? []) {
    if (attachment.kind === 'image') {
      messageTokens += 1_500
      messageTokens += Math.ceil((attachment.ocrText?.length ?? 0) / 3.5)
    } else {
      messageTokens += 40
      messageTokens += Math.ceil(
        (attachment.content?.length ?? attachment.ocrText?.length ?? 0) / 3.5
      )
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
