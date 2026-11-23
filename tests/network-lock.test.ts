import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '../app/src/main/agent/tools/types'

vi.mock('../app/src/main/state', () => ({
  NETWORK_LOCKED_ERROR: '断网锁已开启',
  state: {
    settings: {
      getRaw: () => ({ networkLocked: true })
    }
  }
}))

import { withNetworkLock } from '../app/src/main/network-lock'

describe('network lock command guard', () => {
  it('blocks common download commands when locked', async () => {
    const execute = vi.fn().mockResolvedValue({ output: 'ok' })
    const tool = withNetworkLock({
      name: 'run_command',
      execute
    } as unknown as ToolDefinition)
    const context = {
      workspace: '.',
      signal: new AbortController().signal,
      onOutput: () => undefined
    }
    const commands = [
      'curl https://example.com/file',
      'bitsadmin /transfer job http://example.com/a',
      'certutil -urlcache -split -f http://example.com/a a.txt',
      'rundll32 url.dll,FileProtocolHandler http://example.com',
      'git pull origin main',
      'npx some-package',
      'powershell -EncodedCommand AAAA'
    ]
    for (const command of commands) {
      await expect(tool.execute({ command }, context)).rejects.toThrow('断网锁已开启')
    }
    expect(execute).not.toHaveBeenCalled()
  })

  it('lets ordinary build commands through when locked', async () => {
    const execute = vi.fn().mockResolvedValue({ output: 'built' })
    const tool = withNetworkLock({
      name: 'run_command',
      execute
    } as unknown as ToolDefinition)
    const context = {
      workspace: '.',
      signal: new AbortController().signal,
      onOutput: () => undefined
    }
    await expect(tool.execute({ command: 'npm run build' }, context)).resolves.toEqual({
      output: 'built'
    })
  })
})