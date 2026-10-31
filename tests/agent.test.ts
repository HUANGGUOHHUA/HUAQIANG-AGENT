import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent, AppMessage, ApprovalRequest } from '../app/src/shared/types'
import { runAgent } from '../app/src/main/agent/loop'
import { createFileTools } from '../app/src/main/agent/tools/files'
import { runCommandTool } from '../app/src/main/agent/tools/shell'
import { resolveWithinRoot } from '../app/src/main/security/paths'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function writeCallSse(content = '你好，华强', path = 'hello.txt'): string {
  return (
    sse({ choices: [{ delta: { content: '好的，我来处理。' } }] }) +
    sse({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({ path, content })
                }
              }
            ]
          }
        }
      ]
    }) +
    sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) +
    'data: [DONE]\n\n'
  )
}

function finalSse(text: string): string {
  return (
    sse({ choices: [{ delta: { content: text } }] }) +
    sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
    'data: [DONE]\n\n'
  )
}

async function startMock(
  handler: (body: Record<string, unknown>, requestIndex: number) => string
): Promise<{ url: string; server: Server }> {
  let index = 0
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      const current = index++
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
      response.end(handler(body, current))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Mock server failed to start')
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return { url: `http://127.0.0.1:${address.port}/v1`, server }
}

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hq-agent-test-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const userMessage: AppMessage = {
  id: 'user-1',
  role: 'user',
  content: '创建一个 hello.txt',
  createdAt: Date.now()
}

