import { describe, expect, it } from 'vitest'
import { readSse } from '../app/src/main/agent/providers/sse'

describe('SSE idle timeout', () => {
  it('uses the configured idle timeout and reports it in seconds', async () => {
    const response = new Response(
      new ReadableStream({
        start() {
          // Intentionally never enqueue data.
        }
      }),
      { headers: { 'Content-Type': 'text/event-stream' } }
    )
    const iterator = readSse(response, 30)
    await expect(iterator.next()).rejects.toThrow('模型响应超时：1 秒内没有收到新数据')
  })

  it('parses events before the idle deadline', async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n'))
          controller.close()
        }
      }),
      { headers: { 'Content-Type': 'text/event-stream' } }
    )
    const iterator = readSse(response, 1_000)
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { event: 'message', data: '{"ok":true}' }
    })
  })
})
