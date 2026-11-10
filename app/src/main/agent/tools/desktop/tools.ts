import { readFile, stat, unlink } from 'node:fs/promises'
import type { BrowserWindow } from 'electron'
import { resolveWithinRoot } from '../../../security/paths'
import { boolArg, numberArg, stringArg, ToolError, truncate } from '../types'
import type { ToolDefinition } from '../types'
import { POST_MOUSE_DELAY_MS, waitFor } from './powershell'
import {
  DesktopSession,
  linesInWindow,
  normalizeButton,
  type DesktopToolOptions,
  type VisionCrop
} from './session'
import { buildVisualPrompt, parseVisualAction, type ScreenBounds } from './visual'

/** 桌面控制工具：全部通过 DesktopSession 执行，坐标均为虚拟桌面物理像素。 */
export function createDesktopTools(
  getWindow: () => BrowserWindow | null,
  options: DesktopToolOptions = {}
): ToolDefinition[] {
  const session = new DesktopSession(getWindow, options)

  const resolveVisionCrop = (
    args: Record<string, unknown>,
    shot: { bounds: ScreenBounds; foreground?: ScreenBounds | null }
  ): ScreenBounds => {
    const width = numberArg(args, 'region_width', 0, 0, 100_000)
    const height = numberArg(args, 'region_height', 0, 0, 100_000)
    if (width > 0 && height > 0) {
      return {
        x: numberArg(args, 'region_x', 0, -100_000, 100_000),
        y: numberArg(args, 'region_y', 0, -100_000, 100_000),
        width,
        height
      }
    }
    const scope = stringArg(args, 'scope', { fallback: 'window' })
    return scope === 'screen' ? shot.bounds : (shot.foreground ?? shot.bounds)
  }

  return [
    {
      name: 'screen_ocr',
      displayName: '读取屏幕文字',
      risk: 'read',
      description:
        '截取屏幕并识别文字，默认只返回前台窗口内的文字（用户正在用的程序），不会把桌面图标和另一块屏的内容混进来。默认用开源 RapidOCR（PP-OCRv6 small），失败自动回退 Windows OCR。返回每行文字及其虚拟桌面绝对坐标（x/y/width/height）和当前引擎。需要整个桌面（例如找桌面图标）时传 scope="screen"；只需要某个矩形时传 region_*。只想快速点击某段文字时直接用 screen_click(text)。',
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
          scope: {
            type: 'string',
            enum: ['window', 'screen'],
            description: '识别范围：默认 window 只识别前台窗口；screen 识别整个虚拟桌面'
          },
          region_x: { type: 'number', description: '可选，只识别区域的 X 坐标' },
          region_y: { type: 'number', description: '可选，只识别区域的 Y 坐标' },
          region_width: { type: 'number', description: '可选，只识别区域的宽度' },
          region_height: { type: 'number', description: '可选，只识别区域的高度' }
        },
        additionalProperties: false
      },
      summarize: () => '识别前台窗口文字',
      execute: async (args) => {
        const withBoxes = boolArg(args, 'with_boxes', true)
        const scope = stringArg(args, 'scope', { fallback: 'window' }) === 'screen' ? 'screen' : 'window'
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
        // 只有“前台窗口范围”才需要额外查询前台窗口；显式区域或整屏都不需要。
        const shot = await session.capture(false, scope === 'window' && !region)
        try {
          const boxes = await session.ocr(shot.path, { useRapid, region })
          const originX = shot.bounds.x + (boxes.region?.x ?? 0)
          const originY = shot.bounds.y + (boxes.region?.y ?? 0)
          const range = `虚拟桌面：x=${shot.bounds.x} y=${shot.bounds.y} ${shot.bounds.width}x${shot.bounds.height}`
          const engine = `OCR：${boxes.engine === 'rapidocr' ? 'RapidOCR' : 'Windows OCR'}`
          const found = boxes.lines.map((line) => ({
            text: line.text,
            x: originX + line.x,
            y: originY + line.y,
            width: line.width,
            height: line.height
          }))
          const foreground = shot.foreground
          let lines = found
          let scopeNote = ''
          if (scope === 'window' && !region && foreground) {
            const inside = linesInWindow(found, foreground)
            scopeNote = `识别范围：前台窗口「${foreground.title}」x=${foreground.x} y=${foreground.y} ${foreground.width}x${foreground.height}`
            if (inside.length) {
              lines = inside
            } else if (found.length) {
              scopeNote += '（窗口内没识别到文字，已返回全屏结果）'
            }
          } else if (scope === 'screen' || region) {
            scopeNote =
              '识别范围：整个虚拟桌面（坐标是虚拟桌面绝对坐标；点击请用 screen_click 或 screen_click_target，不要按视觉缩放图坐标手动 mouse_click）'
          }

          if (!withBoxes) {
            const text = lines.map((line) => line.text).join('\n')
            return {
              output: truncate(
                `${range}\n${scopeNote}\n${engine}\n${text || '（未识别到文字）'}`,
                40_000
              )
            }
          }
          const body = lines
            .map(
              (line, index) =>
                `${index + 1}. x=${Math.round(line.x)} y=${Math.round(line.y)} w=${line.width} h=${line.height} | ${line.text}`
            )
            .join('\n')
          return {
            output: truncate(`${range}\n${scopeNote}\n${engine}\n${body || '（未识别到文字）'}`, 40_000)
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
        '截取当前前台窗口并缩放到适合视觉模型的尺寸，再交给支持图片输入的模型识别。默认只看前台窗口；找桌面图标、任务栏或托盘时传 scope="screen"，可用 region_* 限定区域（例如左列图标区），避免整屏缩小后看不清。多屏不会拼成一张巨图，坐标和文字更准。用于理解窗口布局、图标、图片或自绘界面；普通文字用 screen_ocr，需要点击就用 screen_click_target。',
      inputSchema: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: '希望模型从桌面截图中识别的目标或回答的问题'
          },
          scope: {
            type: 'string',
            enum: ['window', 'screen'],
            description: '默认 window 只看前台窗口；桌面图标、任务栏、托盘用 screen'
          },
          region_x: { type: 'number', description: '可选，只识别区域的 X 坐标（虚拟桌面物理像素）' },
          region_y: { type: 'number', description: '可选，只识别区域的 Y 坐标' },
          region_width: { type: 'number', description: '可选，只识别区域的宽度' },
          region_height: { type: 'number', description: '可选，只识别区域的高度' }
        },
        required: ['question'],
        additionalProperties: false
      },
      summarize: (args) => `视觉识别桌面：${stringArg(args, 'question').slice(0, 60) || '?'}`,
      execute: async (args) => {
        if (!options.analyzeImage) throw new ToolError('当前没有可用的桌面视觉分析器')
        const question = stringArg(args, 'question', { required: true, max: 2000 })
        if (!question.trim()) throw new ToolError('question 不能为空')
        const shot = await session.capture(false, true)
        let vision: VisionCrop | null = null
        try {
          const mappedVision = await session.cropWindow(
            shot.path,
            shot.bounds,
            resolveVisionCrop(args, shot)
          )
          vision = mappedVision
          const bytes = await readFile(mappedVision.path)
          const text = await options.analyzeImage(question, {
            dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
            url: 'screen://virtual-desktop',
            title: '桌面截图'
          })
          return {
            output: `${text || '（模型没有返回视觉识别结果）'}\n\n[视觉输入：${mappedVision.width}x${mappedVision.height}，屏幕原点 (${mappedVision.originX}, ${mappedVision.originY})，缩放 ${mappedVision.scale.toFixed(2)}。需要点击时请使用 screen_click_target 或 screen_act，不要用这里的图片坐标手动 mouse_click。]`
          }
        } finally {
          await unlink(shot.path).catch(() => undefined)
          if (vision) await unlink(vision.path).catch(() => undefined)
        }
      }
    },
    {
      name: 'screen_act',
      displayName: '视觉操作桌面',
      risk: 'exec',
      description:
        '通用视觉操作：自动截取前台窗口并缩放到适合视觉模型的尺寸，模型返回一个 JSON 动作（click/double_click/right_click/move/drag/type/paste_text/paste_file/press/scroll/wait/done），程序按截图比例换算回屏幕坐标并执行。适合任何没有 UIA/DOM 的桌面程序、聊天工具、远程桌面、安装器和设置面板；不需要为每个应用写专用代码。每次只执行一个动作，下一步重新截图。',
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
        const shot = await session.capture(true, true)
        let vision: VisionCrop | null = null
        try {
          vision = await session.cropWindow(shot.path, shot.bounds, shot.foreground ?? shot.bounds)
          const bytes = await readFile(vision.path)
          const imageBounds = { x: 0, y: 0, width: vision.width, height: vision.height }
          const toScreenX = (value: number): number =>
            Math.round(vision!.originX + value * vision!.scale)
          const toScreenY = (value: number): number =>
            Math.round(vision!.originY + value * vision!.scale)
          const raw = await options.analyzeImage(buildVisualPrompt(instruction, imageBounds), {
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
            const x = toScreenX(action.x)
            const y = toScreenY(action.y)
            await session.move(x, y, { signal: context.signal })
            return { output: `视觉操作移动 (${x}, ${y})` }
          }
          if (action.action === 'drag') {
            const x = toScreenX(action.x)
            const y = toScreenY(action.y)
            const toX = toScreenX(action.toX)
            const toY = toScreenY(action.toY)
            await session.drag(x, y, toX, toY, { signal: context.signal, label: '视觉拖拽' })
            return { output: `视觉操作拖拽 (${x}, ${y}) → (${toX}, ${toY})` }
          }
          if (action.action === 'paste_text') {
            await session.pasteText(action.text)
            await waitFor(POST_MOUSE_DELAY_MS, context.signal)
            return { output: `视觉操作粘贴文字（${action.text.length} 字符）` }
          }
          if (action.action === 'paste_file') {
            const safePaths: string[] = []
            for (const path of action.paths) {
              const resolved = await resolveWithinRoot(context.workspace, path)
              const info = await stat(resolved).catch(() => null)
              if (!info?.isFile()) throw new ToolError(`粘贴文件不存在或不可用：${path}`)
              safePaths.push(resolved)
            }
            await session.pasteFiles(safePaths)
            await waitFor(POST_MOUSE_DELAY_MS, context.signal)
            return { output: `视觉操作粘贴文件：${safePaths.join('、')}` }
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
            const x = toScreenX(action.x ?? vision!.width / 2)
            const y = toScreenY(action.y ?? vision!.height / 2)
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
          const clickX = toScreenX(action.x)
          const clickY = toScreenY(action.y)
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
          if (vision) await unlink(vision.path).catch(() => undefined)
        }
      }
    },
    {
      name: 'screen_click',
      displayName: '识别文字并点击',
      risk: 'exec',
      description:
        '一次完成截图、OCR 和点击：在屏幕上找到指定文字，直接点击文字中心。目标文字明确时优先使用它，不需要先读取全部界面文字。适合按钮、菜单、网页文字和自绘界面。',
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
        '直接点击屏幕上看见的控件：截取当前范围交给视觉模型，按描述（按钮文字、图标、头像、菜单项）找到位置并点下去，一步完成。默认只看前台窗口；找桌面图标、任务栏或托盘时传 scope="screen"，可用 region_* 限定区域（例如左列图标区），否则视觉模型看不到桌面。QQ、微信、游戏等自绘界面用它。找不到时只返回说明，不会乱点。',
      inputSchema: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: '要点击的控件描述，例如“发送按钮”“张三的头像”“右上角关闭”'
          },
          button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标按键，默认 left' },
          clicks: { type: 'number', description: '点击次数，1-3，默认 1' },
          scope: {
            type: 'string',
            enum: ['window', 'screen'],
            description: '默认 window 只看前台窗口；桌面图标、任务栏、托盘用 screen'
          },
          region_x: { type: 'number', description: '可选，只在指定区域查找（虚拟桌面物理像素）' },
          region_y: { type: 'number', description: '可选，只在指定区域查找' },
          region_width: { type: 'number', description: '可选，区域宽度' },
          region_height: { type: 'number', description: '可选，区域高度' }
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
        const shot = await session.capture(true, true)
        let vision: VisionCrop | null = null
        try {
          vision = await session.cropWindow(shot.path, shot.bounds, resolveVisionCrop(args, shot))
          const imageBounds = { x: 0, y: 0, width: vision.width, height: vision.height }
          const bytes = await readFile(vision.path)
          const raw = await options.analyzeImage(
            buildVisualPrompt(`点击「${target}」`, imageBounds),
            {
              dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
              url: 'screen://click-target',
              title: '按描述点击'
            }
          )
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
          if (
            action.x < 0 ||
            action.x > imageBounds.width ||
            action.y < 0 ||
            action.y > imageBounds.height
          ) {
            throw new ToolError(
              `视觉模型给出的坐标 (${action.x}, ${action.y}) 超出画面范围 ` +
                `（${imageBounds.width}x${imageBounds.height}）。没有点击，请重试。`
            )
          }
          const x = Math.round(vision.originX + action.x * vision.scale)
          const y = Math.round(vision.originY + action.y * vision.scale)
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
          return {
            output: `已点击「${target}」(${x}, ${y})（视觉图片 ${vision.width}x${vision.height}，缩放 ${vision.scale}）`
          }
        } finally {
          shot.restore()
          await unlink(shot.path).catch(() => undefined)
          if (vision) await unlink(vision.path).catch(() => undefined)
        }
      }
    },
    {
      name: 'window_focus',
      displayName: '切换到窗口',
      risk: 'exec',
      description:
        '按标题把窗口切到前台；如果程序最小化到托盘，会尝试恢复它的隐藏窗口。返回屏幕矩形（x/y/width/height）。标题包含匹配即可，例如 window_focus(title="QQ")。切换后配合 screen_ocr / screen_click_target 操作；不要自己写 SetForegroundWindow 脚本。',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '窗口标题的一部分，例如 QQ、微信、PyCharm' }
        },
        required: ['title'],
        additionalProperties: false
      },
      summarize: (args) => `切换到窗口「${stringArg(args, 'title').slice(0, 40)}」`,
      execute: async (args) => {
        const title = stringArg(args, 'title', { required: true, max: 200 }).trim()
        if (!title) throw new ToolError('title 不能为空')
        const win = await session.focusWindow(title)
        if (!win) {
          throw new ToolError(
            `没有找到标题包含「${title}」的窗口。目标程序可能最小化到托盘：请先用 run_command 启动它（例如 Start-Process QQ），或用 screen_click_target 点击托盘图标；不要反复重试 window_focus。`
          )
        }
        return {
          output: `已切到「${win.title}」：x=${win.x} y=${win.y} ${win.width}x${win.height}`
        }
      }
    },
    {
      name: 'window_restore',
      displayName: '命令行唤出窗口',
      risk: 'exec',
      description:
        '用命令行按进程名恢复/启动窗口：枚举该进程所有顶层窗口（包括隐藏/托盘窗口）并 ShowWindow + 置前；找不到窗口时可用进程路径或开始菜单重新启动。QQ、微信等常驻托盘程序优先用它，比点托盘图标/悬浮小窗可靠。',
      inputSchema: {
        type: 'object',
        properties: {
          process: { type: 'string', description: '进程名，例如 QQ、WeChat、TIM' },
          title: { type: 'string', description: '可选，窗口标题包含的文字' },
          launch: { type: 'boolean', description: '找不到窗口时是否启动/重启进程，默认 true' },
          wait_ms: { type: 'number', description: '启动后等待毫秒，默认 1200' }
        },
        required: ['process'],
        additionalProperties: false
      },
      summarize: (args) => `命令行唤出 ${stringArg(args, 'process').slice(0, 40) || '?'}`,
      execute: async (args) => {
        const processName = stringArg(args, 'process', { required: true, max: 100 }).trim()
        if (!/^[A-Za-z0-9._-]+$/.test(processName)) {
          throw new ToolError('process 只支持进程名，例如 QQ、WeChat')
        }
        const title = stringArg(args, 'title', { fallback: '', max: 200 }).trim()
        const launch = boolArg(args, 'launch', true)
        const waitMs = numberArg(args, 'wait_ms', 1200, 0, 10_000)
        const win = await session.restoreWindow(processName, title, launch, waitMs)
        if (!win) {
          throw new ToolError(
            `命令行没有唤出「${processName}」的窗口。请确认进程名/安装路径，或让用户手动打开；不要改用视觉点托盘图标反复尝试。`
          )
        }
        return {
          output: `已用命令行唤出「${win.title}」：x=${win.x} y=${win.y} ${win.width}x${win.height}`
        }
      }
    },
    {
      name: 'mouse_move',
      displayName: '移动鼠标',
      risk: 'exec',
      description:
        '把鼠标平滑移动到屏幕坐标 (x, y)，支持多显示器虚拟桌面坐标。坐标使用屏幕物理像素；用户可以看到鼠标移动过程。',
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
        '向当前前台窗口输入文字，支持中文和 Unicode。输入前先确认焦点在目标输入框；不要在密码框中输入敏感信息。text 最长 4000 字符。',
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
