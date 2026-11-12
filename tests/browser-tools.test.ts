import { describe, expect, it } from 'vitest'
import {
  createBrowserTools,
  sanitizeWindowsFilename,
  type BrowserVisionShot
} from '../app/src/main/agent/tools/browser'

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

  it('formats a document title into a safe Windows zip name', () => {
    const result = sanitizeWindowsFilename(
      '  关于调整：2026年“校园体育”比赛/报名?的通知 * .  '
    )
    expect(result.value).toBe('关于调整：2026年“校园体育”比赛报名的通知')
    expect(result.removed).toEqual(expect.arrayContaining(['/', '?', '*']))
    expect(result.value).not.toMatch(/[<>:"/\\|?*]/)
    expect(result.value.endsWith('.')).toBe(false)

    expect(sanitizeWindowsFilename('CON').value).toBe('_CON')
    expect(sanitizeWindowsFilename('a'.repeat(300)).truncated).toBe(true)
  })

  it('reads a title from the document and copies the formatted value', async () => {
    let copied = ''
    const bridge = {
      command: async () => ({
        found: true,
        text: '发文标题: 2026年测试/通知?',
        selector: '#title',
        tag: 'textarea',
        id: 'title',
        readonly: true,
        pageTitle: '显示公文'
      })
    }
    const tools = createBrowserTools(
      bridge as never,
      () => null,
      () => false,
      undefined,
      (text) => {
        copied = text
      }
    )
    const title = tools.find((tool) => tool.name === 'browser_document_title')!
    const result = await title.execute({}, context)
    expect(copied).toBe('发文标题 2026年测试通知')
    expect(result.output).toContain('发文标题 2026年测试通知')
    expect(result.output).toContain('"copied": true')
  })

  it('runs multiple browser steps in one tool call', async () => {
    const calls: Array<{ action: string; params: Record<string, unknown> }> = []
    const bridge = {
      command: async (_win: unknown, action: string, params: Record<string, unknown>) => {
        calls.push({ action, params })
        return { ok: true, action }
      }
    }
    const tools = createBrowserTools(bridge as never, () => null)
    const batch = tools.find((tool) => tool.name === 'browser_batch')!
    const result = await batch.execute(
      {
        steps: [
          { action: 'fill', selector: '#name', value: '张三' },
          { action: 'click', selector: '#submit' },
          { action: 'wait', ms: 1 }
        ]
      },
      context
    )
    expect(calls).toHaveLength(2)
    expect(calls[0].action).toBe('fill')
    expect(calls[1].action).toBe('click')
    expect(result.output).toContain('"ok": true')
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
