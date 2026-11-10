import { unlink } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { DesktopSession } from '../app/src/main/agent/tools/desktop/session'

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

  it('only exposes human-shaped desktop tools', () => {
    const tools = createDesktopTools(() => null, {})
    const names = tools.map((tool) => tool.name)
    expect(names).not.toContain('ui_snapshot')
    expect(names).not.toContain('ui_click')
    expect(names).not.toContain('screen_edges')
    expect(names).toContain('screen_click_target')
    expect(names).toContain('window_focus')
  })

  it('clicks a described control in one step without touching the mouse when unsure', async () => {
    const tools = createDesktopTools(() => null, {
      analyzeImage: async () => '{"action":"done","message":"没看到"}'
    })
    const tool = tools.find((item) => item.name === 'screen_click_target')!
    const result = await tool.execute({ target: '发送按钮' }, context)
    expect(result.output).toContain('没有在屏幕上看到「发送按钮」')
  }, 45_000)

  it('makes the main window transparent instead of hiding it during takeover', async () => {
    const calls: Array<[string, unknown]> = []
    const fakeWin = {
      isDestroyed: () => false,
      isVisible: () => true,
      getOpacity: () => 1,
      setContentProtection: (value: boolean) => calls.push(['protect', value]),
      setOpacity: (value: number) => calls.push(['opacity', value]),
      setIgnoreMouseEvents: (value: boolean) => calls.push(['ignore', value]),
      blur: () => calls.push(['blur', true]),
      showInactive: () => calls.push(['showInactive', true])
    }
    const session = new DesktopSession(() => fakeWin as never, {})
    const shot = await session.capture(false, false)
    try {
      expect(calls).toContainEqual(['protect', true])
      expect(calls).toContainEqual(['opacity', 0])
      expect(calls).toContainEqual(['ignore', true])
      expect(calls).toContainEqual(['showInactive', true])
    } finally {
      shot.restore()
      await unlink(shot.path).catch(() => undefined)
    }
    expect(calls).toContainEqual(['opacity', 1])
    expect(calls).toContainEqual(['ignore', false])
    expect(calls).toContainEqual(['protect', false])
  }, 45_000)

  it('keeps the window transparent until the outermost takeover ends', async () => {
    const calls: Array<[string, unknown]> = []
    const fakeWin = {
      isDestroyed: () => false,
      isVisible: () => true,
      getOpacity: () => 1,
      setContentProtection: (value: boolean) => calls.push(['protect', value]),
      setOpacity: (value: number) => calls.push(['opacity', value]),
      setIgnoreMouseEvents: (value: boolean) => calls.push(['ignore', value]),
      blur: () => calls.push(['blur', true]),
      showInactive: () => calls.push(['showInactive', true])
    }
    const session = new DesktopSession(() => fakeWin as never, {})
    const outer = await session.capture(true, false)
    const inner = await session.capture(false, false)
    inner.restore()
    expect([...calls].reverse().find(([name]) => name === 'opacity')).toEqual([
      'opacity',
      0
    ])
    outer.restore()
    expect([...calls].reverse().find(([name]) => name === 'opacity')).toEqual([
      'opacity',
      1
    ])
    await unlink(outer.path).catch(() => undefined)
    await unlink(inner.path).catch(() => undefined)
  }, 45_000)

  it('returns null for a missing window without script errors', async () => {
    const session = new DesktopSession(() => null, {})
    await expect(session.focusWindow('绝对不存在的窗口标题-ZZZ')).resolves.toBeNull()
  }, 45_000)

  it('returns null when the process cannot be restored', async () => {
    const session = new DesktopSession(() => null, {})
    await expect(session.restoreWindow('NoSuchProcessZZZ', '', false, 0)).resolves.toBeNull()
  }, 45_000)

  it('scales large screenshots down to the visual edge limit', async () => {
    const session = new DesktopSession(() => null, {})
    const shot = await session.capture(false, false)
    let crop: Awaited<ReturnType<typeof session.cropWindow>> | null = null
    try {
      crop = await session.cropWindow(shot.path, shot.bounds, shot.bounds, 640)
      expect(crop.width).toBeLessThanOrEqual(640)
      expect(crop.height).toBeLessThanOrEqual(640)
      expect(crop.scale).toBeGreaterThanOrEqual(1)
    } finally {
      await unlink(shot.path).catch(() => undefined)
      if (crop) await unlink(crop.path).catch(() => undefined)
    }
  }, 45_000)
})
