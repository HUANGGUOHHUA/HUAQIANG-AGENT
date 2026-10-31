import crypto from 'node:crypto'
import { BrowserWindow, ipcMain } from 'electron'
import type { BrowserAction, BrowserCommandResult } from '../shared/types'

const COMMAND_TIMEOUT_MS = 30_000
const MAX_DATA_CHARS = 50_000

interface PendingCommand {
  resolve: (data: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class BrowserBridge {
  private readonly pending = new Map<string, PendingCommand>()
  private readonly prefix: 'browser' | 'app'
  private registered = false

  constructor(prefix: 'browser' | 'app' = 'browser') {
    this.prefix = prefix
  }

  private get label(): string {
    return this.prefix === 'browser' ? '浏览器' : '界面'
  }

  registerIpc(): void {
    if (this.registered) return
    this.registered = true
    ipcMain.handle(`${this.prefix}:result`, (_event, result: BrowserCommandResult) => {
      if (!result || typeof result !== 'object' || typeof result.id !== 'string') return
      const entry = this.pending.get(result.id)
      if (!entry) return
      this.pending.delete(result.id)
      clearTimeout(entry.timer)
      if (result.ok) {
        entry.resolve(this.clampData(result.data))
      } else {
        entry.reject(new Error(result.error || `${this.label}操作失败`))
      }
    })
  }

  command(
    win: BrowserWindow | null,
    action: BrowserAction | string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    if (!win || win.isDestroyed()) return Promise.reject(new Error('窗口不可用'))
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.label}操作超时`))
      }, COMMAND_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      win.webContents.send(`${this.prefix}:command`, { id, action, params })
    })
  }

  private clampData(data: unknown): unknown {
    if (data === undefined || data === null) return data
    const serialized = JSON.stringify(data)
    if (typeof serialized !== 'string') return undefined
    if (serialized.length <= MAX_DATA_CHARS) return data
    return `${serialized.slice(0, MAX_DATA_CHARS)}…（内容已截断）`
  }
}
