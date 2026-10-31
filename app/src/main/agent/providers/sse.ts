export interface SseEvent {
  event: string
  data: string
}

const IDLE_TIMEOUT_MS = 300_000

export async function* readSse(
  response: Response,
  idleTimeoutMs = IDLE_TIMEOUT_MS
): AsyncGenerator<SseEvent> {
  if (!response.body) throw new Error('服务器没有返回可读取的数据流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let result: ReadableStreamReadResult<Uint8Array>
    try {
      result = await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => {
          idleTimer = setTimeout(
            () =>
              reject(
                new Error(
                  `模型响应超时：${Math.max(1, Math.round(idleTimeoutMs / 1000))} 秒内没有收到新数据`
                )
              ),
            idleTimeoutMs
          )
        })
      ])
    } catch (error) {
      await reader.cancel().catch(() => undefined)
      throw error
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
    }
    const { done, value } = result
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let index = buffer.indexOf('\n\n')
    while (index >= 0) {
      const block = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      const parsed = parseBlock(block)
      if (parsed) yield parsed
      index = buffer.indexOf('\n\n')
    }
  }
  buffer += decoder.decode()
  const parsed = parseBlock(buffer)
  if (parsed) yield parsed
}

function parseBlock(block: string): SseEvent | null {
  if (!block.trim()) return null
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (!data.length) return null
  return { event, data: data.join('\n') }
}

export async function errorMessageFrom(response: Response): Promise<string> {
  let raw = ''
  try {
    raw = await response.text()
  } catch {
    raw = ''
  }
  let message = raw.trim()
  try {
    const json = JSON.parse(raw) as {
      error?: { message?: string } | string
      message?: string
    }
    if (typeof json.error === 'string') message = json.error
    else if (json.error?.message) message = json.error.message
    else if (json.message) message = json.message
  } catch {
    // Not JSON.
  }
  if (!message) message = `HTTP ${response.status} ${response.statusText}`
  return message.slice(0, 2000)
}

export function joinUrl(base: string, suffix: string): string {
  return `${base.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`
}
