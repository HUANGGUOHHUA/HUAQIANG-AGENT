import net from 'node:net'
import { appendFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createFileTools } from './agent/tools/files'
import { runCommandTool } from './agent/tools/shell'
import { revealTool } from './agent/tools/reveal'
import { systemInfoTool, webFetchTool } from './agent/tools/system'
import type { ToolDefinition } from './agent/tools/types'
import { BuiltinMcpService } from './mcp-builtin'

function argValue(name: string): string {
  const prefix = `--${name}=`
  const hit = process.argv.find((item) => item.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : ''
}

const pipeName = argValue('pipe')
const token = argValue('token')
const pythonPath = argValue('python')
const logFile = argValue('log')

function log(line: string): void {
  if (!logFile) return
  try {
    appendFileSync(logFile, `[${new Date().toISOString()}] worker ${line}\n`)
  } catch {
    // Logging must never break the worker.
  }
}

if (!pipeName) {
  log('missing --pipe')
  process.exit(1)
}

const toolMap = new Map<string, ToolDefinition>(
  [...createFileTools(), runCommandTool, systemInfoTool, webFetchTool, revealTool].map((tool) => [tool.name, tool])
)

let workspace = ''
const builtin = new BuiltinMcpService({
  workspace: () => workspace,
  pythonPath: () => pythonPath,
  version: 'agent-worker'
})
let mcpClient: Client | null = null

async function ensureMcpClient(): Promise<Client> {
  if (mcpClient) return mcpClient
  const transport = await builtin.start()
  const client = new Client({ name: 'huaqiang-agent-worker', version: '1.0.0' }, { capabilities: {} })
  await client.connect(transport)
  mcpClient = client
  return client
}

const socket = net.connect(pipeName)
socket.setEncoding('utf8')
socket.on('connect', () => {
  log('connected')
  socket.write(`${JSON.stringify({ type: 'hello', token })}\n`)
})
socket.on('error', (error) => {
  log(`socket error: ${String(error)}`)
  process.exit(1)
})
socket.on('close', () => process.exit(0))

const pending = new Map<string, AbortController>()
let buffer = ''

function send(payload: unknown): void {
  try {
    socket.write(`${JSON.stringify(payload)}\n`)
  } catch {
    // The parent will notice the closed pipe.
  }
}

interface WorkerRequest {
  type: string
  id?: string
  tool?: string
  args?: Record<string, unknown>
  workspace?: string
}

async function handle(message: WorkerRequest): Promise<void> {
  if (message.type === 'cancel' && message.id) {
    pending.get(message.id)?.abort()
    return
  }
  if (message.type !== 'execute' || !message.id || !message.tool) return
  const id = message.id
  if (typeof message.workspace === 'string' && message.workspace) workspace = message.workspace
  const controller = new AbortController()
  pending.set(id, controller)
  try {
    const local = toolMap.get(message.tool)
    if (local) {
      const result = await local.execute(message.args ?? {}, {
        workspace,
        signal: controller.signal,
        onOutput: (chunk) => send({ id, type: 'output', chunk })
      })
      send({ id, type: 'result', output: result.output, isError: Boolean(result.isError), stats: result.stats })
    } else {
      const client = await ensureMcpClient()
      const result = await client.callTool(
        { name: message.tool, arguments: message.args ?? {} },
        undefined,
        { timeout: 300_000 }
      )
      const content = Array.isArray(result.content) ? result.content : []
      const text = content
        .map((item) => {
          const block = item as { type?: string; text?: string }
          return block && block.type === 'text' ? String(block.text ?? '') : ''
        })
        .filter(Boolean)
        .join('\n')
      send({
        id,
        type: 'result',
        output: text || '(无输出)',
        isError: Boolean((result as { isError?: boolean }).isError)
      })
    }
  } catch (error) {
    send({
      id,
      type: 'result',
      output: error instanceof Error ? error.message : String(error),
      isError: true
    })
  } finally {
    pending.delete(id)
  }
}

socket.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    index = buffer.indexOf('\n')
    if (!line.trim()) continue
    try {
      void handle(JSON.parse(line) as WorkerRequest)
    } catch {
      // Ignore malformed requests.
    }
  }
})

log('started')