describe('agent loop with an OpenAI-compatible mock', () => {
  it('streams a tool call, asks for approval and writes the file', async () => {
    const workspace = await makeWorkspace()
    const mock = await startMock((_body, index) =>
      index === 0 ? writeCallSse() : finalSse('已创建 hello.txt。')
    )
    const approvals: ApprovalRequest[] = []
    const events: AgentEvent[] = []
    const controller = new AbortController()

    const result = await runAgent({
      runId: 'run-1',
      sessionId: 'session-1',
      workspace,
      provider: {
        provider: 'openai',
        baseUrl: mock.url,
        model: 'mock-model',
        apiKey: 'test-key',
        temperature: 0.2,
        maxTokens: 1024
      },
      approvalMode: 'ask',
      maxSteps: 4,
      systemPrompt: '你是测试助手',
      messages: [userMessage],
      tools: createFileTools(),
      signal: controller.signal,
      emit: (event) => events.push(event),
      requestApproval: async (request) => {
        approvals.push(request)
        return 'allow'
      }
    })

    expect(result.ok).toBe(true)
    expect(approvals).toHaveLength(1)
    expect(approvals[0].toolName).toBe('write_file')
    expect(approvals[0].preview).toContain('hello.txt')
    expect(() => JSON.parse(approvals[0].preview)).not.toThrow()
    expect(await readFile(join(workspace, 'hello.txt'), 'utf8')).toBe('你好，华强')
    const toolEnd = events.find((event) => event.type === 'tool-end' && event.status === 'ok')
    expect(toolEnd && toolEnd.type === 'tool-end' ? toolEnd.stats : undefined).toEqual({
      additions: 1,
      deletions: 0
    })
    expect(events.some((event) => event.type === 'assistant-end')).toBe(true)
    expect(events.some((event) => event.type === 'run-end' && event.status === 'done')).toBe(true)
  })

  it('passes attached files to the model as data', async () => {
    const workspace = await makeWorkspace()
    let systemPrompt = ''
    const mock = await startMock((body) => {
      const messages = Array.isArray(body.messages) ? body.messages : []
      const system = messages[0] as Record<string, unknown> | undefined
      systemPrompt = typeof system?.content === 'string' ? system.content : ''
      return finalSse('已读取附件。')
    })
    const result = await runAgent({
      runId: 'run-attachment',
      sessionId: 'session-attachment',
      workspace,
      provider: {
        provider: 'openai',
        baseUrl: mock.url,
        model: 'mock-model',
        apiKey: 'test-key',
        temperature: 0,
        maxTokens: 512
      },
      approvalMode: 'auto',
      maxSteps: 2,
      systemPrompt: 'test',
      messages: [{ id: 'attachment-user', role: 'user', content: '看附件', createdAt: Date.now() }],
      attachments: [{ path: 'notes.txt', kind: 'text', content: 'const attached = 1' }],
      tools: [],
      signal: new AbortController().signal,
      emit: () => undefined,
      requestApproval: async () => 'allow'
    })
    expect(result.ok).toBe(true)
    expect(systemPrompt).toContain('附加文件：notes.txt')
    expect(systemPrompt).toContain('const attached = 1')
  })

  it('forwards image attachments to the OpenAI-compatible request', async () => {
    const workspace = await makeWorkspace()
    let requestBody: Record<string, unknown> = {}
    const mock = await startMock((body) => {
      requestBody = body
      return finalSse('已查看图片。')
    })
    const result = await runAgent({
      runId: 'run-image',
      sessionId: 'session-image',
      workspace,
      provider: {
        provider: 'openai',
        baseUrl: mock.url,
        model: 'mock-model',
        apiKey: 'test-key',
        temperature: 0,
        maxTokens: 512
      },
      approvalMode: 'auto',
      maxSteps: 2,
      systemPrompt: 'test',
      messages: [{ id: 'image-user', role: 'user', content: '看图片', createdAt: Date.now() }],
      attachments: [
        {
          path: 'shot.png',
          kind: 'image',
          mime: 'image/png',
          dataUrl: 'data:image/png;base64,AAAA'
        }
      ],
      tools: [],
      signal: new AbortController().signal,
      emit: () => undefined,
      requestApproval: async () => 'allow'
    })
    expect(result.ok).toBe(true)
    const serialized = JSON.stringify(requestBody)
    expect(serialized).toContain('image_url')
    expect(serialized).toContain('data:image/png;base64,AAAA')
  })

  it('retries without image data when the model rejects images', async () => {
    const workspace = await makeWorkspace()
    let calls = 0
    let secondRequestHasImage = true
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        calls += 1
        const body = Buffer.concat(chunks).toString('utf8')
        if (calls === 1) {
          response.writeHead(400, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ error: { message: 'This model does not support image input' } }))
          return
        }
        secondRequestHasImage = body.includes('"image_url"')
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
        response.end(finalSse('已降级为文件引用。'))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Mock server failed')
    const events: AgentEvent[] = []
    const result = await runAgent({
      runId: 'run-image-fallback',
      sessionId: 'session-image-fallback',
      workspace,
      provider: {
        provider: 'openai',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: 'mock-model',
        apiKey: 'test-key',
        temperature: 0,
        maxTokens: 512
      },
      approvalMode: 'auto',
      maxSteps: 2,
      systemPrompt: 'test',
      messages: [{ id: 'fallback-user', role: 'user', content: '看图片', createdAt: Date.now() }],
      attachments: [
        {
          path: 'shot.png',
          kind: 'image',
          mime: 'image/png',
          dataUrl: 'data:image/png;base64,AAAA'
        }
      ],
      tools: [],
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      requestApproval: async () => 'allow'
    })
    expect(result.ok).toBe(true)
    expect(calls).toBe(2)
    expect(secondRequestHasImage).toBe(false)
    expect(events.some((event) => event.type === 'notice')).toBe(true)
    const starts = events.filter((event) => event.type === 'assistant-start').length
    const ends = events.filter((event) => event.type === 'assistant-end').length
    expect(ends).toBe(starts)
  })

  it('emits assistant-end when the stream is aborted mid-flight', async () => {
    const workspace = await makeWorkspace()
    const controller = new AbortController()
    const server = createServer((request, response) => {
      request.on('data', () => undefined)
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
        response.write(sse({ choices: [{ delta: { content: '部分输出' } }] }))
        controller.abort()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        })
    )
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Mock server failed')
    const events: AgentEvent[] = []
    const result = await runAgent({
      runId: 'run-abort',
      sessionId: 'session-abort',
      workspace,
      provider: {
        provider: 'openai',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: 'mock-model',
        apiKey: 'test-key',
        temperature: 0,
        maxTokens: 512
      },
      approvalMode: 'auto',
      maxSteps: 2,
      systemPrompt: 'test',
      messages: [{ id: 'abort-user', role: 'user', content: '你好', createdAt: Date.now() }],
      tools: [],
      signal: controller.signal,
      emit: (event) => events.push(event),
      requestApproval: async () => 'allow'
    })
    expect(result.aborted).toBe(true)
    const starts = events.filter((event) => event.type === 'assistant-start').length
    const ends = events.filter((event) => event.type === 'assistant-end').length
    expect(starts).toBeGreaterThan(0)
    expect(ends).toBe(starts)
  })

  it('forwards reasoning effort to the OpenAI-compatible request', async () => {
    const workspace = await makeWorkspace()
    let requestBody: Record<string, unknown> = {}
    const mock = await startMock((body) => {
      requestBody = body
      return finalSse('完成')
    })
    const result = await runAgent({
      runId: 'run-reasoning',
      sessionId: 'session-reasoning',
      workspace,
      provider: {
        provider: 'openai',
        baseUrl: mock.url,
        model: 'mock-model',
        apiKey: 'test-key',
        temperature: 0,
        maxTokens: 512
      },
      reasoningEffort: 'high',
      approvalMode: 'auto',
      maxSteps: 2,
      systemPrompt: 'test',
      messages: [{ id: 'reasoning-user', role: 'user', content: '思考', createdAt: Date.now() }],
      tools: [],
      signal: new AbortController().signal,
      emit: () => undefined,
      requestApproval: async () => 'allow'
    })
    expect(result.ok).toBe(true)
    expect(requestBody.reasoning_effort).toBe('high')
  })

  it('reads prompt cache usage from an OpenAI-compatible response', async () => {
    const workspace = await makeWorkspace()
    let requestBodyForCache: Record<string, unknown> = {}
    const mock = await startMock((body) => {
      requestBodyForCache = body
      return (
        sse({ choices: [{ delta: { content: 'cached' } }] }) +
        sse({
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 80 }
          }
        }) +
        'data: [DONE]\n\n'
      )
    })
    const result = await runAgent({
      runId: 'run-cache',
      sessionId: 'session-cache',
      workspace,
      provider: {
        provider: 'openai',
        baseUrl: mock.url,
        model: 'mock-model',
        apiKey: 'test-key',
        temperature: 0,
        maxTokens: 1024
      },
      contextWindow: 8_000,
      approvalMode: 'auto',
      maxSteps: 1,
      systemPrompt: 'test',
      messages: [{ id: 'cache-user', role: 'user', content: 'hello', createdAt: Date.now() }],
      tools: [],
      signal: new AbortController().signal,
      emit: () => undefined,
      requestApproval: async () => 'allow'
    })
    expect(result.usage.cacheReadTokens).toBe(80)
    expect(result.usage.cacheMissTokens).toBe(20)
    expect(result.usage.inputTokens).toBe(100)
    expect(requestBodyForCache.cache_prompt).toBe(true)
  })

  it('treats maxSteps 0 as unlimited and still finishes on a normal reply', async () => {
    const workspace = await makeWorkspace()
    const mock = await startMock(() => finalSse('done'))
    const result = await runAgent({
      runId: 'run-unlimited',
      sessionId: 'session-unlimited',
      workspace,
      provider: {
        provider: 'openai',
        baseUrl: mock.url,
        model: 'mock-model',
        apiKey: 'test-key',
        temperature: 0,
        maxTokens: 512
      },
      contextWindow: 8_000,
      approvalMode: 'auto',
      maxSteps: 0,
      systemPrompt: 'test',
      messages: [{ id: 'unlimited-user', role: 'user', content: 'hello', createdAt: Date.now() }],
      tools: [],
      signal: new AbortController().signal,
      emit: () => undefined,
      requestApproval: async () => 'allow'
    })
    expect(result.ok).toBe(true)
    expect(result.stats?.steps).toBe(1)
  })

  it('clamps max_tokens so prompt plus output does not exceed the context window', async () => {
    const workspace = await makeWorkspace()
    let requestBody: Record<string, unknown> = {}
    const mock = await startMock((body) => {
      requestBody = body
      return finalSse('ok')
    })
    const result = await runAgent({
      runId: 'run-max-tokens',
      sessionId: 'session-max-tokens',
      workspace,
      provider: {
        provider: 'openai',
        baseUrl: mock.url,
        model: 'mock-model',
        apiKey: 'test-key',
        temperature: 0,
        maxTokens: 128_000
      },
      contextWindow: 8_000,
      approvalMode: 'auto',
      maxSteps: 1,
      systemPrompt: 'test',
      messages: [{ id: 'max-user', role: 'user', content: 'hello', createdAt: Date.now() }],
      tools: [],
      signal: new AbortController().signal,
      emit: () => undefined,
      requestApproval: async () => 'allow'
    })
    expect(result.ok).toBe(true)
    expect(typeof requestBody.max_tokens).toBe('number')
    expect(requestBody.max_tokens as number).toBeLessThanOrEqual(8_000)
    expect(requestBody.max_tokens as number).toBeGreaterThan(0)
  })

  it('writes a large HTML file with line stats without stalling', async () => {    const workspace = await makeWorkspace()
    const html = [
      '<!DOCTYPE html>',
      '<html lang="zh-CN">',
      '<head><meta charset="UTF-8"><title>Large page</title></head>',
      '<body>',
      ...Array.from(
        { length: 800 },
        (_, index) =>
          `  <section class="block-${index}"><h2>Section ${index}</h2><p>${'内容'.repeat(30)}</p></section>`
      ),
      '</body>',
      '</html>'
    ].join('\n')
    const mock = await startMock((_body, index) =>
      index === 0 ? writeCallSse(html, 'index.html') : finalSse('HTML 已创建。')
    )
    const approvals: ApprovalRequest[] = []
    const events: AgentEvent[] = []
    const result = await runAgent({
      runId: 'run-html',
      sessionId: 'session-html',
      workspace,
      provider: {
        provider: 'openai',
        baseUrl: mock.url,
        model: 'mock-model',
        apiKey: 'test-key',
        temperature: 0,
        maxTokens: 4096
      },
      approvalMode: 'ask',
      maxSteps: 3,
      systemPrompt: 'test',
      messages: [{ id: 'html-user', role: 'user', content: '编写一个 HTML 页面', createdAt: Date.now() }],
      tools: createFileTools(),
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      requestApproval: async (request) => {
        approvals.push(request)
        return 'allow'
      }
    })
    expect(result.ok).toBe(true)
    expect(approvals[0].preview.length).toBeLessThanOrEqual(12_000)
    expect(() => JSON.parse(approvals[0].preview)).not.toThrow()
    expect(await readFile(join(workspace, 'index.html'), 'utf8')).toBe(html)
    const toolEnd = events.find((event) => event.type === 'tool-end' && event.status === 'ok')
    expect(toolEnd && toolEnd.type === 'tool-end' ? toolEnd.stats?.additions : 0).toBe(806)
  })

  it('does not write when the user denies approval', async () => {
    const workspace = await makeWorkspace()
    const mock = await startMock((_body, index) =>
      index === 0 ? writeCallSse('不应写入') : finalSse('好的，已取消。')
    )
    const controller = new AbortController()
    const events: AgentEvent[] = []

    const result = await runAgent({
      runId: 'run-2',
      sessionId: 'session-2',
      workspace,
      provider: {
        provider: 'openai',
        baseUrl: mock.url,
        model: 'mock-model',
        apiKey: '',
        temperature: 0,
        maxTokens: 512
      },
      approvalMode: 'ask',
      maxSteps: 4,
      systemPrompt: 'test',
      messages: [userMessage],
      tools: createFileTools(),
      signal: controller.signal,
      emit: (event) => events.push(event),
      requestApproval: async () => 'deny'
    })

    expect(result.ok).toBe(true)
    await expect(readFile(join(workspace, 'hello.txt'), 'utf8')).rejects.toThrow()
    const denied = events.find(
      (event) => event.type === 'tool-end' && event.status === 'denied'
    )
    expect(denied).toBeTruthy()
  })
})

