import { describe, expect, it, vi } from 'vitest'
import type { BrowserCommand } from '../app/src/shared/types'
import { executeBrowserCommand } from '../app/src/renderer/src/lib/browser-command'
import { SNAPSHOT_SCRIPT } from '../app/src/renderer/src/lib/browser-scripts'

type View = Parameters<typeof executeBrowserCommand>[0]
type Host = Parameters<typeof executeBrowserCommand>[2]

function fakeView(script: (code: string) => unknown = () => undefined): View {
  return {
    executeJavaScript: async (code: string) => script(code),
    getURL: () => 'https://example.com/page',
    capturePage: async () => ({
      toDataURL: () => 'data:image/png;base64,AAAA',
      getSize: () => ({ width: 10, height: 20 })
    }),
    goBack: () => undefined,
    goForward: () => undefined,
    stop: () => undefined,
    reload: () => undefined
  } as unknown as View
}

function fakeHost(overrides: Partial<Host> = {}): Host {
  return {
    tabId: 'tab-1',
    normalizeUrl: (raw: string) => (raw.startsWith('http') ? raw : ''),
    loadAndWait: async () => undefined,
    send: async () => undefined,
    ...overrides
  }
}

function command(action: string, params: Record<string, unknown> = {}): BrowserCommand {
  return { id: 'cmd-1', action, params } as BrowserCommand
}

describe('browser command executor', () => {
  it('returns the snapshot payload', async () => {
    const send = vi.fn(async () => undefined)
    await executeBrowserCommand(fakeView(() => ({ items: [{ text: '保存' }] })), command('snapshot'), fakeHost({ send }))
    expect(send).toHaveBeenCalledWith({ id: 'cmd-1', ok: true, data: { items: [{ text: '保存' }] } })
  })

  it('opens a url and reports the tab it used', async () => {
    const send = vi.fn(async () => undefined)
    const loadAndWait = vi.fn(async () => undefined)
    await executeBrowserCommand(
      fakeView(() => '页面标题'),
      command('open', { url: 'https://example.com' }),
      fakeHost({ send, loadAndWait })
    )
    expect(loadAndWait).toHaveBeenCalledWith('https://example.com')
    expect(send).toHaveBeenCalledWith({
      id: 'cmd-1',
      ok: true,
      data: { url: 'https://example.com/page', title: '页面标题', tabId: 'tab-1' }
    })
  })

  it('rejects an empty url before touching the page', async () => {
    const send = vi.fn(async () => undefined)
    const loadAndWait = vi.fn(async () => undefined)
    await executeBrowserCommand(fakeView(), command('open', { url: '' }), fakeHost({ send, loadAndWait }))
    expect(loadAndWait).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith({ id: 'cmd-1', ok: false, error: '缺少网址' })
  })

  it('reports a missing control instead of a success', async () => {
    const send = vi.fn(async () => undefined)
    await executeBrowserCommand(fakeView(() => ({ missing: true })), command('click'), fakeHost({ send }))
    expect(send).toHaveBeenCalledWith({
      id: 'cmd-1',
      ok: false,
      error: '未找到匹配的控件，请先重新获取页面快照'
    })
  })

  it('reports navigation results', async () => {
    const send = vi.fn(async () => undefined)
    await executeBrowserCommand(fakeView(), command('back'), fakeHost({ send }))
    expect(send).toHaveBeenCalledWith({
      id: 'cmd-1',
      ok: true,
      data: { url: 'https://example.com/page' }
    })
  })

  it('turns a page error into a failed result', async () => {
    const send = vi.fn(async () => undefined)
    await executeBrowserCommand(
      fakeView(() => {
        throw new Error('页面已崩溃')
      }),
      command('snapshot'),
      fakeHost({ send })
    )
    expect(send).toHaveBeenCalledWith({ id: 'cmd-1', ok: false, error: '页面已崩溃' })
  })

  it('rejects unknown actions', async () => {
    const send = vi.fn(async () => undefined)
    await executeBrowserCommand(fakeView(), command('teleport'), fakeHost({ send }))
    expect(send).toHaveBeenCalledWith({ id: 'cmd-1', ok: false, error: '未知的浏览器操作：teleport' })
  })

  it('keeps the snapshot script self-contained', () => {
    expect(SNAPSHOT_SCRIPT).toContain('hqQueryAll')
    expect(SNAPSHOT_SCRIPT).not.toContain('${')
  })
})
