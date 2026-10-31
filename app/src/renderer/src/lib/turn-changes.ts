import type { AppMessage, LineStats, ToolCallView } from '../../../shared/types'

export type FileChangeKind = 'created' | 'updated' | 'edited' | 'deleted' | 'moved' | 'directory'

export interface FileChange {
  path: string
  kind: FileChangeKind
  target?: string
  additions: number
  deletions: number
}

const FILE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'create_directory',
  'delete_path',
  'move_file'
])

function arg(call: ToolCallView, key: string): string {
  const value = call.args[key]
  return typeof value === 'string' ? value : ''
}

function lineCount(text: string): number {
  if (!text) return 0
  return (text.match(/\n/g) ?? []).length + (text.endsWith('\n') ? 0 : 1)
}

function statsFor(call: ToolCallView): LineStats {
  if (call.stats) return call.stats
  if (call.name === 'write_file') {
    return { additions: lineCount(arg(call, 'content')), deletions: 0 }
  }
  if (call.name === 'edit_file') {
    return {
      additions: lineCount(arg(call, 'new_string')),
      deletions: lineCount(arg(call, 'old_string'))
    }
  }
  if (call.name === 'delete_path') {
    return { additions: 0, deletions: lineCount(arg(call, 'content')) }
  }
  return { additions: 0, deletions: 0 }
}

function changeFor(call: ToolCallView): FileChange | null {
  if (!FILE_TOOLS.has(call.name) || call.status !== 'ok') return null
  const path = arg(call, 'path') || arg(call, 'source')
  if (!path) return null
  const stats = statsFor(call)
  if (call.name === 'write_file') {
    return {
      path,
      kind: call.result?.includes('已创建') ? 'created' : 'updated',
      ...stats
    }
  }
  if (call.name === 'edit_file') return { path, kind: 'edited', ...stats }
  if (call.name === 'create_directory') {
    return { path, kind: 'directory', additions: 0, deletions: 0 }
  }
  if (call.name === 'delete_path') return { path, kind: 'deleted', ...stats }
  if (call.name === 'move_file') {
    const target = arg(call, 'destination')
    return target ? { path, kind: 'moved', target, additions: 0, deletions: 0 } : null
  }
  return null
}

function kindRank(kind: FileChangeKind): number {
  if (kind === 'deleted') return 6
  if (kind === 'moved') return 5
  if (kind === 'created') return 1
  if (kind === 'directory') return 2
  return 3
}

export function collectTurnFileChanges(messages: AppMessage[]): FileChange[] {
  let lastUser = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      lastUser = index
      break
    }
  }
  if (lastUser < 0) return []

  const changes = new Map<string, FileChange>()
  for (let index = lastUser + 1; index < messages.length; index += 1) {
    for (const call of messages[index].toolCalls ?? []) {
      const change = changeFor(call)
      if (!change) continue
      const key = `${change.path}:${change.target ?? ''}`
      const previous = changes.get(key)
      if (!previous) {
        changes.set(key, change)
        continue
      }
      changes.set(key, {
        ...previous,
        kind: kindRank(change.kind) >= kindRank(previous.kind) ? change.kind : previous.kind,
        additions: previous.additions + change.additions,
        deletions: previous.deletions + change.deletions
      })
    }
  }
  return [...changes.values()].sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
}

export function turnChangeTotals(changes: FileChange[]): LineStats {
  return changes.reduce(
    (total, change) => ({
      additions: total.additions + change.additions,
      deletions: total.deletions + change.deletions
    }),
    { additions: 0, deletions: 0 }
  )
}

export function changeLabel(change: FileChange): string {
  switch (change.kind) {
    case 'created':
      return '新增'
    case 'updated':
      return '覆盖'
    case 'edited':
      return '修改'
    case 'deleted':
      return '删除'
    case 'moved':
      return '移动'
    case 'directory':
      return '目录'
  }
}
