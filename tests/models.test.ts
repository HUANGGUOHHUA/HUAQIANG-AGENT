import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ProfileDraft } from '../app/src/shared/types'
import { listProfileModels } from '../app/src/main/profile-test'

let server: Server | null = null

function profile(baseUrl: string, provider: 'openai' | 'anthropic' = 'openai'): ProfileDraft {
  return {
    id: 'test',
    name: 'Test',
    provider,
    baseUrl,
    model: '',
    contextWindow: 128000,
    temperature: 0.3,
    maxTokens: 1024
  }
}

async function startServer(
  handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void
): Promise<string> {
  server = createServer(handler)
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = null
  }
})

describe('model discovery', () => {
  it('reads OpenAI-compatible /v1/models with bearer auth', async () => {
    let authorization = ''
    const base = await startServer((request, response) => {
      authorization = request.headers.authorization ?? ''
      if (request.url === '/v1/models') {
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            data: [
              { id: 'alpha', context_length: 128000, max_output_tokens: 8192 },
              { id: 'deepseek-chat', architecture: { input_modalities: ['text'] } },
              {
                id: 'gpt-4o',
                architecture: { input_modalities: ['text', 'image'] }
              }
            ]
          })
        )
        return
      }
      response.statusCode = 404
      response.end('not found')
    })

    const result = await listProfileModels(profile(`${base}/v1`), 'secret')
    expect(result.ok).toBe(true)
    expect(result.models).toEqual(['alpha', 'deepseek-chat', 'gpt-4o'])
    expect(result.modelDetails?.[0].contextWindow).toBe(128000)
    expect(result.modelDetails?.[0].maxOutputTokens).toBe(8192)
    expect(result.modelDetails?.[1].vision).toBe(false)
    expect(result.modelDetails?.[2].vision).toBe(true)
    expect(authorization).toBe('Bearer secret')
  })

  it('falls back to /models for a base URL without /v1', async () => {
    const base = await startServer((request, response) => {
      if (request.url === '/models') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ models: [{ id: 'local-model' }] }))
        return
      }
      response.statusCode = 404
      response.end('not found')
    })

    const result = await listProfileModels(profile(base), '')
    expect(result.ok).toBe(true)
    expect(result.models).toEqual(['local-model'])
  })

  it('reads Anthropic models with the required version header', async () => {
    let version = ''
    let key = ''
    const base = await startServer((request, response) => {
      version = String(request.headers['anthropic-version'] ?? '')
      key = String(request.headers['x-api-key'] ?? '')
      if (request.url === '/v1/models') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ data: [{ id: 'claude-test' }] }))
        return
      }
      response.statusCode = 404
      response.end('not found')
    })

    const result = await listProfileModels(profile(base, 'anthropic'), 'anthropic-key')
    expect(result.ok).toBe(true)
    expect(result.models).toEqual(['claude-test'])
    expect(result.modelDetails?.[0].contextWindow).toBe(200000)
    expect(version).toBe('2023-06-01')
    expect(key).toBe('anthropic-key')
  })

  it('reports authentication errors without trying unrelated endpoints', async () => {
    let calls = 0
    const base = await startServer((request, response) => {
      calls += 1
      response.statusCode = 401
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ error: { message: 'bad key' } }))
    })

    const result = await listProfileModels(profile(`${base}/v1`), 'bad')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('认证失败')
    expect(calls).toBe(1)
  })
})
