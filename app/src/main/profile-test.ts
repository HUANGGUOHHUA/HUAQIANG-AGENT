import type { ModelInfo, ProfileDraft, ProfileTestResult } from '../shared/types'

function openAIUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(base)) return base
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

function anthropicUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  if (/\/v1\/messages$/i.test(base)) return base
  if (/\/v1$/i.test(base)) return `${base}/messages`
  return `${base}/v1/messages`
}

function modelUrlCandidates(provider: 'openai' | 'anthropic', baseUrl: string): string[] {
  const base = baseUrl.replace(/\/+$/, '')
  const urls: string[] = []
  const add = (url: string): void => {
    if (url && !urls.includes(url)) urls.push(url)
  }

  if (provider === 'anthropic') {
    if (/\/v1\/models$/i.test(base)) {
      add(base)
    } else if (/\/v1\/messages$/i.test(base)) {
      add(base.replace(/\/v1\/messages$/i, '/v1/models'))
    } else if (/\/v1$/i.test(base)) {
      add(`${base}/models`)
    } else {
      add(`${base}/v1/models`)
      add(`${base}/models`)
    }
    return urls
  }

  if (/\/models$/i.test(base)) {
    add(base)
    return urls
  }

  const root = base
    .replace(/\/v1\/chat\/completions$/i, '/v1')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/responses$/i, '')
  if (root !== base) {
    add(`${root}/models`)
    if (!/\/v1$/i.test(root)) add(`${root}/v1/models`)
    return urls
  }

  if (/\/v1$/i.test(base)) add(`${base}/models`)
  else {
    add(`${base}/models`)
    add(`${base}/v1/models`)
  }
  return urls
}

function numberFrom(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    const parsed = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed)
  }
  return undefined
}

function knownContextWindow(provider: 'openai' | 'anthropic', id: string): number {
  const lower = id.toLowerCase()
  if (lower.includes('claude')) return 200_000
  if (lower.includes('gpt-4.1')) return 1_047_576
  if (lower.includes('gpt-4o')) return 128_000
  if (lower.includes('o3') || lower.includes('o4')) return 200_000
  if (lower.includes('deepseek')) return 131_072
  if (lower.includes('kimi')) return 262_144
  if (lower.includes('qwen')) return 131_072
  if (lower.includes('gemini')) return 1_048_576
  return provider === 'anthropic' ? 200_000 : 128_000
}

function knownMaxOutputTokens(id: string): number | undefined {
  const lower = id.toLowerCase()
  if (lower.includes('deepseek')) return 8_192
  if (lower.includes('claude')) return 32_000
  if (lower.includes('gpt-4.1')) return 32_768
  if (lower.includes('gpt-4o')) return 16_384
  if (lower.includes('o3') || lower.includes('o4')) return 100_000
  if (lower.includes('kimi')) return 32_768
  if (lower.includes('qwen')) return 16_384
  if (lower.includes('gemini')) return 65_536
  return undefined
}

function explicitVision(record: Record<string, unknown>): boolean | undefined {
  for (const key of ['supports_vision', 'supportsVision', 'vision']) {
    const value = record[key]
    if (typeof value === 'boolean') return value
  }
  const capabilities =
    record.capabilities && typeof record.capabilities === 'object'
      ? (record.capabilities as Record<string, unknown>)
      : undefined
  if (capabilities && typeof capabilities.vision === 'boolean') return capabilities.vision
  const architecture =
    record.architecture && typeof record.architecture === 'object'
      ? (record.architecture as Record<string, unknown>)
      : undefined
  const modalities =
    (Array.isArray(record.input_modalities) && record.input_modalities) ||
    (architecture && Array.isArray(architecture.input_modalities)
      ? architecture.input_modalities
      : undefined) ||
    (record.modalities && typeof record.modalities === 'object' &&
    Array.isArray((record.modalities as Record<string, unknown>).input)
      ? ((record.modalities as Record<string, unknown>).input as unknown[])
      : undefined)
  if (modalities) {
    const normalized = modalities
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.toLowerCase())
    if (normalized.some((item) => item.includes('image') || item.includes('vision'))) return true
    if (normalized.length > 0) return false
  }
  const modality =
    (typeof record.modality === 'string' && record.modality) ||
    (architecture && typeof architecture.modality === 'string' ? architecture.modality : '')
  if (modality) return /image|vision|multimodal/i.test(modality)
  return undefined
}

