import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const CASE_INSENSITIVE = process.platform === 'win32'

export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function insideAny(root: string, target: string): boolean {
  if (isInside(root, target)) return true
  return CASE_INSENSITIVE && isInside(root.toLowerCase(), target.toLowerCase())
}

/**
 * Resolve a user/model supplied path against the workspace and reject escapes,
 * including symlink escapes through existing parent directories.
 */
export async function resolveWithinRoot(root: string, input: unknown): Promise<string> {
  if (typeof input !== 'string') throw new Error('路径必须是字符串')
  if (input.includes('\0')) throw new Error('路径包含非法字符')
  const absoluteRoot = resolve(root)
  const target = isAbsolute(input) ? resolve(input) : resolve(absoluteRoot, input || '.')

  if (!insideAny(absoluteRoot, target)) {
    throw new Error(`路径超出工作区范围：${input}`)
  }

  const realRoot = await realpath(absoluteRoot).catch(() => absoluteRoot)
  let probe = target
  const missing: string[] = []
  while (true) {
    try {
      // lstat does not follow the final component, so a dangling symlink is
      // detected as existing instead of being treated as a missing path.
      await lstat(probe)
      break
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
      const parent = dirname(probe)
      if (parent === probe) break
      missing.unshift(basename(probe))
      probe = parent
    }
  }
  let realProbe: string
  try {
    realProbe = await realpath(probe)
  } catch {
    throw new Error(`路径包含无效或悬空的符号链接：${input}`)
  }
  if (!insideAny(realRoot, realProbe)) {
    throw new Error(`路径通过符号链接指向工作区之外：${input}`)
  }
  return missing.length ? join(realProbe, ...missing) : realProbe
}

export function displayPath(root: string, absolute: string): string {
  const rel = relative(root, absolute)
  return (rel || '.').split('\\').join('/')
}