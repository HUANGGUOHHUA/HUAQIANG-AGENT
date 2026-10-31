import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
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

  if (!isInside(absoluteRoot, target) && !isInside(absoluteRoot.toLowerCase(), target.toLowerCase())) {
    throw new Error(`路径超出工作区范围：${input}`)
  }

  const realRoot = await realpath(absoluteRoot).catch(() => absoluteRoot)
  let probe = target
  const missing: string[] = []
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) break
    missing.unshift(basename(probe))
    probe = parent
  }
  const realProbe = await realpath(probe).catch(() => probe)
  if (!isInside(realRoot, realProbe) && !isInside(realRoot.toLowerCase(), realProbe.toLowerCase())) {
    throw new Error(`路径通过符号链接指向工作区之外：${input}`)
  }
  return missing.length ? join(realProbe, ...missing) : realProbe
}

export function displayPath(root: string, absolute: string): string {
  const rel = relative(root, absolute)
  return (rel || '.').split('\\').join('/')
}
