import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import fg from 'fast-glob'
import { displayPath, resolveWithinRoot } from '../../security/paths'
import type { ToolDefinition, ToolResult } from './types'
import { ToolError, boolArg, formatBytes, numberArg, stringArg, truncate } from './types'

const SKIP_DIRS = new Set(['.git', 'node_modules', '.npm-cache', '.electron-cache', '__pycache__', '.venv'])
const MAX_READ = 2 * 1024 * 1024

async function readTextFile(absolute: string): Promise<{ text: string; size: number; truncated: boolean }> {
  const info = await stat(absolute)
  if (!info.isFile()) throw new ToolError('目标不是文件')
  const length = Math.min(info.size, MAX_READ)
  const handle = await open(absolute, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    const slice = buffer.subarray(0, bytesRead)
    if (slice.includes(0)) throw new ToolError('这是一个二进制文件，无法作为文本读取')
    const decoder = new TextDecoder('utf-8')
    return {
      text: info.size > MAX_READ ? decoder.decode(slice, { stream: true }) : decoder.decode(slice),
      size: info.size,
      truncated: info.size > MAX_READ
    }
  } finally {
    await handle.close()
  }
}

async function buildTree(
  root: string,
  dir: string,
  depth: number,
  prefix: string,
  lines: string[],
  counter: { value: number }
): Promise<void> {
  if (depth < 0 || counter.value >= 600) return
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const sorted = entries
    .filter((e) => !SKIP_DIRS.has(e.name))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
    })
  for (let i = 0; i < sorted.length; i++) {
    if (counter.value >= 600) {
      lines.push(`${prefix}…（条目过多，已截断）`)
      return
    }
    const entry = sorted[i]
    const last = i === sorted.length - 1
    const child = join(dir, entry.name)
    counter.value += 1
    if (entry.isDirectory()) {
      lines.push(`${prefix}${last ? '└─' : '├─'} ${entry.name}/`)
      if (depth > 0) {
        await buildTree(root, child, depth - 1, `${prefix}${last ? '   ' : '│  '}`, lines, counter)
      }
    } else if (entry.isSymbolicLink()) {
      lines.push(`${prefix}${last ? '└─' : '├─'} ${entry.name} -> [link]`)
    } else {
      let size = 0
      try {
        size = (await stat(child)).size
      } catch {
        size = 0
      }
      lines.push(`${prefix}${last ? '└─' : '├─'} ${entry.name}  ${formatBytes(size)}`)
    }
  }
}

function textResult(output: string, isError = false, stats?: ToolResult['stats']) {
  return { output: truncate(output, 200_000), isError, stats }
}

