import { readFile, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import fg from 'fast-glob'
import type { WorkspaceChange } from '../shared/types'

const IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/out/**',
  '**/dist/**',
  '**/release/**',
  '**/coverage/**',
  '**/.dev-profile/**',
  '**/.npm-cache/**',
  '**/.electron-cache/**',
  '**/.electron-builder-cache/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/.next/**',
  '**/.cache/**'
]
const MAX_FILES = 4_000
const MAX_CONTENT_BYTES = 200_000
const MAX_TOTAL_CONTENT = 32 * 1024 * 1024
const MAX_CHANGES = 300

export interface SnapshotFile {
  content?: string
  size: number
  binary: boolean
}

export interface WorkspaceSnapshot {
  files: Map<string, SnapshotFile>
  truncated: boolean
}

function normalizePath(path: string): string {
  return path.split(sep).join('/')
}

function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function lineCount(text: string): number {
  return splitLines(text).length
}

function lineDiff(previous: string, next: string): { additions: number; deletions: number } {
  const oldLines = splitLines(previous)
  const newLines = splitLines(next)
  const oldCounts = new Map<string, number>()
  const newCounts = new Map<string, number>()
  for (const line of oldLines) oldCounts.set(line, (oldCounts.get(line) ?? 0) + 1)
  for (const line of newLines) newCounts.set(line, (newCounts.get(line) ?? 0) + 1)
  let common = 0
  for (const [line, count] of newCounts) {
    common += Math.min(count, oldCounts.get(line) ?? 0)
  }
  return {
    additions: Math.max(0, newLines.length - common),
    deletions: Math.max(0, oldLines.length - common)
  }
}

/** Snapshot text metadata/content so a run can detect shell-created files too. */
export async function snapshotWorkspace(root: string): Promise<WorkspaceSnapshot> {
  const files = new Map<string, SnapshotFile>()
  let truncated = false
  let totalContent = 0
  try {
    const paths = await fg('**/*', {
      cwd: root,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
      ignore: IGNORE,
      absolute: false
    })
    if (paths.length > MAX_FILES) truncated = true
    for (const path of paths.slice(0, MAX_FILES)) {
      const full = join(root, path)
      let info
      try {
        info = await stat(full)
      } catch {
        continue
      }
      if (!info.isFile()) continue
      let content: string | undefined
      let binary = false
      if (info.size <= MAX_CONTENT_BYTES && totalContent + info.size <= MAX_TOTAL_CONTENT) {
        try {
          const buffer = await readFile(full)
          if (buffer.subarray(0, 8_000).includes(0)) {
            binary = true
          } else {
            content = buffer.toString('utf8')
            totalContent += buffer.length
          }
        } catch {
          // The file may disappear while the agent is running.
        }
      }
      files.set(normalizePath(path), { content, size: info.size, binary })
    }
  } catch {
    // A missing/unreadable workspace produces an empty snapshot.
  }
  return { files, truncated }
}

export function diffWorkspace(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot
): WorkspaceChange[] {
  const changes: WorkspaceChange[] = []
  const paths = new Set([...before.files.keys(), ...after.files.keys()])
  for (const path of paths) {
    const previous = before.files.get(path)
    const next = after.files.get(path)
    if (!previous && next) {
      changes.push({
        path,
        kind: 'created',
        additions: next.content ? lineCount(next.content) : 0,
        deletions: 0
      })
      continue
    }
    if (previous && !next) {
      changes.push({
        path,
        kind: 'deleted',
        additions: 0,
        deletions: previous.content ? lineCount(previous.content) : 0
      })
      continue
    }
    if (!previous || !next) continue
    if (previous.content !== undefined && next.content !== undefined) {
      if (previous.content === next.content) continue
      changes.push({
        path,
        kind: 'updated',
        ...lineDiff(previous.content, next.content)
      })
    } else if (previous.size !== next.size) {
      changes.push({ path, kind: 'updated', additions: 0, deletions: 0 })
    }
  }
  return changes
    .sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
    .slice(0, MAX_CHANGES)
}
