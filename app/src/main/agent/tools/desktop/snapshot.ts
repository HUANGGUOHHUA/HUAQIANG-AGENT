import { numberArg, stringArg } from '../types'

/** ui_snapshot 返回的单条窗口/控件记录。 */
export interface UiSnapshotItem {
  index?: number
  id?: string
  kind?: string
  name?: string
  type?: string
  x?: number
  y?: number
  width?: number
  height?: number
}

/** 快照结果缓存的有效期；过期后重新枚举一次。 */
const UI_CACHE_TTL_MS = 1_500

export function parseUiItems(output: string): UiSnapshotItem[] {
  try {
    const parsed = JSON.parse(output) as { items?: unknown }
    return Array.isArray(parsed.items) ? (parsed.items as UiSnapshotItem[]) : []
  } catch {
    return []
  }
}

/** 按 id → index → name/type 的优先级挑出目标控件。 */
export function pickUiItem(
  items: UiSnapshotItem[],
  args: Record<string, unknown>
): UiSnapshotItem | null {
  const wantedId = stringArg(args, 'id').trim()
  if (wantedId) {
    return items.find((item) => item.id === wantedId) ?? null
  }
  const index = numberArg(args, 'index', -1, -1, 100_000)
  if (index >= 0) {
    return items.find((item) => item.index === index) ?? null
  }
  const wantedName = stringArg(args, 'name').trim().toLowerCase()
  const wantedType = stringArg(args, 'type').trim().toLowerCase()
  if (!wantedName && !wantedType) return null
  const candidates = items.filter((item) => {
    if (item.kind !== 'control') return false
    if (wantedType && String(item.type ?? '').toLowerCase() !== wantedType) return false
    if (!wantedName) return true
    return String(item.name ?? '').toLowerCase().includes(wantedName)
  })
  if (!candidates.length) return null
  return (
    candidates.find((item) => String(item.name ?? '').toLowerCase() === wantedName) ?? candidates[0]
  )
}

/** 只对最近一次快照有效的小缓存，避免一次任务里重复枚举 UIA 树。 */
export class SnapshotCache {
  private entry: { items: UiSnapshotItem[]; at: number } | null = null

  get(): UiSnapshotItem[] | null {
    if (!this.entry) return null
    return Date.now() - this.entry.at <= UI_CACHE_TTL_MS ? this.entry.items : null
  }

  set(items: UiSnapshotItem[]): void {
    this.entry = { items, at: Date.now() }
  }

  clear(): void {
    this.entry = null
  }
}