describe('workspace safety and shell', () => {
  it('rejects path traversal and escaping globs', async () => {
    const workspace = await makeWorkspace()
    await expect(resolveWithinRoot(workspace, '../outside.txt')).rejects.toThrow()
    const search = createFileTools().find((tool) => tool.name === 'search_files')!
    const controller = new AbortController()
    await expect(
      search.execute(
        { query: 'secret', glob: '../**/*.ts' },
        { workspace, signal: controller.signal, onOutput: () => undefined }
      )
    ).rejects.toThrow()
  })

  it('refuses to delete or move the workspace root', async () => {
    const workspace = await makeWorkspace()
    const controller = new AbortController()
    const context = { workspace, signal: controller.signal, onOutput: () => undefined }
    const tools = createFileTools()
    const remove = tools.find((tool) => tool.name === 'delete_path')!
    const move = tools.find((tool) => tool.name === 'move_file')!
    await expect(remove.execute({ path: '.', recursive: true }, context)).rejects.toThrow(
      '不能删除工作区根目录'
    )
    await expect(move.execute({ source: '.', destination: 'elsewhere' }, context)).rejects.toThrow(
      '不能移动工作区根目录'
    )
  })

  it('refuses to edit files larger than the 2MB read limit', async () => {
    const workspace = await makeWorkspace()
    await writeFile(join(workspace, 'big.txt'), `marker\n${'x'.repeat(2 * 1024 * 1024)}\ntail`, 'utf8')
    const controller = new AbortController()
    const edit = createFileTools().find((tool) => tool.name === 'edit_file')!
    await expect(
      edit.execute(
        { path: 'big.txt', old_string: 'marker', new_string: 'replaced' },
        { workspace, signal: controller.signal, onOutput: () => undefined }
      )
    ).rejects.toThrow('2MB')
  })

  it('runs a PowerShell command with Chinese output', async () => {
    const workspace = await makeWorkspace()
    const controller = new AbortController()
    const result = await runCommandTool.execute(
      { command: 'Write-Output "华强职校"' },
      { workspace, signal: controller.signal, onOutput: () => undefined }
    )
    expect(result.isError).toBeFalsy()
    expect(result.output).toContain('华强职校')
  })
})
