import { readFile, unlink } from 'node:fs/promises'
import type { BrowserWindow } from 'electron'
import { detectEdges } from '../../../attachments/edges'
import { boolArg, numberArg, stringArg, ToolError, truncate } from '../types'
import type { ToolDefinition } from '../types'
import { POST_MOUSE_DELAY_MS, waitFor } from './powershell'
import { DesktopSession, normalizeButton, type DesktopToolOptions } from './session'
import { pickUiItem, type UiSnapshotItem } from './snapshot'
import { buildVisualPrompt, parseVisualAction } from './visual'

/** 把当前可用控件压成一行，附在“找不到控件”的错误里。 */
function describeControls(items: UiSnapshotItem[]): string {
  const names = items
    .filter((entry) => entry.kind === 'control')
    .slice(0, 12)
    .map((entry) => `${entry.type ?? '控件'}:${entry.name ?? ''}`)
    .join('；')
  return names ? `。可用控件：${names}` : ''
}

/** 找不到控件时给模型的提示：第一次劝它换视觉点击，连续失败就明确禁止继续枚举。 */
export function controlMissHint(misses: number): string {
  return misses >= 2
    ? `；已连续 ${misses} 次没找到控件，禁止继续 ui_snapshot/ui_click，请改用 screen_act 直接点击屏幕上的控件`
    : '；QQ、微信等自绘界面没有 UIA 控件，请改用 screen_act 按坐标点击'
}

