import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceService } from '../app/src/main/workspace'
import type { SettingsStore } from '../app/src/main/settings'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function makeService(): Promise<{ root: string; service: WorkspaceService }> {
  const root = await mkdtemp(join(tmpdir(), 'hq-workspace-io-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const settings = {
    getRaw: () => ({ workspace: root })
  } as unknown as SettingsStore
  return { root, service: new WorkspaceService(settings) }
}

describe('workspace editor io', () => {
  it('writes and rereads a text file inside the workspace', async () => {
    const { service } = await makeService()
    const saved = await service.write('index.html', '<h1>hello</h1>\n')
    expect(saved.binary).toBe(false)
    expect(saved.content).toContain('hello')
    const loaded = await service.read('index.html')
    expect(loaded.content).toBe('<h1>hello</h1>\n')
  })

  it('rejects writes outside the workspace', async () => {
    const { service } = await makeService()
    await expect(service.write('../escape.txt', 'no')).rejects.toThrow()
  })

  it('returns a data URL for image assets', async () => {
    const { service } = await makeService()
    await service.write('pixel.png', 'not-a-real-png')
    const asset = await service.readAsset('pixel.png')
    expect(asset.mime).toBe('image/png')
    expect(asset.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('extracts text from a PDF document', async () => {
    const { root, service } = await makeService()
    const content = Buffer.from('BT (PDF attachment text) Tj ET', 'latin1')
    const pdf = Buffer.concat([
      Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${content.length} >>\nstream\n`, 'latin1'),
      content,
      Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')
    ])
    await writeFile(join(root, 'doc.pdf'), pdf)
    const extracted = await service.extract('doc.pdf')
    expect(extracted.text).toContain('PDF attachment text')
  })
})
