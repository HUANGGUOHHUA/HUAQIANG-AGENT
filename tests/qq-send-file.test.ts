import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  desktopCapturer: { getSources: async () => [] },
  ipcMain: { handle: () => undefined },
  screen: {
    getPrimaryDisplay: () => ({ id: 1, size: { width: 1920, height: 1080 }, scaleFactor: 1 })
  }
}))

import { createDesktopTools } from '../app/src/main/agent/tools/desktop'

const workspace = mkdtempSync(join(tmpdir(), 'hq-qq-send-'))
const context = {
  workspace,
  signal: new AbortController().signal,
  onOutput: () => undefined
}
const tool = createDesktopTools(() => null).find((item) => item.name === 'qq_send_file')!

describe('qq_send_file', () => {
  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('is registered with network risk and always asks for approval in auto mode', () => {
    expect(tool).toBeTruthy()
    expect(tool.risk).toBe('network')
    expect(tool.confirmInAuto).toBe(true)
    expect(tool.summarize({ uin: '10001', path: 'D:\\x\\report.pdf' })).toContain('report.pdf')
  })

  it('rejects an invalid QQ number before touching the desktop', async () => {
    writeFileSync(join(workspace, 'a.txt'), 'x')
    await expect(tool.execute({ uin: 'not-a-uin', path: 'a.txt' }, context)).rejects.toThrow(/QQ 号/)
    await expect(tool.execute({ uin: '123', path: 'a.txt' }, context)).rejects.toThrow(/QQ 号/)
  })

  it('rejects a missing file', async () => {
    await expect(tool.execute({ uin: '10001', path: 'missing.txt' }, context)).rejects.toThrow(
      /无法读取文件/
    )
  })

  it('rejects a directory', async () => {
    await expect(tool.execute({ uin: '10001', path: '.' }, context)).rejects.toThrow(/不能是目录/)
  })

  it('rejects an empty file', async () => {
    writeFileSync(join(workspace, 'empty.txt'), '')
    await expect(tool.execute({ uin: '10001', path: 'empty.txt' }, context)).rejects.toThrow(
      /文件是空的/
    )
  })
})