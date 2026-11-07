import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  desktopCapturer: { getSources: async () => [] },
  ipcMain: { handle: () => undefined },
  screen: {
    getPrimaryDisplay: () => ({ id: 1, size: { width: 1920, height: 1080 }, scaleFactor: 1 })
  }
}))

import { DESKTOP_TOOL_NAMES, createDesktopTools, parseVisualAction } from '../app/src/main/agent/tools/desktop'

const context = {
  workspace: 'D:\\desk\\demo',
  signal: new AbortController().signal,
  onOutput: () => undefined
}

describe('desktop vision', () => {
  it('captures the virtual desktop and passes a PNG data URL to the vision analyzer', async () => {
    let received: { dataUrl?: string; url?: string; title?: string } | null = null
    const tools = createDesktopTools(() => null, {
      analyzeImage: async (question, image) => {
        received = image
        return `桌面分析：${question}`
      }
    })
    const tool = tools.find((item) => item.name === 'screen_vision')!
    const result = await tool.execute({ question: '当前桌面有什么窗口' }, context)
    expect(received).not.toBeNull()
    expect(received!.dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(received!.url).toBe('screen://virtual-desktop')
    expect(result.output).toContain('桌面分析')
  }, 45_000)

  it('parses a visual action and executes a single generic step', async () => {
    expect(parseVisualAction('{"action":"click","x":10,"y":20}')).toMatchObject({
      action: 'click',
      x: 10,
      y: 20
    })
    expect(parseVisualAction('```json\n{"action":"done","message":"完成"}\n```')).toEqual({
      action: 'done',
      message: '完成'
    })
    expect(
      parseVisualAction('{"action":"paste_file","path":"D:\\\\tmp\\\\a.zip"}')
    ).toEqual({ action: 'paste_file', paths: ['D:\\tmp\\a.zip'] })
    expect(parseVisualAction('{"action":"drag","x":1,"y":2,"toX":3,"toY":4}')).toEqual({
      action: 'drag',
      x: 1,
      y: 2,
      toX: 3,
      toY: 4
    })
    expect(parseVisualAction('{"action":"paste_text","text":"你好"}')).toEqual({
      action: 'paste_text',
      text: '你好'
    })
    expect(parseVisualAction('{"action":"hotkey","keys":"CTRL+S"}')).toEqual({
      action: 'press',
      keys: 'CTRL+S'
    })

    const tools = createDesktopTools(() => null, {
      analyzeImage: async () => '{"action":"done","message":"视觉步骤完成"}'
    })
    const tool = tools.find((item) => item.name === 'screen_act')!
    const result = await tool.execute({ instruction: '打开设置' }, context)
    expect(result.output).toBe('视觉步骤完成')
  }, 45_000)

  it('gates every desktop tool behind the takeover approval', () => {
    const gated = new Set<string>(DESKTOP_TOOL_NAMES)
    const tools = createDesktopTools(() => null, {})
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.map((tool) => tool.name).filter((name) => !gated.has(name))).toEqual([])
  })
})
