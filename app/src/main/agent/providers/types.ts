import type { AppMessage, AttachmentPayload, ReasoningEffort, Usage } from '../../../shared/types'

export interface ProviderTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ProviderToolCall {
  id: string
  name: string
  argsRaw: string
}

export interface ProviderResult {
  text: string
  reasoning: string
  toolCalls: ProviderToolCall[]
  usage: Usage
  finishReason?: string
}

export interface ProviderConfig {
  provider: 'openai' | 'anthropic'
  baseUrl: string
  model: string
  apiKey: string
  temperature: number
  maxTokens: number
}

export interface ProviderRequest {
  system: string
  messages: AppMessage[]
  tools: ProviderTool[]
  attachments?: AttachmentPayload[]
  reasoningEffort?: ReasoningEffort
  signal: AbortSignal
}

export interface ProviderCallbacks {
  onText: (delta: string) => void
  onReasoning: (delta: string) => void
  onToolDraft?: (draft: { name: string; chars: number }) => void
}

export function usageOf(
  input?: number,
  output?: number,
  cacheRead = 0,
  cacheMiss = 0,
  cacheCreation = 0
): Usage {
  const inputTokens = Math.max(0, Math.round(input ?? 0))
  const outputTokens = Math.max(0, Math.round(output ?? 0))
  const cacheReadTokens = Math.max(0, Math.round(cacheRead))
  const cacheMissTokens = Math.max(0, Math.round(cacheMiss))
  const cacheCreationTokens = Math.max(0, Math.round(cacheCreation))
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadTokens,
    cacheMissTokens,
    cacheCreationTokens
  }
}
