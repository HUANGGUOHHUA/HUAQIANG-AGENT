import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

let tempBase: string | null = null
let tempEnv: Record<string, string> | null = null

/** Configured once at startup with a directory the app can write. */
export function setToolTempBase(dir: string): void {
  tempBase = dir
  tempEnv = null
}

/**
 * Temp directory for spawned tools. Security software can block the default
 * `%TEMP%` for this app, which breaks Python's tempfile and pip; use a folder
 * under the app data directory instead.
 */
export function toolTempEnv(): NodeJS.ProcessEnv {
  if (!tempBase) return { ...process.env }
  if (!tempEnv) {
    const dir = join(tempBase, 'tmp')
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // Ignore; the caller keeps the default temp directory.
    }
    tempEnv = existsSync(dir) ? { TMP: dir, TEMP: dir, TMPDIR: dir } : {}
  }
  return { ...process.env, ...tempEnv }
}
