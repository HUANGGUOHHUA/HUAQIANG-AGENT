import { describe, expect, it } from 'vitest'
import { createBrowserTools, type BrowserVisionShot } from '../app/src/main/agent/tools/browser'

const context = {
  workspace: 'D:\\desk\\demo',
  signal: new AbortController().signal,
  onOutput: () => undefined
}

describe('browser control tools', () => {
  it('passes selector/text clicks and autofill fields to the bridge', async () => {
    const calls: Array<{ action: string; params: Record<string, unknown> }> = []
    const bridge = {
      command: async (_win: unknown, action: string, params: Record<string, unknown>) => {
        calls.push({ action, params })
        return { ok: true }
      }
    }
    const tools = createBrowserTools(bridge as never, () => null)
    const click = tools.find((tool) => tool.name === 'browser_click')!
    await click.execute({ selector: '#submit', text: '提交' }, context)
    expect(calls[0]).toMatchObject({
      action: 'click',
      params: { selector: '#submit', text: '提交' }
    })

    const autofill = tools.find((tool) => tool.name === 'browser_autofill')!
    await autofill.execute({ fields: { 用户名: '张三' }, submit: true }, context)
    expect(calls[1]).toMatchObject({
      action: 'autofill',
      params: { fields: { 用户名: '张三' }, submit: true }
    })
  })

  it('uses the vision analyzer only when a screenshot is available', async () => {
    const shot: BrowserVisionShot = {
      dataUrl: 'data:image/png;base64,AAAA',
      width: 800,
      height: 600,
      url: 'https://example.com',
      title: 'Example'
    }
    let received: BrowserVisionShot | null = null
    const bridge = { command: async () => shot }
    const tools = createBrowserTools(
      bridge as never,
      () => null,
      () => false,
      async (question, image) => {
        received = image
        return `${question}: 页面标题 Example`
      }
    )
    const vision = tools.find((tool) => tool.name === 'browser_vision')!
    const result = await vision.execute({ question: '找出登录按钮' }, context)
    expect(received).toEqual(shot)
    expect(result.output).toContain('页面标题 Example')
  })
})