function explicitReasoning(record: Record<string, unknown>): boolean | undefined {
  for (const key of ['supports_reasoning', 'supportsReasoning', 'reasoning']) {
    const value = record[key]
    if (typeof value === 'boolean') return value
  }
  const capabilities =
    record.capabilities && typeof record.capabilities === 'object'
      ? (record.capabilities as Record<string, unknown>)
      : undefined
  if (capabilities && typeof capabilities.reasoning === 'boolean') return capabilities.reasoning
  return undefined
}

function knownReasoning(modelId: string): boolean | undefined {
  const id = modelId.toLowerCase()
  if (!id) return undefined
  if (/(deepseek-reasoner|qwen.*qwq|o1|o3|o4|reasoning|thinking)/.test(id)) return true
  return undefined
}

function knownVision(modelId: string): boolean | undefined {  const id = modelId.toLowerCase()
  if (!id) return undefined
  if (
    /(deepseek-(chat|reasoner|coder)|kimi-for-coding|gpt-3\.5|text-embedding|whisper|tts|dall-e)/.test(
      id
    )
  ) {
    return false
  }
  if (
    /(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|o3|o4|claude-3|claude-4|claude-sonnet|claude-opus|gemini|qwen.*vl|llava|pixtral|llama.*vision|deepseek-(vl|v4)|glm-4v|vision|multimodal)/.test(
      id
    )
  ) {
    return true
  }
  return undefined
}

function modelInfos(payload: unknown, provider: 'openai' | 'anthropic'): ModelInfo[] {
  const infos: ModelInfo[] = []
  const seen = new Set<string>()
  const add = (record: Record<string, unknown>): void => {
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (!id || id.length > 200 || seen.has(id) || infos.length >= 500) return
    seen.add(id)
    const topProvider =
      record.top_provider && typeof record.top_provider === 'object'
        ? (record.top_provider as Record<string, unknown>)
        : undefined
    infos.push({
      id,
      name:
        (typeof record.display_name === 'string' && record.display_name.trim()) ||
        (typeof record.name === 'string' && record.name.trim()) ||
        undefined,
      contextWindow:
        numberFrom(record, [
          'context_window',
          'context_length',
          'max_context_length',
          'max_input_tokens',
          'context'
        ]) ??
        (topProvider
          ? numberFrom(topProvider, ['context_window', 'context_length', 'max_context_length'])
          : undefined) ??
        knownContextWindow(provider, id),
      maxOutputTokens:
        numberFrom(record, [
          'max_output_tokens',
          'max_completion_tokens',
          'max_tokens',
          'output_tokens'
        ]) ??
        (topProvider
          ? numberFrom(topProvider, ['max_output_tokens', 'max_completion_tokens', 'max_tokens'])
          : undefined) ??
        knownMaxOutputTokens(id),
      ownedBy: typeof record.owned_by === 'string' ? record.owned_by.trim() : undefined,
      vision: explicitVision(record) ?? knownVision(id),
      reasoning: explicitReasoning(record) ?? knownReasoning(id)
    })
  }
  const walk = (value: unknown, depth: number): void => {
    if (depth > 5 || value == null || infos.length >= 500) return
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item)) add(item as Record<string, unknown>)
        else if (typeof item === 'string') add({ id: item })
      }
      return
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>
      for (const key of ['data', 'models', 'model_list', 'result']) {
        if (key in record) walk(record[key], depth + 1)
      }
    }
  }
  walk(payload, 0)
  return infos
}

