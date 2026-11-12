import { describe, expect, it } from 'vitest'
import { isBlockedAddress, webFetchTool } from '../app/src/main/agent/tools/system'

describe('web_fetch network guard', () => {
  it('blocks loopback and private addresses', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true)
    expect(isBlockedAddress('10.1.2.3')).toBe(true)
    expect(isBlockedAddress('192.168.1.1')).toBe(true)
    expect(isBlockedAddress('169.254.1.1')).toBe(true)
    expect(isBlockedAddress('::1')).toBe(true)
    expect(isBlockedAddress('8.8.8.8')).toBe(false)
    expect(isBlockedAddress('1.1.1.1')).toBe(false)
  })

  it('refuses to fetch a loopback URL before sending a request', async () => {
    await expect(
      webFetchTool.execute(
        { url: 'http://127.0.0.1:65535/' },
        { workspace: '.', signal: new AbortController().signal, onOutput: () => undefined }
      )
    ).rejects.toThrow('不允许访问本机或内网地址')
  })

  it('refuses localhost hostnames without DNS lookup', async () => {
    await expect(
      webFetchTool.execute(
        { url: 'http://localhost:65535/' },
        { workspace: '.', signal: new AbortController().signal, onOutput: () => undefined }
      )
    ).rejects.toThrow('不允许访问本机或内网地址')
  })
})