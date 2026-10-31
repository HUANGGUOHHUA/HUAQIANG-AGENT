import type { LineStats, ToolRisk } from '../../../shared/types'

export interface ToolContext {
  workspace: string
  signal: AbortSignal
  onOutput: (chunk: string) => void
}

export interface ToolResult {
  output: string
  isError?: boolean
  stats?: LineStats
}

export interface ToolDefinition {
  name: string
  displayName: string
  description: string
  inputSchema: Record<string, unknown>
  risk: ToolRisk
  summarize: (args: Record<string, unknown>) => string
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>
}

export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

export function stringArg(
  args: Record<string, unknown>,
  key: string,
  options: { required?: boolean; max?: number; fallback?: string } = {}
): string {
  const value = args[key]
  if (typeof value !== 'string') {
    if (options.required) throw new ToolError(`参数 ${key} 必须是字符串`)
    return options.fallback ?? ''
  }
  return value.slice(0, options.max ?? 2_000_000)
}

export function numberArg(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = typeof args[key] === 'number' ? (args[key] as number) : Number(args[key])
  if (!Number.isFinite(value)) return fallback
  return Math.round(Math.min(max, Math.max(min, value)))
}

export function boolArg(args: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = args[key]
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

export function truncate(value: string, max: number, note = '\n…（内容已截断）'): string {
  if (value.length <= max) return value
  return value.slice(0, max) + note
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g
export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '')
}