export async function listProfileModels(
  profile: ProfileDraft,
  apiKey: string
): Promise<ProfileTestResult> {
  if (!profile.baseUrl?.trim()) return { ok: false, message: '请先填写 Base URL' }
  try {
    new URL(profile.baseUrl)
  } catch {
    return { ok: false, message: 'Base URL 格式不正确' }
  }

  const urls = modelUrlCandidates(profile.provider, profile.baseUrl)
  if (!urls.length) return { ok: false, message: '无法从 Base URL 推导模型接口' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25_000)
  let lastError = ''
  try {
    for (const url of urls) {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (profile.provider === 'anthropic') {
        headers['anthropic-version'] = '2023-06-01'
        if (apiKey) headers['x-api-key'] = apiKey
      } else if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`
      }

      const response = await fetch(url, { method: 'GET', headers, signal: controller.signal })
      if (response.ok) {
        const payload = await response.json().catch(() => null)
        const modelDetails = modelInfos(payload, profile.provider)
        const models = modelDetails.map((model) => model.id)
        return {
          ok: true,
          models,
          modelDetails,
          message: models.length
            ? `已读取 ${models.length} 个模型`
            : '接口可访问，但没有返回模型列表，可以手动填写 Model ID'
        }
      }

      const detail = await errorText(response)
      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: `认证失败（HTTP ${response.status}）：${detail}` }
      }
      lastError = `HTTP ${response.status}：${detail}`
    }
    return { ok: false, message: `读取模型失败：${lastError || '接口没有返回可用模型'}` }
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, message: '读取模型超时（25 秒）' }
    return {
      ok: false,
      message: `读取模型失败：${error instanceof Error ? error.message : String(error)}`
    }
  } finally {
    clearTimeout(timer)
  }
}

async function errorText(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  let message = raw
  try {
    const json = JSON.parse(raw) as { error?: { message?: string } | string; message?: string }
    if (typeof json.error === 'string') message = json.error
    else if (json.error?.message) message = json.error.message
    else if (json.message) message = json.message
  } catch {
    // Plain text error.
  }
  return (message || `HTTP ${response.status}`).slice(0, 1500)
}

export async function testProfileConnection(
  profile: ProfileDraft,
  apiKey: string
): Promise<ProfileTestResult> {
  if (!profile.baseUrl?.trim()) return { ok: false, message: '请先填写 Base URL' }
  if (!profile.model?.trim()) return { ok: false, message: '请先填写 Model ID' }
  try {
    new URL(profile.baseUrl)
  } catch {
    return { ok: false, message: 'Base URL 格式不正确' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25_000)
  try {
    const isAnthropic = profile.provider === 'anthropic'
    const url = isAnthropic ? anthropicUrl(profile.baseUrl) : openAIUrl(profile.baseUrl)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (isAnthropic) {
      headers['anthropic-version'] = '2023-06-01'
      if (apiKey) headers['x-api-key'] = apiKey
    } else if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }
    const body = isAnthropic
      ? {
          model: profile.model,
          max_tokens: 8,
          messages: [{ role: 'user', content: '只回复 OK' }]
        }
      : {
          model: profile.model,
          max_tokens: 8,
          temperature: 0,
          stream: false,
          messages: [{ role: 'user', content: '只回复 OK' }]
        }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    })
    if (!response.ok) {
      return { ok: false, message: `连接失败（HTTP ${response.status}）：${await errorText(response)}` }
    }
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (isAnthropic && Array.isArray(json.content)) {
      return { ok: true, message: '连接成功，模型已响应' }
    }
    if (Array.isArray(json.choices)) {
      return { ok: true, message: '连接成功，模型已响应' }
    }
    return { ok: false, message: '接口有响应，但返回格式不是预期的对话格式，请检查协议或 Base URL' }
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, message: '连接超时（25 秒）' }
    return {
      ok: false,
      message: `连接失败：${error instanceof Error ? error.message : String(error)}`
    }
  } finally {
    clearTimeout(timer)
  }
}
