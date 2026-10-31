import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import type { ToolDefinition, ToolResult } from './agent/tools/types'

const EXECUTE_TIMEOUT_MS = 15 * 60_000
const CONNECT_TIMEOUT_MS = 45_000

interface PendingCall {
  resolve: (result: ToolResult) => void
  reject: (error: Error) => void
  onOutput: (chunk: string) => void
  timer: NodeJS.Timeout
  cleanup: () => void
}

export interface AgentWorkerOptions {
  execPath: string
  workerScript: string
  workingDir: string
  pythonPath: string
  logFile: string
  elevated: boolean
  scriptDir: string
}

/**
 * Runs the workspace-writing tools in a separate, optionally elevated process
 * so the UI window keeps normal privileges (Explorer drag & drop keeps
 * working). Communication uses a named pipe.
 */
export class AgentWorkerBridge {
  private readonly pipeName = `\\\\.\\pipe\\hq-agent-${randomUUID()}`
  private readonly token = randomUUID()
  private server: Server | null = null
  private socket: Socket | null = null
  private authorized = false
  private pending = new Map<string, PendingCall>()
  private buffer = ''
  private workspace = ''

  ready = false

  constructor(private readonly options: AgentWorkerOptions) {}

  private log(line: string): void {
    try {
      appendFileSync(this.options.logFile, `[${new Date().toISOString()}] bridge ${line}\n`)
    } catch {
      // Logging must never break the app.
    }
  }