async function isWorkspaceRoot(workspace: string, target: string): Promise<boolean> {
  const root = await resolveWithinRoot(workspace, '.')
  return root.toLowerCase() === target.toLowerCase()
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

function lineStats(previous: string, next: string): { additions: number; deletions: number } {
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

export function createFileTools(): ToolDefinition[] {
  return [
    {
      name: 'list_files',
      displayName: '浏览目录',
      description:
        '列出工作区中的文件和文件夹。path 为相对工作区的路径，depth 控制递归深度（0-4）。需要了解项目结构时使用。',
      risk: 'read',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对路径，默认为工作区根目录' },
          depth: { type: 'number', description: '递归深度 0-4，默认 2' }
        },
        additionalProperties: false
      },
      summarize: (args) => `浏览 ${stringArg(args, 'path', { fallback: '.' }) || '.'}`,
      execute: async (args, context) => {
        const target = await resolveWithinRoot(context.workspace, stringArg(args, 'path', { fallback: '.' }) || '.')
        const depth = numberArg(args, 'depth', 2, 0, 4)
        const info = await stat(target)
        if (!info.isDirectory()) throw new ToolError('目标不是文件夹')
        const lines: string[] = [`${displayPath(context.workspace, target) || '.'}/`]
        const counter = { value: 0 }
        await buildTree(context.workspace, target, depth, '', lines, counter)
        return textResult(lines.join('\n'))
      }
    },
    {
      name: 'read_file',
      displayName: '读取文件',
      description:
        '读取工作区中的文本文件，返回带行号的内容。修改文件前应先读取。可用 start_line/end_line 读取指定范围。',
      risk: 'read',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对工作区的文件路径' },
          start_line: { type: 'number', description: '起始行，从 1 开始' },
          end_line: { type: 'number', description: '结束行（含）' }
        },
        required: ['path'],
        additionalProperties: false
      },
      summarize: (args) => `读取 ${stringArg(args, 'path') || '?'}`,
      execute: async (args, context) => {
        const input = stringArg(args, 'path', { required: true })
        const target = await resolveWithinRoot(context.workspace, input)
        const { text, size, truncated } = await readTextFile(target)
        const lines = text.split(/\r?\n/)
        const start = numberArg(args, 'start_line', 1, 1, Math.max(1, lines.length))
        const end = Math.min(
          lines.length,
          numberArg(args, 'end_line', Math.min(lines.length, start + 499), start, Math.max(start, lines.length))
        )
        const width = String(end).length
        const body = lines
          .slice(start - 1, end)
          .map((line, index) => `${String(start + index).padStart(width, ' ')} | ${line.slice(0, 4000)}`)
          .join('\n')
        const meta = [
          `路径: ${displayPath(context.workspace, target)}`,
          `大小: ${formatBytes(size)}  总行数: ${lines.length}`,
          truncated ? '注意: 文件较大，仅读取了前 2MB' : '',
          start > 1 || end < lines.length ? `显示第 ${start}-${end} 行` : '',
          ''
        ]
          .filter(Boolean)
          .join('\n')
        return textResult(`${meta}\n${body}`)
      }
    },
    {
      name: 'write_file',
      displayName: '写入文件',
      description:
        '创建新文件或完整覆盖已有文件（UTF-8）。请提供完整内容；修改已有文件时优先使用 edit_file。',
      risk: 'write',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对工作区的文件路径' },
          content: { type: 'string', description: '要写入的完整文件内容' }
        },
        required: ['path', 'content'],
        additionalProperties: false
      },
      summarize: (args) =>
        `写入 ${stringArg(args, 'path') || '?'}（${formatBytes(Buffer.byteLength(stringArg(args, 'content'), 'utf8'))}）`,
      execute: async (args, context) => {
        const input = stringArg(args, 'path', { required: true })
        const content = stringArg(args, 'content', { max: 5_000_000 })
        if (Buffer.byteLength(content, 'utf8') > 5_000_000) throw new ToolError('文件内容超过 5MB 限制')
        const target = await resolveWithinRoot(context.workspace, input)
        const existed = await stat(target).then((s) => s.isFile()).catch(() => false)
        const previous = existed ? await readFile(target, 'utf8').catch(() => '') : ''
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, content, 'utf8')
        return textResult(
          `${existed ? '已覆盖' : '已创建'} ${displayPath(context.workspace, target)}（${formatBytes(Buffer.byteLength(content, 'utf8'))}）`,
          false,
          lineStats(previous, content)
        )
      }
    },
    {
      name: 'edit_file',
      displayName: '编辑文件',
      description:
        '对已有文本文件做精确字符串替换。old_string 必须与文件内容完全一致；默认要求唯一匹配，replace_all=true 时替换全部。',
      risk: 'write',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对工作区的文件路径' },
          old_string: { type: 'string', description: '要替换的原文本（需完整、精确）' },
          new_string: { type: 'string', description: '替换后的新文本' },
          replace_all: { type: 'boolean', description: '是否替换所有匹配，默认 false' }
        },
        required: ['path', 'old_string', 'new_string'],
        additionalProperties: false
      },
      summarize: (args) => `编辑 ${stringArg(args, 'path') || '?'}`,
      execute: async (args, context) => {
        const input = stringArg(args, 'path', { required: true })
        const oldString = stringArg(args, 'old_string', { required: true, max: 1_000_000 })
        const newString = stringArg(args, 'new_string', { max: 1_000_000 })
        if (!oldString) throw new ToolError('old_string 不能为空')
        const target = await resolveWithinRoot(context.workspace, input)
        const { text, truncated } = await readTextFile(target)
        if (truncated) throw new ToolError('文件超过 2MB 读取限制，无法安全编辑，请改用 read_file 分段查看后用其他方式修改')
        const parts = text.split(oldString)
        const occurrences = parts.length - 1
        if (occurrences === 0) throw new ToolError('文件中没有找到 old_string，请先读取文件确认原文')
        const replaceAll = boolArg(args, 'replace_all', false)
        if (occurrences > 1 && !replaceAll) {
          throw new ToolError(`old_string 匹配到 ${occurrences} 处，请提供更多上下文或设置 replace_all=true`)
        }
        const updated = replaceAll ? parts.join(newString) : text.replace(oldString, newString)
        await writeFile(target, updated, 'utf8')
        return textResult(
          `已编辑 ${displayPath(context.workspace, target)}，替换 ${replaceAll ? occurrences : 1} 处`,
          false,
          lineStats(text, updated)
        )
      }
    },
    {
      name: 'create_directory',
      displayName: '新建目录',
      description: '在工作区内创建一个或多个目录（自动创建父目录）。',
      risk: 'write',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: '相对工作区的目录路径' } },
        required: ['path'],
        additionalProperties: false
      },
      summarize: (args) => `新建目录 ${stringArg(args, 'path') || '?'}`,
      execute: async (args, context) => {
        const target = await resolveWithinRoot(context.workspace, stringArg(args, 'path', { required: true }))
        await mkdir(target, { recursive: true })
        return textResult(`已创建目录 ${displayPath(context.workspace, target)}`)
      }
    },
    {
      name: 'delete_path',
      displayName: '删除文件',
      description: '删除工作区内的文件或文件夹。删除文件夹时必须设置 recursive=true。此操作不可恢复。',
      risk: 'write',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对工作区的路径' },
          recursive: { type: 'boolean', description: '删除文件夹时设为 true' }
        },
        required: ['path'],
        additionalProperties: false
      },
      summarize: (args) => `删除 ${stringArg(args, 'path') || '?'}`,
      execute: async (args, context) => {
        const input = stringArg(args, 'path', { required: true })
        const target = await resolveWithinRoot(context.workspace, input)
        if (await isWorkspaceRoot(context.workspace, target)) throw new ToolError('不能删除工作区根目录')
        const info = await stat(target).catch(() => null)
        if (!info) throw new ToolError('路径不存在')
        if (info.isDirectory() && !boolArg(args, 'recursive', false)) {
          throw new ToolError('目标是非空文件夹，需设置 recursive=true')
        }
        const removedLines = info.isFile() ? lineCount(await readFile(target, 'utf8').catch(() => '')) : 0
        await rm(target, { recursive: boolArg(args, 'recursive', false), force: false })
        return textResult(
          `已删除 ${displayPath(context.workspace, target)}`,
          false,
          { additions: 0, deletions: removedLines }
        )
      }
    },
    {
      name: 'move_file',
      displayName: '移动文件',
      description: '移动或重命名工作区内的文件/文件夹。目标已存在时会失败。',
      risk: 'write',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: '源路径' },
          destination: { type: 'string', description: '目标路径' }
        },
        required: ['source', 'destination'],
        additionalProperties: false
      },
      summarize: (args) => `移动 ${stringArg(args, 'source') || '?'} → ${stringArg(args, 'destination') || '?'}`,
      execute: async (args, context) => {
        const source = await resolveWithinRoot(context.workspace, stringArg(args, 'source', { required: true }))
        const destination = await resolveWithinRoot(
          context.workspace,
          stringArg(args, 'destination', { required: true })
        )
        if (await isWorkspaceRoot(context.workspace, source)) throw new ToolError('不能移动工作区根目录')
        const exists = await stat(destination).then(() => true).catch(() => false)
        if (exists) throw new ToolError('目标路径已存在')
        await mkdir(dirname(destination), { recursive: true })
        await rename(source, destination)
        return textResult(`已移动 ${displayPath(context.workspace, source)} → ${displayPath(context.workspace, destination)}`)
      }
    },
    {
      name: 'search_files',
      displayName: '搜索代码',
      description:
        '在工作区中按正则表达式搜索文本内容，返回文件:行:内容。可指定子目录和 glob（如 "*.ts"）。自动跳过 node_modules 和二进制文件。',
      risk: 'read',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '正则表达式' },
          path: { type: 'string', description: '搜索的子目录，默认工作区根目录' },
          glob: { type: 'string', description: '文件匹配模式，如 "**/*.ts" 或 "*.md"' },
          case_sensitive: { type: 'boolean', description: '是否区分大小写，默认 false' },
          max_results: { type: 'number', description: '最多返回条数，默认 60' }
        },
        required: ['query'],
        additionalProperties: false
      },
      summarize: (args) => `搜索 ${stringArg(args, 'query').slice(0, 60) || '?'}`,
      execute: async (args, context) => {
        const query = stringArg(args, 'query', { required: true, max: 500 })
        let regex: RegExp
        try {
          regex = new RegExp(query, boolArg(args, 'case_sensitive', false) ? 'g' : 'gi')
        } catch (error) {
          throw new ToolError(`正则表达式无效：${error instanceof Error ? error.message : String(error)}`)
        }
        const base = await resolveWithinRoot(context.workspace, stringArg(args, 'path', { fallback: '.' }) || '.')
        const pattern = stringArg(args, 'glob', { fallback: '' }).trim() || '**/*'
        if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..')) {
          throw new ToolError('glob 不能指向工作区之外')
        }
        const maxResults = numberArg(args, 'max_results', 60, 1, 200)
        const files = await fg(pattern, {
          cwd: base,
          onlyFiles: true,
          dot: false,
          followSymbolicLinks: false,
          ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**', '**/.venv/**'],
          absolute: true
        })
        const results: string[] = []
        let scanned = 0
        for (const file of files.slice(0, 5000)) {
          if (results.length >= maxResults) break
          const info = await stat(file).catch(() => null)
          if (!info || info.size > 1024 * 1024) continue
          const buffer = await readFile(file).catch(() => null)
          if (!buffer || buffer.subarray(0, 8000).includes(0)) continue
          scanned++
          const lines = buffer.toString('utf8').split(/\r?\n/)
          for (let i = 0; i < lines.length; i++) {
            regex.lastIndex = 0
            if (regex.test(lines[i])) {
              results.push(
                `${displayPath(context.workspace, file)}:${i + 1}: ${lines[i].trim().slice(0, 400)}`
              )
              if (results.length >= maxResults) break
            }
          }
        }
        if (!results.length) return textResult(`未找到匹配项（已扫描 ${scanned} 个文件）`)
        return textResult(
          `找到 ${results.length} 条结果${results.length >= maxResults ? '（已达到上限）' : ''}：\n${results.join('\n')}`
        )
      }
    }
  ]
}
