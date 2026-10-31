export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function formatRelative(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86_400_000
  if (timestamp >= startOfToday) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  if (timestamp >= startOfYesterday) return '昨天'
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes < 1) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function stripIpcError(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

export function deriveTitle(text: string): string {
  const cleaned = text
    .replace(/[#*`>\[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return '新对话'
  return cleaned.length > 28 ? `${cleaned.slice(0, 28)}…` : cleaned
}

export function shortPath(path: string, max = 34): string {
  if (path.length <= max) return path
  return `…${path.slice(-(max - 1))}`
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || path
}

export function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(path)
}

/** Text/code/config files that the side panel can preview. */
export function isTextPreviewPath(path: string): boolean {
  return (
    /\.(txt|md|markdown|json|jsonc|ya?ml|toml|ini|conf|log|csv|ts|tsx|js|jsx|mjs|cjs|py|ps1|sh|bat|cmd|html|htm|css|scss|less|xml|svg|vue|svelte|java|c|h|cpp|cc|hpp|cs|go|rs|kt|swift|rb|php|sql|gitignore|env)$/i.test(
      path
    ) || !/\.[^./\\]+$/.test(path)
  )
}