  async start(): Promise<boolean> {
    await this.listen()
    this.log(`pipe=${this.pipeName} elevated=${this.options.elevated}`)
    try {
      this.spawn()
    } catch (error) {
      this.log(`spawn failed: ${String(error)}`)
      this.close()
      return false
    }
    const deadline = Date.now() + CONNECT_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.ready) return true
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    this.log('worker did not connect in time')
    this.close()
    return false
  }

  private listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => this.onConnection(socket))
      this.server.once('error', reject)
      this.server.listen(this.pipeName, () => resolve())
    })
  }

  private onConnection(socket: Socket): void {
    this.socket = socket
    this.authorized = false
    this.buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => this.onData(String(chunk)))
    socket.on('error', (error) => this.log(`socket error: ${String(error)}`))
    socket.on('close', () => {
      this.log('worker socket closed')
      this.ready = false
      this.socket = null
      for (const [id, call] of this.pending) {
        clearTimeout(call.timer)
        call.cleanup()
        call.reject(new Error('管理员辅助进程已断开'))
        this.pending.delete(id)
      }
    })
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      index = this.buffer.indexOf('\n')
      if (!line.trim()) continue
      let message: Record<string, unknown>
      try {
        message = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      if (message.type === 'hello') {
        if (message.token === this.token) {
          this.authorized = true
          this.ready = true
          this.log('worker authorized')
        } else {
          this.log('worker token mismatch')
          this.socket?.destroy()
        }
        continue
      }
      if (!this.authorized) continue
      const id = typeof message.id === 'string' ? message.id : ''
      const call = id ? this.pending.get(id) : undefined
      if (!call) continue
      if (message.type === 'output' && typeof message.chunk === 'string') {
        call.onOutput(message.chunk)
      } else if (message.type === 'result') {
        clearTimeout(call.timer)
        call.cleanup()
        this.pending.delete(id)
        call.resolve({
          output: typeof message.output === 'string' ? message.output : '',
          isError: Boolean(message.isError),
          stats: message.stats as ToolResult['stats']
        })
      }
    }
  }

  private spawn(): void {
    const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`
    // UAC elevation does not inherit the parent environment, so
    // ELECTRON_RUN_AS_NODE must be set inside the elevated launch script.
    const scriptPath = `${this.options.scriptDir}\\worker-launch-${Date.now()}.ps1`
    const marker = this.options.logFile
    const launchScript = [
      "$ErrorActionPreference = 'Stop'",
      `"launch $(Get-Date -Format o)" | Out-File -FilePath '${marker}' -Append -Encoding utf8`,
      'try {',
      "  $env:ELECTRON_RUN_AS_NODE = '1'",
      `  & '${this.options.execPath}' '${this.options.workerScript}' '--pipe=${this.pipeName}' '--token=${this.token}' '--python=${this.options.pythonPath}' '--log=${this.options.logFile}'`,
      `  "worker exited $LASTEXITCODE $(Get-Date -Format o)" | Out-File -FilePath '${marker}' -Append -Encoding utf8`,
      '} catch {',
      `  "worker launch error: $_" | Out-File -FilePath '${marker}' -Append -Encoding utf8`,
      '  exit 1',
      '}'
    ].join('\r\n')
    writeFileSync(scriptPath, launchScript, 'utf8')

    const command = [
      'try {',
      "Start-Process -FilePath 'powershell.exe'",
      `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${quote(scriptPath)})`,
      `-WorkingDirectory ${quote(this.options.workingDir)}`,
      this.options.elevated ? '-Verb RunAs' : '',
      '-ErrorAction Stop',
      '} catch { exit 1 }'
    ]
      .filter(Boolean)
      .join(' ')
    execFile(
      'powershell.exe',
      ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', command],
      { windowsHide: true, timeout: 120_000 },
      (error, stdout, stderr) => {
        if (error) {
          this.log(`launch command failed: ${error.message} ${String(stderr).slice(0, 300)}`)
        } else {
          this.log(`launch command ok ${String(stdout).trim().slice(0, 200)}`)
        }
      }
    )
    this.log(`worker launch script: ${scriptPath}`)
  }

  execute(
    tool: string,
    args: Record<string, unknown>,
    context: { workspace: string; signal: AbortSignal; onOutput: (chunk: string) => void }
  ): Promise<ToolResult> {
    if (!this.ready || !this.socket) {
      return Promise.reject(new Error('管理员辅助进程尚未就绪'))
    }
    const id = randomUUID()
    return new Promise<ToolResult>((resolve, reject) => {
      const onAbort = (): void => {
        try {
          this.socket?.write(`${JSON.stringify({ type: 'cancel', id })}\n`)
        } catch {
          // The socket may be closed already.
        }
      }
      context.signal.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => {
        this.pending.delete(id)
        context.signal.removeEventListener('abort', onAbort)
        this.socket?.write(`${JSON.stringify({ type: 'cancel', id })}\n`)
        reject(new Error('工具执行超时'))
      }, EXECUTE_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (result) => {
          context.signal.removeEventListener('abort', onAbort)
          resolve(result)
        },
        reject: (error) => {
          context.signal.removeEventListener('abort', onAbort)
          reject(error)
        },
        onOutput: context.onOutput,
        timer,
        cleanup: () => context.signal.removeEventListener('abort', onAbort)
      })
      try {
        this.socket!.write(
          `${JSON.stringify({ type: 'execute', id, tool, args, workspace: context.workspace })}\n`
        )
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        context.signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** Keep tool metadata for the model but send execution to the worker. */
  proxyTool(definition: ToolDefinition): ToolDefinition {
    return {
      ...definition,
      execute: (args, context) => this.execute(definition.name, args, context)
    }
  }

  setWorkspace(workspace: string): void {
    this.workspace = workspace
  }

  executeBuiltin(
    tool: string,
    args: Record<string, unknown>
  ): Promise<{ output: string; isError?: boolean }> {
    return this.execute(tool, args, {
      workspace: this.workspace,
      signal: new AbortController().signal,
      onOutput: () => undefined
    })
  }

  close(): void {
    this.ready = false
    try {
      this.socket?.destroy()
    } catch {
      // Ignore.
    }
    try {
      this.server?.close()
    } catch {
      // Ignore.
    }
    this.socket = null
    this.server = null
  }
}
