import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  McpPromptInfo,
  McpResourceInfo,
  McpServerConfig,
  McpStatus,
  McpTestResult,
  McpToolInfo
} from '../shared/types'
import type { ToolDefinition } from './agent/tools/types'
import { truncate } from './agent/tools/types'

interface Connection {
  config: McpServerConfig
  signature: string
  client?: Client
  status: McpStatus
  toolNames: Map<string, string>
  builtin?: boolean
  instructions?: string
}

function signature(config: McpServerConfig): string {
  return JSON.stringify({
    transport: config.transport,
    command: config.command,
    args: config.args,
    env: config.env,
    url: config.url,
    headers: config.headers
  })
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 40) || 'tool'
}

function contentToText(result: {
  content?: Array<Record<string, unknown>>
  structuredContent?: unknown
  isError?: boolean
}): string {
  const pieces: string[] = []
  for (const item of result.content ?? []) {
    if (!item || typeof item !== 'object') continue
    if (item.type === 'text' && typeof item.text === 'string') {
      pieces.push(item.text)
    } else if (item.type === 'image') {
      pieces.push(`[图片内容 ${typeof item.mimeType === 'string' ? item.mimeType : ''}]`)
    } else if (item.type === 'audio') {
      pieces.push('[音频内容]')
    } else if (item.type === 'resource' && item.resource && typeof item.resource === 'object') {
      const resource = item.resource as Record<string, unknown>
      pieces.push(
        `[资源 ${String(resource.uri ?? '')}]\n${typeof resource.text === 'string' ? resource.text : ''}`
      )
    } else {
      pieces.push(`[${String(item.type ?? '内容')}]`)
    }
  }
  if (!pieces.length && result.structuredContent !== undefined) {
    pieces.push(JSON.stringify(result.structuredContent, null, 2))
  }
  return truncate(pieces.join('\n\n') || '(工具未返回内容)', 200_000)
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${Math.round(ms / 1000)} 秒）`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export class McpManager {
  private connections = new Map<string, Connection>()
  private statusListener: ((statuses: McpStatus[]) => void) | null = null
  private syncChain: Promise<unknown> = Promise.resolve()

  onStatus(listener: (statuses: McpStatus[]) => void): void {
    this.statusListener = listener
  }

  private broadcast(): void {
    this.statusListener?.(this.statuses())
  }

  statuses(): McpStatus[] {
    return [...this.connections.values()].map((conn) => ({
      ...conn.status,
      tools: [...conn.status.tools],
      resources: conn.status.resources ? [...conn.status.resources] : undefined,
      prompts: conn.status.prompts ? [...conn.status.prompts] : undefined,
      instructions: conn.status.instructions,
      builtin: conn.status.builtin
    }))
  }

  instructions(): string[] {
    return [...this.connections.values()]
      .map((conn) => conn.status.instructions?.trim())
      .filter((value): value is string => Boolean(value))
  }

  async sync(servers: McpServerConfig[]): Promise<McpStatus[]> {
    this.syncChain = this.syncChain.then(() => this.doAsyncSync(servers)).catch((error) => {
      console.error('MCP sync failed:', error)
    })
    await this.syncChain
    return this.statuses()
  }

  private async doAsyncSync(servers: McpServerConfig[]): Promise<void> {
    const wanted = new Map(servers.map((server) => [server.id, server]))
    for (const [id, conn] of this.connections) {
      const next = wanted.get(id)
      if (conn.builtin) continue
      if (!next || !next.enabled || signature(next) !== conn.signature || conn.status.state === 'error') {
        await this.closeConnection(id)
      }
    }
    for (const server of servers) {
      if (!server.enabled) continue
      if (this.connections.has(server.id)) continue
      this.connections.set(server.id, {
        config: server,
        signature: signature(server),
        status: {
          id: server.id,
          name: server.name,
          enabled: true,
          state: 'connecting',
          tools: []
        },
        toolNames: new Map()
      })
      this.broadcast()
      try {
        const { client, tools, resources, prompts, instructions } = await this.connect(server)
        const conn = this.connections.get(server.id)
        if (!conn) {
          await client.close().catch(() => undefined)
          continue
        }
        conn.client = client
        conn.instructions = instructions
        conn.status = {
          id: server.id,
          name: server.name,
          enabled: true,
          state: 'connected',
          tools,
          resources,
          prompts,
          instructions
        }
      } catch (error) {
        const conn = this.connections.get(server.id)
        if (conn) {
          conn.status = {
            id: server.id,
            name: server.name,
            enabled: true,
            state: 'error',
            error: error instanceof Error ? error.message : String(error),
            tools: []
          }
        }
      }
      this.broadcast()
    }
  }

  private async connect(server: McpServerConfig): Promise<{
    client: Client
    tools: McpToolInfo[]
    resources: McpResourceInfo[]
    prompts: McpPromptInfo[]
    instructions?: string
  }> {
    let transport: Transport
    let stderrText = ''
    if (server.transport === 'http') {
      if (!server.url) throw new Error('HTTP MCP 未填写 URL')
      transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: server.headers }
      })
    } else {
      if (!server.command.trim()) throw new Error('stdio MCP 未填写启动命令')
      const stdio = new StdioClientTransport({
        command: server.command.trim(),
        args: server.args,
        env: { ...getDefaultEnvironment(), ...server.env },
        stderr: 'pipe'
      })
      stdio.stderr?.on('data', (data: Buffer) => {
        stderrText = `${stderrText}${data.toString('utf8')}`.slice(-4000)
      })
      transport = stdio
    }

    const client = new Client(
      { name: 'huaqiang-agent', version: '1.0.0' },
      { capabilities: {} }
    )
    try {
      await withTimeout(client.connect(transport), 25_000, 'MCP 连接')
      const listed = await withTimeout(client.listTools(), 20_000, 'MCP 工具列表加载')
      const tools = (listed.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description ?? ''
      }))
      let resources: McpResourceInfo[] = []
      let prompts: McpPromptInfo[] = []
      try {
        const listedResources = await withTimeout(
          client.listResources(),
          10_000,
          'MCP 资源列表加载'
        )
        resources = (listedResources.resources ?? []).map((resource) => ({
          uri: resource.uri,
          name: resource.name,
          description: resource.description,
          mimeType: resource.mimeType
        }))
      } catch {
        // Servers are allowed to expose only tools.
      }
      try {
        const listedPrompts = await withTimeout(client.listPrompts(), 10_000, 'MCP 提示列表加载')
        prompts = (listedPrompts.prompts ?? []).map((prompt) => ({
          name: prompt.name,
          description: prompt.description
        }))
      } catch {
        // Servers are allowed to expose only tools.
      }
      return {
        client,
        tools,
        resources,
        prompts,
        instructions: client.getInstructions()
      }
    } catch (error) {
      await client.close().catch(() => undefined)
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(stderrText.trim() ? `${message}\n${stderrText.trim()}` : message)
    }
  }

  async attachBuiltin(config: McpServerConfig, transport: Transport): Promise<McpStatus> {
    const existing = this.connections.get(config.id)
    if (existing) await this.closeConnection(config.id)
    const client = new Client(
      { name: 'huaqiang-agent', version: '1.0.0' },
      { capabilities: {} }
    )
    await withTimeout(client.connect(transport), 15_000, '内置 MCP 连接')
    const listed = await withTimeout(client.listTools(), 15_000, '内置 MCP 工具列表')
    const tools = (listed.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? ''
    }))
    let resources: McpResourceInfo[] = []
    let prompts: McpPromptInfo[] = []
    try {
      const listedResources = await client.listResources()
      resources = (listedResources.resources ?? []).map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType
      }))
    } catch {
      // Built-in server can expose only tools.
    }
    try {
      const listedPrompts = await client.listPrompts()
      prompts = (listedPrompts.prompts ?? []).map((prompt) => ({
        name: prompt.name,
        description: prompt.description
      }))
    } catch {
      // Built-in server can expose only tools.
    }
    const instructions = client.getInstructions()
    const status: McpStatus = {
      id: config.id,
      name: config.name,
      enabled: true,
      state: 'connected',
      tools,
      resources,
      prompts,
      instructions,
      builtin: true
    }
    this.connections.set(config.id, {
      config,
      signature: 'builtin',
      client,
      status,
      toolNames: new Map(),
      builtin: true,
      instructions
    })
    this.broadcast()
    return { ...status, tools: [...status.tools] }
  }

  private async closeConnection(id: string): Promise<void> {
    const conn = this.connections.get(id)
    if (!conn) return
    this.connections.delete(id)
    if (conn.client) {
      await conn.client.close().catch(() => undefined)
    }
    this.broadcast()
  }

  private remoteBuiltin:
    | ((tool: string, args: Record<string, unknown>) => Promise<{ output: string; isError?: boolean }>)
    | null = null

  setRemoteBuiltin(
    executor: (tool: string, args: Record<string, unknown>) => Promise<{ output: string; isError?: boolean }>
  ): void {
    this.remoteBuiltin = executor
  }

  async tools(): Promise<ToolDefinition[]> {
    const definitions: ToolDefinition[] = []
    const usedServerNames = new Set<string>()
    let index = 0
    for (const conn of this.connections.values()) {
      index += 1
      if (conn.status.state !== 'connected' || !conn.client) continue
      const client = conn.client
      const rawServerName = conn.builtin ? 'huaqiang_builtin' : conn.config.name
      let baseName = safeName(rawServerName)
      if (!/[a-zA-Z0-9]/.test(baseName)) baseName = `server${index}`
      let serverName = baseName
      let suffix = 2
      while (usedServerNames.has(serverName)) {
        serverName = `${baseName}_${suffix}`
        suffix += 1
      }
      usedServerNames.add(serverName)
      const prefix = `mcp__${serverName}__`
      let listed: Awaited<ReturnType<Client['listTools']>>
      try {
        listed = await client.listTools()
      } catch {
        continue
      }
      for (const tool of listed.tools ?? []) {
        const exposed = `${prefix}${safeName(tool.name)}`
        if (definitions.some((d) => d.name === exposed)) continue
        conn.toolNames.set(exposed, tool.name)
        const schema =
          tool.inputSchema && typeof tool.inputSchema === 'object'
            ? (tool.inputSchema as Record<string, unknown>)
            : { type: 'object', properties: {} }
        definitions.push({
          name: exposed,
          displayName: `MCP · ${tool.name}`,
          description: `[MCP 服务器：${conn.config.name}] ${tool.description ?? ''}`.trim(),
          inputSchema: schema,
          risk: 'mcp',
          summarize: (args) => `${conn.config.name} · ${tool.name} ${JSON.stringify(args).slice(0, 100)}`,
          execute: async (args) => {
            if (conn.builtin && this.remoteBuiltin) {
              try {
                const remote = await this.remoteBuiltin(tool.name, args)
                return { output: remote.output, isError: Boolean(remote.isError) }
              } catch (error) {
                return {
                  output: `提权辅助进程执行失败：${error instanceof Error ? error.message : String(error)}`,
                  isError: true
                }
              }
            }
            try {
              const result = await client.callTool(
                { name: tool.name, arguments: args },
                undefined,
                { timeout: 120_000 }
              )
              return {
                output: contentToText(
                  result as unknown as {
                    content?: Array<Record<string, unknown>>
                    structuredContent?: unknown
                    isError?: boolean
                  }
                ),
                isError: Boolean((result as { isError?: boolean }).isError)
              }
            } catch (error) {
              conn.status = {
                ...conn.status,
                state: 'error',
                error: error instanceof Error ? error.message : String(error)
              }
              this.broadcast()
              return {
                output: `MCP 工具调用失败：${error instanceof Error ? error.message : String(error)}`,
                isError: true
              }
            }
          }
        })
      }
      if (conn.status.resources?.length) {
        const name = `${prefix}resources`
        if (!definitions.some((definition) => definition.name === name)) {
          definitions.push({
            name,
            displayName: `MCP · ${conn.config.name} 资源`,
            description: `[MCP 服务器：${conn.config.name}] 列出或读取 resources。action=list 或 read；read 需要 uri。`,
            inputSchema: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['list', 'read'] },
                uri: { type: 'string' }
              },
              required: ['action'],
              additionalProperties: false
            },
            risk: 'mcp',
            summarize: (args) => `${conn.config.name} 资源 ${String(args.action ?? 'list')}`,
            execute: async (args) => {
              try {
                if (String(args.action) === 'read') {
                  const uri = typeof args.uri === 'string' ? args.uri : ''
                  if (!uri) return { output: 'read 需要 uri 参数', isError: true }
                  const result = await client.readResource({ uri })
                  const contents = (result.contents ?? []).map((item) => {
                    const record = item as Record<string, unknown>
                    if (typeof record.text === 'string') return record.text
                    return `[资源 ${String(record.uri ?? uri)}，${String(record.mimeType ?? 'binary')}]`
                  })
                  return { output: contents.join('\n\n') || '(资源没有返回文本)' }
                }
                const listedResources = await client.listResources()
                const lines = (listedResources.resources ?? []).map(
                  (resource) =>
                    `- ${resource.name} (${resource.uri})${resource.description ? `：${resource.description}` : ''}`
                )
                return { output: lines.join('\n') || '(没有 resources)' }
              } catch (error) {
                return {
                  output: `MCP resources 调用失败：${error instanceof Error ? error.message : String(error)}`,
                  isError: true
                }
              }
            }
          })
        }
      }
      if (conn.status.prompts?.length) {
        const name = `${prefix}prompts`
        if (!definitions.some((definition) => definition.name === name)) {
          definitions.push({
            name,
            displayName: `MCP · ${conn.config.name} 提示`,
            description: `[MCP 服务器：${conn.config.name}] 列出或获取 prompts。action=list 或 get；get 需要 name 和 arguments。`,
            inputSchema: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['list', 'get'] },
                name: { type: 'string' },
                arguments: { type: 'object', additionalProperties: true }
              },
              required: ['action'],
              additionalProperties: false
            },
            risk: 'mcp',
            summarize: (args) => `${conn.config.name} 提示 ${String(args.action ?? 'list')}`,
            execute: async (args) => {
              try {
                if (String(args.action) === 'get') {
                  const promptName = typeof args.name === 'string' ? args.name : ''
                  if (!promptName) return { output: 'get 需要 name 参数', isError: true }
                  const promptArguments =
                    args.arguments && typeof args.arguments === 'object'
                      ? (args.arguments as Record<string, string>)
                      : {}
                  const result = await client.getPrompt({
                    name: promptName,
                    arguments: promptArguments
                  })
                  const lines = (result.messages ?? []).map((message) => {
                    const content = message.content as unknown
                    if (content && typeof content === 'object' && 'text' in content) {
                      return `[${message.role}] ${String((content as { text?: unknown }).text ?? '')}`
                    }
                    return `[${message.role}] ${JSON.stringify(content)}`
                  })
                  return { output: lines.join('\n\n') || '(提示没有返回内容)' }
                }
                const listedPrompts = await client.listPrompts()
                const lines = (listedPrompts.prompts ?? []).map(
                  (prompt) =>
                    `- ${prompt.name}${prompt.description ? `：${prompt.description}` : ''}`
                )
                return { output: lines.join('\n') || '(没有 prompts)' }
              } catch (error) {
                return {
                  output: `MCP prompts 调用失败：${error instanceof Error ? error.message : String(error)}`,
                  isError: true
                }
              }
            }
          })
        }
      }
    }
    return definitions
  }

  async test(config: McpServerConfig): Promise<McpTestResult> {
    try {
      const { client, tools, resources, prompts } = await this.connect({ ...config, enabled: true })
      await client.close().catch(() => undefined)
      return {
        ok: true,
        message: `连接成功，发现 ${tools.length} 个工具、${resources.length} 个资源、${prompts.length} 个提示`,
        tools,
        resources,
        prompts
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async closeAll(): Promise<void> {
    const ids = [...this.connections.keys()]
    for (const id of ids) {
      await this.closeConnection(id)
    }
  }
}
