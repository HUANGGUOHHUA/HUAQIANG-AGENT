import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffWorkspace, snapshotWorkspace } from '../app/src/main/workspace-changes'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hq-workspace-diff-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

describe('workspace change detection', () => {
  it('detects shell-created, modified and deleted files with line stats', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'a.ts'), 'const a = 1\nconst b = 2\n', 'utf8')
    await writeFile(join(root, 'gone.ts'), 'gone\n', 'utf8')
    const before = await snapshotWorkspace(root)

    await writeFile(join(root, 'a.ts'), 'const a = 1\nconst c = 3\n', 'utf8')
    await writeFile(join(root, 'shell-created.ts'), 'export const x = 1\nexport const y = 2\n', 'utf8')
    await rm(join(root, 'gone.ts'))

    const after = await snapshotWorkspace(root)
    const changes = diffWorkspace(before, after)
    const byPath = new Map(changes.map((change) => [change.path, change]))
    expect(byPath.get('static.ts')).toBeUndefined()
    expect(byPath.get('shell-created.ts')).toMatchObject({
      kind: 'created',
      additions: 2,
      deletions: 0
    })
    expect(byPath.get('a.ts')).toMatchObject({
      kind: 'updated',
      additions: 1,
      deletions: 1
    })
    expect(byPath.get('gone.ts')).toMatchObject({
      kind: 'deleted',
      additions: 0,
      deletions: 1
    })
  })

  it('ignores node_modules and reports no changes for identical files', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'index.html'), '<h1>hello</h1>\n', 'utf8')
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'noise\n', 'utf8')
    const before = await snapshotWorkspace(root)
    const after = await snapshotWorkspace(root)
    expect(diffWorkspace(before, after)).toEqual([])
  })
})
