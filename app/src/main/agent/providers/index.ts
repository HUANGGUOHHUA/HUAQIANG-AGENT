import { streamAnthropic } from './anthropic'
import { streamOpenAI } from './openai'
import type { ProviderCallbacks, ProviderConfig, ProviderRequest, ProviderResult } from './types'

export async function streamModel(
  config: ProviderConfig,
  request: ProviderRequest,
  callbacks: ProviderCallbacks
): Promise<ProviderResult> {
  if (config.provider === 'anthropic') return streamAnthropic(config, request, callbacks)
  return streamOpenAI(config, request, callbacks)
}
