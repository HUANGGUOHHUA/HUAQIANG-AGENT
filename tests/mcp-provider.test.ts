import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { McpManager } from '../app/src/main/mcp'
import { streamAnthropic } from '../app/src/main/agent/providers/anthropic'
import type { AppMessage } from '../app/src/shared/types'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

describe('MCP stdio client', () => {
  it('connects, lists and calls a local MCP server', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/mock-mcp.mjs', import.meta.url))
    const manager = new McpManager()
    cleanups.push(() => manager.closeAll())
    const statuses = await manager.sync([
      {
        id: 'mock',
        name: 'Mock MCP',
        enabled: true,
        transport: 'stdio',
        command: process.execPath,
        args: [fixture],
        env: {},
        url: '',
        headers: {}
      }
    ])
    expect(statuses[0]?.state).toBe('connected')
    expect(statuses[0]?.tools[0]?.name).toBe('echo')
    expect(statuses[0]?.resources?.[0]?.uri).toBe('mock://readme')
    expect(statuses[0]?.prompts?.[0]?.name).toBe('mock-prompt')

    const tools = await manager.tools()
    const echo = tools.find((tool) => tool.name.endsWith('_echo'))
    expect(echo).toBeTruthy()
    expect(echo!.name).toBe('mcp__Mock_MCP__echo')
    const result = await echo!.execute(
      { text: '华强' },
      { workspace: process.cwd(), signal: new AbortController().signal, onOutput: () => undefined }
    )
    expect(result.isError).toBeFalsy()
    expect(result.output).toContain('echo:华强')

    const resourceTool = tools.find((tool) => tool.name.endsWith('_resources'))
    expect(resourceTool).toBeTruthy()
    const listed = await resourceTool!.execute(
      { action: 'list' },
      { workspace: process.cwd(), signal: new AbortController().signal, onOutput: () => undefined }
    )
    expect(listed.output).toContain('mock://readme')
    const read = await resourceTool!.execute(
      { action: 'read', uri: 'mock://readme' },
      { workspace: process.cwd(), signal: new AbortController().signal, onOutput: () => undefined }
    )
    expect(read.output).toContain('resource-body')

    const promptTool = tools.find((tool) => tool.name.endsWith('_prompts'))
    expect(promptTool).toBeTruthy()
    const prompt = await promptTool!.execute(
      { action: 'get', name: 'mock-prompt' },
      { workspace: process.cwd(), signal: new AbortController().signal, onOutput: () => undefined }
    )
    expect(prompt.output).toContain('prompt:mock-prompt')
  })
})

describe('anthropic streaming provider', () => {
  it('parses messages, tool use and usage', async () => {
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        const payload = JSON.parse(body) as { messages?: unknown[] }
        expect(payload.messages).toBeTruthy()
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(
          [
            'event: message_start',
            'data: {"type":"message_start","message":{"usage":{"input_tokens":12}}}',
            '',
            'event: content_block_start',
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
            '',
            'event: content_block_delta',
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}',
            '',
            'event: content_block_start',
            'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}',
            '',
            'event: content_block_delta',
            'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"README.md\\"}"}}',
            '',
            'event: content_block_stop',
            'data: {"type":"content_block_stop","index":1}',
            '',
            'event: message_delta',
            'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}',
            '',
            'event: message_stop',
            'data: {"type":"message_stop"}',
            '',
            ''
          ].join('\n')
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server failed')

    const message: AppMessage = {
      id: 'u1',
      role: 'user',
      content: '读一下 README',
      createdAt: Date.now()
    }
    const textChunks: string[] = []
    const result = await streamAnthropic(
      {
        provider: 'anthropic',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: 'mock-claude',
        apiKey: 'test',
        temperature: 0.2,
        maxTokens: 512
      },
      {
        system: 'test',
        messages: [message],
        tools: [
          {
            name: 'read_file',
            description: 'read',
            inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
          }
        ],
        signal: new AbortController().signal
      },
      {
        onText: (delta) => textChunks.push(delta),
        onReasoning: () => undefined
      }
    )

    expect(textChunks.join('')).toBe('你好')
    expect(result.text).toBe('你好')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].name).toBe('read_file')
    expect(result.toolCalls[0].argsRaw).toContain('README.md')
    expect(result.usage.inputTokens).toBe(12)
    expect(result.usage.outputTokens).toBe(7)
  })
})