/** 桌面控制工具：全部通过 DesktopSession 执行，坐标均为虚拟桌面物理像素。 */
export function createDesktopTools(
  getWindow: () => BrowserWindow | null,
  options: DesktopToolOptions = {}
): ToolDefinition[] {
  const session = new DesktopSession(getWindow, options)
  // 找控件失败次数：连续失败就明确要求模型改成“看见什么点什么”，
  // 避免在 QQ/微信这类自绘界面上反复枚举 UIA 树。
  let controlMisses = 0
  const missHint = (): string => controlMissHint(controlMisses)

  return [
    {
      name: 'ui_snapshot',
      displayName: '识别界面',
      risk: 'read',
      description:
        '读取 UIA 控件树，只适用于标准 Win32 界面（对话框、资源管理器、系统设置）。QQ、微信、钉钉、游戏等自绘界面没有可读控件，不要用这个工具，直接 screen_act 按坐标点击。目标名称明确时可先 ui_click(name)；连续两次找不到就改 screen_act。参数 max_items：最多返回多少个条目，默认 80。',
      inputSchema: {
        type: 'object',
        properties: {
          max_items: { type: 'number', description: '最多返回的窗口/控件数量，默认 80，最大 150' }
        },
        additionalProperties: false
      },
      summarize: () => '识别当前桌面窗口和控件',
      execute: async (args) => {
        const max = numberArg(args, 'max_items', 80, 20, 150)
        const { items, raw } = await session.snapshot(max)
        const controls = items.filter((item) => item.kind === 'control').length
        if (controls === 0) {
          // 只有窗口、没有控件（QQ/微信这类自绘界面）：直接劝模型改用视觉点击。
          controlMisses += 1
          return {
            output: `${raw || '{"items":[]}'}\n提示：当前界面没有可用的 UIA 控件${missHint()}`
          }
        }
        controlMisses = 0
        return { output: raw || '{"items":[]}' }
      }
    },
    {
      name: 'screen_ocr',
      displayName: '读取屏幕文字',
      risk: 'read',
      description:
        '截取整个虚拟桌面并识别文字。默认使用开源 RapidOCR（PP-OCRv6 small），全屏和区域都适用；RapidOCR 失败自动回退 Windows OCR。返回每行文字及其虚拟桌面绝对坐标（x/y/width/height）和当前引擎。不需要坐标时传 with_boxes=false。只想快速点击某段文字时直接用 screen_click(text)。',
      inputSchema: {
        type: 'object',
        properties: {
          with_boxes: {
            type: 'boolean',
            description: '是否返回每行文字的 x/y/width/height，默认 true'
          },
          engine: {
            type: 'string',
            enum: ['auto', 'windows', 'rapidocr'],
            description: '默认 rapidocr；windows 仅用于快速模式或 RapidOCR 失败时手动回退'
          },
          region_x: { type: 'number', description: '可选，只识别区域的 X 坐标' },
          region_y: { type: 'number', description: '可选，只识别区域的 Y 坐标' },
          region_width: { type: 'number', description: '可选，只识别区域的宽度' },
          region_height: { type: 'number', description: '可选，只识别区域的高度' }
        },
        additionalProperties: false
      },
      summarize: () => '截取全部显示器并识别文字坐标',
      execute: async (args) => {
        const withBoxes = boolArg(args, 'with_boxes', true)
        const regionWidth = numberArg(args, 'region_width', 0, 0, 100_000)
        const regionHeight = numberArg(args, 'region_height', 0, 0, 100_000)
        const region =
          regionWidth > 0 && regionHeight > 0
            ? {
                x: numberArg(args, 'region_x', 0, -100_000, 100_000),
                y: numberArg(args, 'region_y', 0, -100_000, 100_000),
                width: regionWidth,
                height: regionHeight
              }
            : undefined
        const useRapid = stringArg(args, 'engine', { fallback: 'rapidocr' }) !== 'windows'
        const shot = await session.capture()
        try {
          const boxes = await session.ocr(shot.path, { useRapid, region })
          const originX = shot.bounds.x + (boxes.region?.x ?? 0)
          const originY = shot.bounds.y + (boxes.region?.y ?? 0)
          const range = `虚拟桌面：x=${shot.bounds.x} y=${shot.bounds.y} ${shot.bounds.width}x${shot.bounds.height}`
          const engine = `OCR：${boxes.engine === 'rapidocr' ? 'RapidOCR' : 'Windows OCR'}`
          if (!withBoxes) {
            const text = boxes.lines.map((line) => line.text).join('\n')
            return {
              output: truncate(`${range}\n${engine}\n${text || '（未识别到文字）'}`, 40_000)
            }
          }
          const lines = boxes.lines
            .map(
              (line, index) =>
                `${index + 1}. x=${Math.round(originX + line.x)} y=${Math.round(originY + line.y)} w=${line.width} h=${line.height} | ${line.text}`
            )
            .join('\n')
          return {
            output: truncate(`${range}\n${engine}\n${lines || '（未识别到文字）'}`, 40_000)
          }
        } finally {
          await unlink(shot.path).catch(() => undefined)
        }
      }
    },
    {
      name: 'screen_vision',
      displayName: '视觉识别桌面',
      risk: 'network',
      description:
        '截取整个虚拟桌面，直接交给当前支持图片输入的模型做视觉识别。用于需要理解桌面布局、窗口、图标、图片或自绘界面时；普通文字用 screen_ocr，普通控件用 ui_snapshot。',
      inputSchema: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: '希望模型从桌面截图中识别的目标或回答的问题'
          }
        },
        required: ['question'],
        additionalProperties: false
      },
      summarize: (args) => `视觉识别桌面：${stringArg(args, 'question').slice(0, 60) || '?'}`,
      execute: async (args) => {
        if (!options.analyzeImage) throw new ToolError('当前没有可用的桌面视觉分析器')
        const question = stringArg(args, 'question', { required: true, max: 2000 })
        if (!question.trim()) throw new ToolError('question 不能为空')
        const shot = await session.capture()
        try {
          const bytes = await readFile(shot.path)
          const text = await options.analyzeImage(question, {
            dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
            url: 'screen://virtual-desktop',
            title: '桌面截图'
          })
          return { output: text || '（模型没有返回视觉识别结果）' }
        } finally {
          await unlink(shot.path).catch(() => undefined)
        }
      }
    },
    {
      name: 'screen_act',
      displayName: '视觉操作桌面',
      risk: 'exec',
      description:
        '通用视觉操作：截屏交给当前视觉模型，模型返回一个 JSON 动作（click/double_click/right_click/move/drag/type/paste_text/paste_file/press/scroll/wait/done），程序执行该动作。适合任何没有 UIA/DOM 的桌面程序、聊天工具、远程桌面、安装器和设置面板；不需要为每个应用写专用代码。每次只执行一个动作，下一步重新截图。',
      inputSchema: {
        type: 'object',
        properties: {
          instruction: {
            type: 'string',
            description: '当前目标，例如“打开 QQ 给张三发送文件”'
          }
        },
        required: ['instruction'],
        additionalProperties: false
      },
      summarize: (args) => `视觉操作桌面：${stringArg(args, 'instruction').slice(0, 60) || '?'}`,
      execute: async (args, context) => {
        if (!options.analyzeImage) throw new ToolError('当前没有可用的视觉分析器')
        const instruction = stringArg(args, 'instruction', { required: true, max: 2000 }).trim()
        if (!instruction) throw new ToolError('instruction 不能为空')
        // 走到视觉坐标点击，说明已经放弃 UIA 找控件，计数清零。
        controlMisses = 0
        const shot = await session.capture(true)
        try {
          const bytes = await readFile(shot.path)
          const raw = await options.analyzeImage(buildVisualPrompt(instruction, shot.bounds), {
            dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
            url: 'screen://visual-action',
            title: '桌面视觉操作'
          })
          const action = parseVisualAction(raw)
          if (action.action === 'done') {
            return { output: action.message || '视觉操作完成' }
          }
          if (action.action === 'wait') {
            await waitFor(action.ms, context.signal)
            return { output: `视觉操作等待 ${action.ms}ms` }
          }
          if (action.action === 'move') {
            const x = Math.round(shot.bounds.x + action.x)
            const y = Math.round(shot.bounds.y + action.y)
            await session.move(x, y, { signal: context.signal })
            return { output: `视觉操作移动 (${x}, ${y})` }
          }
          if (action.action === 'drag') {
            const x = Math.round(shot.bounds.x + action.x)
            const y = Math.round(shot.bounds.y + action.y)
            const toX = Math.round(shot.bounds.x + action.toX)
            const toY = Math.round(shot.bounds.y + action.toY)
            await session.drag(x, y, toX, toY, { signal: context.signal, label: '视觉拖拽' })
            return { output: `视觉操作拖拽 (${x}, ${y}) → (${toX}, ${toY})` }
          }
          if (action.action === 'paste_text') {
            await session.pasteText(action.text)
            await waitFor(POST_MOUSE_DELAY_MS, context.signal)
            return { output: `视觉操作粘贴文字（${action.text.length} 字符）` }
          }
          if (action.action === 'paste_file') {
            await session.pasteFiles(action.paths)
            await waitFor(POST_MOUSE_DELAY_MS, context.signal)
            return { output: `视觉操作粘贴文件：${action.paths.join('、')}` }
          }
          if (action.action === 'type') {
            const mode = await session.typeText(action.text)
            return {
              output:
                mode === 'clipboard'
                  ? `键盘输入被拦截，已用剪贴板粘贴（${action.text.length} 字符）`
                  : `视觉操作输入文字（${action.text.length} 字符）`
            }
          }
          if (action.action === 'press') {
            await session.pressKeys(action.keys)
            return { output: `视觉操作按键 ${action.keys}` }
          }
          if (action.action === 'scroll') {
            const x = Math.round(shot.bounds.x + (action.x ?? shot.bounds.width / 2))
            const y = Math.round(shot.bounds.y + (action.y ?? shot.bounds.height / 2))
            await session.scroll(action.amount, { x, y }, context.signal)
            return { output: `视觉操作滚动 ${action.amount} 格` }
          }
          let clicks = 1
          let button: 'left' | 'right' | 'middle' = 'left'
          if (action.action === 'double_click') {
            clicks = 2
          } else if (action.action === 'right_click') {
            button = 'right'
          } else {
            clicks = action.clicks ?? 1
            button = action.button ?? 'left'
          }
          const clickX = Math.round(shot.bounds.x + action.x)
          const clickY = Math.round(shot.bounds.y + action.y)
          await session.click(clickX, clickY, {
            signal: context.signal,
            button,
            clicks,
            label: `视觉点击 (${clickX}, ${clickY})`
          })
          return {
            output: `视觉操作点击 (${clickX}, ${clickY})${clicks > 1 ? ` ×${clicks}` : ''}`
          }
        } finally {
          shot.restore()
          await unlink(shot.path).catch(() => undefined)
        }
      }
    },
    {
      name: 'screen_edges',
      displayName: '检测屏幕控件边缘',
      risk: 'read',
      description:
        '截取虚拟桌面并做本地边缘检测，返回可见矩形控件的边缘外框（x/y/width/height/center）。适合 Canvas、自绘按钮、远程桌面等 UI Automation/DOM 读不到边界的界面；普通按钮优先 ui_snapshot 或 browser_snapshot。',
      inputSchema: {
        type: 'object',
        properties: {
          min_width: { type: 'number', description: '最小控件宽度，默认 20' },
          min_height: { type: 'number', description: '最小控件高度，默认 12' },
          max_boxes: { type: 'number', description: '最多返回多少个矩形，默认 40，最大 80' }
        },
        additionalProperties: false
      },
      summarize: () => '检测屏幕控件边缘',
      execute: async (args) => {
        const shot = await session.capture()
        try {
          const result = await detectEdges(shot.path, {
            pythonPath: options.pythonPath?.(),
            minWidth: numberArg(args, 'min_width', 20, 4, 2000),
            minHeight: numberArg(args, 'min_height', 12, 4, 2000),
            maxBoxes: numberArg(args, 'max_boxes', 40, 1, 80)
          })
          const boxes = result.boxes.map((box) => ({
            ...box,
            x: shot.bounds.x + box.x,
            y: shot.bounds.y + box.y,
            centerX: shot.bounds.x + box.centerX,
            centerY: shot.bounds.y + box.centerY
          }))
          return {
            output: truncate(
              JSON.stringify(
                {
                  screen: shot.bounds,
                  width: result.width,
                  height: result.height,
                  boxes
                },
                null,
                2
              ),
              40_000
            )
          }
        } finally {
          await unlink(shot.path).catch(() => undefined)
        }
      }
    },
    {
      name: 'screen_click',
      displayName: '识别文字并点击',
      risk: 'exec',
      description:
        '一次完成截图、OCR 和点击：在屏幕上找到指定文字，直接点击文字中心。目标文字明确时优先使用它，不需要先 screen_ocr 或 ui_snapshot。适合按钮、菜单、网页文字和 UI Automation 读不到的界面。',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '屏幕上要点击的文字，例如“批量下载”' },
          button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标按键，默认 left' },
          clicks: { type: 'number', description: '点击次数，1-3，默认 1' },
          duration_ms: { type: 'number', description: '平滑移动时长，默认 320 毫秒' }
        },
        required: ['text'],
        additionalProperties: false
      },
      summarize: (args) => `识别并点击文字「${stringArg(args, 'text').slice(0, 40)}」`,
      execute: async (args, context) => {
        const text = stringArg(args, 'text', { required: true, max: 200 }).trim()
        if (!text) throw new ToolError('text 不能为空')
        return { output: await session.clickText(text, args, context.signal) }
      }
    },
    {
      name: 'screen_click_target',
      displayName: '点击看到的控件',
      risk: 'exec',
      description:
        '直接点击屏幕上看见的控件：截取当前桌面交给视觉模型，按描述（按钮文字、图标、头像、菜单项）找到位置并点下去，一步完成。QQ、微信、游戏等自绘界面用它，不要先 ui_snapshot 找控件。找不到时只返回说明，不会乱点。',
      inputSchema: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: '要点击的控件描述，例如“发送按钮”“张三的头像”“右上角关闭”'
          },
          button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标按键，默认 left' },
          clicks: { type: 'number', description: '点击次数，1-3，默认 1' }
        },
        required: ['target'],
        additionalProperties: false
      },
      summarize: (args) => `点击「${stringArg(args, 'target').slice(0, 40)}」`,
      execute: async (args, context) => {
        if (!options.analyzeImage) {
          throw new ToolError('当前没有可用的视觉分析器；请改用 screen_click(text=...) 按文字点击')
        }
        const target = stringArg(args, 'target', { required: true, max: 300 }).trim()
        if (!target) throw new ToolError('target 不能为空')
        controlMisses = 0
        const shot = await session.capture(true)
        try {
          const bytes = await readFile(shot.path)
          const raw = await options.analyzeImage(buildVisualPrompt(`点击「${target}」`, shot.bounds), {
            dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
            url: 'screen://click-target',
            title: '按描述点击'
          })
          const action = parseVisualAction(raw)
          if (action.action === 'done') {
            return {
              output: `没有在屏幕上看到「${target}」：${action.message || '请确认控件当前是否可见'}`
            }
          }
          if (
            action.action !== 'click' &&
            action.action !== 'double_click' &&
            action.action !== 'right_click'
          ) {
            throw new ToolError(
              `视觉模型返回了 ${action.action}，没有给出点击坐标；请重试一次，或改用 screen_act`
            )
          }
          const x = Math.round(shot.bounds.x + action.x)
          const y = Math.round(shot.bounds.y + action.y)
          const clicks =
            action.action === 'double_click' ? 2 : numberArg(args, 'clicks', 1, 1, 3)
          const button =
            action.action === 'right_click'
              ? 'right'
              : normalizeButton(stringArg(args, 'button', { fallback: 'left' }))
          await session.click(x, y, {
            signal: context.signal,
            button,
            clicks,
            label: `点击「${target}」`
          })
          return { output: `已点击「${target}」(${x}, ${y})` }
        } finally {
          shot.restore()
          await unlink(shot.path).catch(() => undefined)
        }
      }
    },
    {
      name: 'ui_click',
      displayName: '识别并点击',
      risk: 'exec',
      description:
        '按名称、id 或类型点击标准 Win32 控件中心。UI Automation 找不到时会自动截屏 OCR 找文字；连续两次都找不到就不要再试，改用 screen_act 直接按坐标点击。QQ、微信等自绘界面直接用 screen_act。id 最稳定，name 支持包含匹配，index 只对最近一次快照有效。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ui_snapshot 返回的稳定控件 id，优先级最高' },
          index: { type: 'number', description: '最近一次 ui_snapshot 的控件编号' },
          name: { type: 'string', description: '控件名称，支持包含匹配，例如“保存”' },
          type: { type: 'string', description: '控件类型，例如 Button、Edit、MenuItem' },
          button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标按键，默认 left' },
          clicks: { type: 'number', description: '点击次数，1-3，默认 1' },
          duration_ms: { type: 'number', description: '平滑移动到控件的时长，默认 320 毫秒' }
        },
        additionalProperties: false
      },
      summarize: (args) => {
        const id = stringArg(args, 'id').slice(0, 40)
        if (id) return `识别并点击控件 ${id}`
        const index = numberArg(args, 'index', -1, -1, 100_000)
        if (index >= 0) return `识别并点击控件 #${index}`
        const name = stringArg(args, 'name').slice(0, 40)
        const type = stringArg(args, 'type')
        return `识别并点击 ${type ? `${type} ` : ''}${name || '?'}`
      },
      execute: async (args, context) => {
        const cached = session.cachedItems()
        let items = cached ?? (await session.snapshot()).items
        let item = pickUiItem(items, args)
        if (!item && cached) {
          items = (await session.snapshot()).items
          item = pickUiItem(items, args)
        }
        if (!item) {
          controlMisses += 1
          const name = stringArg(args, 'name').trim()
          if (name) {
            try {
              const fallback = await session.clickText(name, args, context.signal)
              controlMisses = 0
              return { output: `UI Automation 未找到，${fallback}` }
            } catch (screenError) {
              const detail =
                screenError instanceof Error ? screenError.message : String(screenError)
              throw new ToolError(
                `没有找到匹配的控件${describeControls(items)}；屏幕识别也未找到：${detail}${missHint()}`
              )
            }
          }
          throw new ToolError(`没有找到匹配的控件${describeControls(items)}${missHint()}`)
        }
        const x = Math.round(Number(item.x ?? 0) + Number(item.width ?? 0) / 2)
        const y = Math.round(Number(item.y ?? 0) + Number(item.height ?? 0) / 2)
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new ToolError('控件坐标无效')
        }
        await session.click(x, y, {
          signal: context.signal,
          button: normalizeButton(stringArg(args, 'button', { fallback: 'left' })),
          clicks: numberArg(args, 'clicks', 1, 1, 3),
          durationMs: numberArg(args, 'duration_ms', 320, 80, 1500),
          width: Number(item.width ?? 26),
          height: Number(item.height ?? 26),
          label: `${item.type ?? '控件'}${item.name ? ` ${item.name}` : ''}`
        })
        controlMisses = 0
        return {
          output: `已点击 ${item.type ?? '控件'}「${item.name ?? ''}」中心 (${x}, ${y})`
        }
      }
    },
    {
      name: 'mouse_move',
      displayName: '移动鼠标',
      risk: 'exec',
      description:
        '把鼠标平滑移动到屏幕坐标 (x, y)，支持多显示器虚拟桌面坐标。坐标使用 ui_snapshot 返回的物理像素坐标；用户可以看到鼠标移动过程。',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '屏幕 X 坐标' },
          y: { type: 'number', description: '屏幕 Y 坐标' },
          duration_ms: { type: 'number', description: '平滑移动时长，默认 320 毫秒，范围 80-1500' }
        },
        required: ['x', 'y'],
        additionalProperties: false
      },
      summarize: (args) => `移动鼠标到 (${numberArg(args, 'x', 0, -100_000, 100_000)}, ${numberArg(args, 'y', 0, -100_000, 100_000)})`,
      execute: async (args, context) => {
        const x = numberArg(args, 'x', 0, -100_000, 100_000)
        const y = numberArg(args, 'y', 0, -100_000, 100_000)
        await session.move(x, y, {
          signal: context.signal,
          durationMs: numberArg(args, 'duration_ms', 320, 80, 1500)
        })
        return { output: '鼠标已移动' }
      }
    },
    {
      name: 'mouse_click',
      displayName: '点击鼠标',
      risk: 'exec',
      description:
        '在屏幕坐标 (x, y) 点击鼠标，坐标已知时直接使用。鼠标会先平滑移动到目标，再执行点击。button 可选 left/right/middle，clicks 可选 1-3（双击传 2）。',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '屏幕 X 坐标' },
          y: { type: 'number', description: '屏幕 Y 坐标' },
          button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标按键，默认 left' },
          clicks: { type: 'number', description: '点击次数，1-3，默认 1' },
          duration_ms: { type: 'number', description: '平滑移动到目标的时长，默认 320 毫秒' }
        },
        required: ['x', 'y'],
        additionalProperties: false
      },
      summarize: (args) => {
        const button = stringArg(args, 'button', { fallback: 'left' })
        const clicks = numberArg(args, 'clicks', 1, 1, 3)
        return `${button === 'right' ? '右键' : button === 'middle' ? '中键' : '左键'}点击 (${numberArg(args, 'x', 0, -100_000, 100_000)}, ${numberArg(args, 'y', 0, -100_000, 100_000)}) ×${clicks}`
      },
      execute: async (args, context) => {
        const x = numberArg(args, 'x', 0, -100_000, 100_000)
        const y = numberArg(args, 'y', 0, -100_000, 100_000)
        const button = stringArg(args, 'button', { fallback: 'left' })
        await session.click(x, y, {
          signal: context.signal,
          button: normalizeButton(button),
          clicks: numberArg(args, 'clicks', 1, 1, 3),
          durationMs: numberArg(args, 'duration_ms', 320, 80, 1500),
          label: `${button === 'right' ? '右键' : button === 'middle' ? '中键' : '点击'} (${x}, ${y})`
        })
        return { output: '鼠标点击完成' }
      }
    },
    {
      name: 'mouse_drag',
      displayName: '拖拽鼠标',
      risk: 'exec',
      description:
        '按住鼠标左键从 (x, y) 平滑拖拽到 (to_x, to_y)。用于拖动窗口、滑块或选择文本；支持跨显示器。',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '起点 X 坐标' },
          y: { type: 'number', description: '起点 Y 坐标' },
          to_x: { type: 'number', description: '终点 X 坐标' },
          to_y: { type: 'number', description: '终点 Y 坐标' },
          duration_ms: { type: 'number', description: '平滑拖拽时长，默认 320 毫秒' }
        },
        required: ['x', 'y', 'to_x', 'to_y'],
        additionalProperties: false
      },
      summarize: (args) => `拖拽 (${numberArg(args, 'x', 0, -100_000, 100_000)}, ${numberArg(args, 'y', 0, -100_000, 100_000)}) → (${numberArg(args, 'to_x', 0, -100_000, 100_000)}, ${numberArg(args, 'to_y', 0, -100_000, 100_000)})`,
      execute: async (args, context) => {
        await session.drag(
          numberArg(args, 'x', 0, -100_000, 100_000),
          numberArg(args, 'y', 0, -100_000, 100_000),
          numberArg(args, 'to_x', 0, -100_000, 100_000),
          numberArg(args, 'to_y', 0, -100_000, 100_000),
          {
            signal: context.signal,
            durationMs: numberArg(args, 'duration_ms', 320, 80, 1500)
          }
        )
        return { output: '鼠标拖拽完成' }
      }
    },
    {
      name: 'mouse_scroll',
      displayName: '滚动滚轮',
      risk: 'exec',
      description:
        '滚动鼠标滚轮。amount 为正数向上、负数向下，范围 -20 到 20；可选 x/y 先把鼠标移动到目标位置。',
      inputSchema: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: '滚动格数，正数向上，负数向下' },
          x: { type: 'number', description: '可选，滚动前移动到的 X 坐标' },
          y: { type: 'number', description: '可选，滚动前移动到的 Y 坐标' },
          duration_ms: { type: 'number', description: '可选，滚动前移动的动画时长' }
        },
        required: ['amount'],
        additionalProperties: false
      },
      summarize: (args) => `滚动滚轮 ${numberArg(args, 'amount', 0, -20, 20)} 格`,
      execute: async (args, context) => {
        const amount = numberArg(args, 'amount', 0, -20, 20)
        if (amount === 0) throw new ToolError('amount 不能为 0')
        const x = numberArg(args, 'x', 0, -100_000, 100_000)
        const y = numberArg(args, 'y', 0, -100_000, 100_000)
        const point = x !== 0 || y !== 0 ? { x, y } : undefined
        await session.scroll(amount, point, context.signal)
        return { output: '滚轮操作完成' }
      }
    },
    {
      name: 'keyboard_type',
      displayName: '输入文字',
      risk: 'exec',
      description:
        '向当前前台窗口输入文字，支持中文和 Unicode。输入前先用 ui_snapshot 确认焦点位置；不要在密码框中输入敏感信息。text 最长 4000 字符。',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: '要输入的文字' } },
        required: ['text'],
        additionalProperties: false
      },
      summarize: (args) => `输入文字（${stringArg(args, 'text').length} 字符）`,
      execute: async (args) => {
        const text = stringArg(args, 'text', { required: true, max: 4_000 })
        if (!text) throw new ToolError('text 不能为空')
        const mode = await session.typeText(text)
        return {
          output:
            mode === 'clipboard'
              ? `键盘输入被安全软件拦截，已用剪贴板粘贴 ${text.length} 个字符`
              : `已输入 ${text.length} 个字符`
        }
      }
    },
    {
      name: 'keyboard_press',
      displayName: '按下按键',
      risk: 'exec',
      description:
        '按下按键或组合键。示例：ENTER、TAB、ESC、CTRL+S、CTRL+SHIFT+ESC、ALT+TAB、F5。用于提交、切换窗口、保存等操作。',
      inputSchema: {
        type: 'object',
        properties: { keys: { type: 'string', description: '按键或组合键，例如 CTRL+S' } },
        required: ['keys'],
        additionalProperties: false
      },
      summarize: (args) => `按键 ${stringArg(args, 'keys').slice(0, 60) || '?'}`,
      execute: async (args) => {
        const keys = stringArg(args, 'keys', { required: true, max: 200 }).trim()
        if (!keys) throw new ToolError('keys 不能为空')
        await session.pressKeys(keys)
        return { output: `已按键 ${keys}` }
      }
    }
  ]
}
