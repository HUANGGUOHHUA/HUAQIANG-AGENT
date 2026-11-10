import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

let cached: string | null = null

/**
 * Persistent application data (API keys, sessions, settings).
 *
 * Development keeps it next to the source in `data/`, separate from the
 * Chromium profile in `.dev-profile/`. Packaged builds keep it in a `data/`
 * subdirectory of the writable user-data directory.
 */
export function dataDir(): string {
  if (cached) return cached

  const override = process.env.HQ_DATA_DIR?.trim()
  const dir = override
    ? resolve(override)
    : join(app.isPackaged ? app.getPath('userData') : app.getAppPath(), 'data')

  mkdirSync(dir, { recursive: true })
  cached = dir
  return dir
}
