import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { normalizeOcrText, ocrImageBoxes } from '../../../attachments/ocr'
import { detectRapidOcr } from '../../../attachments/rapidocr'
import { ToolError, numberArg, stringArg } from '../types'
import { POST_MOUSE_DELAY_MS, runPowerShell, waitFor } from './powershell'
import {
  CLIPBOARD_PASTE_SCRIPT,
  CLIPBOARD_TEXT_SCRIPT,
  FOREGROUND_SCRIPT,
  KEYBOARD_SCRIPT,
  MOUSE_SCRIPT,
  SCREEN_SCRIPT,
  WINDOW_FOCUS_SCRIPT
} from './scripts'
import type { ScreenBounds } from './visual'

const SCREEN_SETTLE_MS = 300
const SCREEN_TIMEOUT = 20_000
const MOUSE_TIMEOUT = 12_000
const DRAG_TIMEOUT = 15_000
const KEYBOARD_TIMEOUT = 20_000

/** 一个可见窗口的屏幕矩形。 */
export interface WindowBounds {
  title: string
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenCapture {
  path: string
  bounds: ScreenBounds
  /** 截图瞬间的前台窗口；未请求或系统没有前台窗口时为空。 */
  foreground?: WindowBounds | null
  /** 恢复被隐藏的窗口与覆盖层；可重复调用。 */
  restore: () => void
}

/** 只保留中心点落在窗口矩形内的文字行。 */
export function linesInWindow<T extends { x: number; y: number; width: number; height: number }>(
  lines: T[],
  win: { x: number; y: number; width: number; height: number }
): T[] {
  return lines.filter((line) => {
    const cx = line.x + line.width / 2
    const cy = line.y + line.height / 2
    return cx >= win.x && cx <= win.x + win.width && cy >= win.y && cy <= win.y + win.height
  })
}

/** 解析脚本输出的 `title|x,y,width,height`；标题里允许出现竖线。 */
export function parseWindowLine(raw: string): WindowBounds | null {
  const bar = raw.lastIndexOf('|')
  if (bar <= 0) return null
  const parts = raw
    .slice(bar + 1)
    .split(',')
    .map((value) => Number(value))
  if (parts.length !== 4) return null
  const [x, y, width, height] = parts
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null
  return { title: raw.slice(0, bar).trim(), x, y, width, height }
}

export interface OcrLine {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export interface OcrResult {
  width: number
  height: number
  engine: 'rapidocr' | 'windows'
  region?: ScreenBounds
  lines: OcrLine[]
}

export interface HighlightTarget {
  x: number
  y: number
  width?: number
  height?: number
  label?: string
}

export interface DesktopToolOptions {
  suspendOverlay?: () => void
  resumeOverlay?: () => void
  highlight?: (target: HighlightTarget) => void
  pythonPath?: () => string
  analyzeImage?: (
    question: string,
    image: { dataUrl: string; url?: string; title?: string }
  ) => Promise<string>
}

export interface ClickOptions {
  signal: AbortSignal
  button?: 'left' | 'right' | 'middle'
  clicks?: number
  durationMs?: number
  label?: string
  width?: number
  height?: number
}

/** 把任意输入收敛成脚本认识的鼠标按键。 */
export function normalizeButton(value: unknown): 'left' | 'right' | 'middle' {
  return value === 'right' || value === 'middle' ? value : 'left'
}

/** 组鼠标脚本参数，统一裁剪到安全范围。 */
function mouseArgs(action: string, args: Record<string, unknown>): string[] {
  return [
    '-Action', action,
    '-X', String(numberArg(args, 'x', 0, -100_000, 100_000)),
    '-Y', String(numberArg(args, 'y', 0, -100_000, 100_000)),
    '-X2', String(numberArg(args, 'to_x', 0, -100_000, 100_000)),
    '-Y2', String(numberArg(args, 'to_y', 0, -100_000, 100_000)),
    '-Button', stringArg(args, 'button', { fallback: 'left' }).toLowerCase(),
    '-Clicks', String(numberArg(args, 'clicks', 1, 1, 3)),
    '-Amount', String(numberArg(args, 'amount', 0, -20, 20)),
    '-Duration', String(numberArg(args, 'duration_ms', 320, 80, 1500))
  ]
}

function parseBounds(raw: string): ScreenBounds {
  const [x, y, width, height] = raw.split(',').map((value) => Number(value))
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0
  }
}

/**
 * 一次桌面任务的状态：截图、OCR 和所有输入动作。
 * 工具定义只描述参数，真正的系统调用都收敛到这里，避免每个工具重复
 * “高亮 → 执行 → 等待 → 失效缓存”的样板代码。
 */
export class DesktopSession {
  private rapidUnavailable = false

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly options: DesktopToolOptions
  ) {}

  async capture(holdApp = false, withForeground = false): Promise<ScreenCapture> {
    this.options.suspendOverlay?.()
    const win = this.getWindow()
    const wasVisible = Boolean(win && !win.isDestroyed() && win.isVisible())
    if (wasVisible) win!.hide()
    let restored = false
    const restore = (): void => {
      if (restored) return
      restored = true
      if (wasVisible && win && !win.isDestroyed()) {
        win.show()
        win.focus()
      }
      this.options.resumeOverlay?.()
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, SCREEN_SETTLE_MS))
      // 隐藏自己的窗口后，前台就是用户真正在用的那个程序。
      const foreground = withForeground ? await this.foregroundWindow().catch(() => null) : null
      const path = join(tmpdir(), `huaqiang-screen-${Date.now()}.png`)
      const raw = await runPowerShell('desktop-screen', SCREEN_SCRIPT, ['-Path', path], SCREEN_TIMEOUT)
      return { path, bounds: parseBounds(raw), foreground, restore }
    } finally {
      if (!holdApp) restore()
    }
  }

  /** 截图瞬间的前台窗口，用来把 OCR 限定在用户正在看的窗口里。 */
  async foregroundWindow(): Promise<WindowBounds | null> {
    const raw = await runPowerShell('desktop-foreground', FOREGROUND_SCRIPT, [], 8_000)
    return raw && raw !== 'none' ? parseWindowLine(raw) : null
  }

  /** 按标题包含匹配把窗口切到前台，返回它切换后的矩形。 */
  async focusWindow(title: string): Promise<WindowBounds | null> {
    const raw = await runPowerShell(
      'desktop-focus',
      WINDOW_FOCUS_SCRIPT,
      ['-Title', title],
      DRAG_TIMEOUT
    )
    if (!raw || raw === 'notfound') return null
    return parseWindowLine(raw)
  }

  /** 识别截图文字；RapidOCR 不可用时自动降级到 Windows OCR。 */
  async ocr(
    path: string,
    opts: { useRapid?: boolean; region?: ScreenBounds } = {}
  ): Promise<OcrResult> {
    if (opts.useRapid && !this.rapidUnavailable) {
      try {
        const result = await detectRapidOcr(
          path,
          this.options.pythonPath?.() || 'python.exe',
          45_000,
          opts.region
        )
        if (result.lines.length) {
          return {
            width: result.width,
            height: result.height,
            engine: 'rapidocr',
            region: opts.region,
            lines: result.lines.map((line) => ({
              text: normalizeOcrText(line.text),
              x: line.x,
              y: line.y,
              width: line.width,
              height: line.height
            }))
          }
        }
      } catch {
        // Keep Windows OCR as a working fallback when RapidOCR is not bundled.
        this.rapidUnavailable = true
      }
    }
    const result = await ocrImageBoxes(path)
    return { ...result, engine: 'windows', region: undefined }
  }

  /** 用快速 Windows OCR 找到文字并点击中心，供 screen_click 使用。 */
  async clickText(text: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
    const shot = await this.capture()
    try {
      const ocr = await this.ocr(shot.path, { useRapid: false })
      const normalize = (value: string): string => value.replace(/\s+/g, '').toLowerCase()
      const wanted = normalize(text)
      const line = ocr.lines.find((entry) => normalize(entry.text).includes(wanted))
      if (!line) {
        const sample = ocr.lines
          .slice(0, 10)
          .map((item) => item.text)
          .join('、')
        throw new ToolError(`没有找到文字「${text}」${sample ? `。屏幕文字：${sample}` : ''}`)
      }
      const x = Math.round(shot.bounds.x + line.x + line.width / 2)
      const y = Math.round(shot.bounds.y + line.y + line.height / 2)
      this.options.highlight?.({ x, y, width: line.width, height: line.height, label: line.text })
      await runPowerShell(
        'desktop-mouse',
        MOUSE_SCRIPT,
        mouseArgs('click', { ...args, x, y }),
        MOUSE_TIMEOUT
      )
      await waitFor(POST_MOUSE_DELAY_MS, signal)
      return `已通过屏幕文字点击「${line.text}」中心 (${x}, ${y})`
    } finally {
      await unlink(shot.path).catch(() => undefined)
    }
  }

  async click(x: number, y: number, options: ClickOptions): Promise<void> {
    const button = options.button ?? 'left'
    const clicks = options.clicks ?? 1
    this.options.highlight?.({
      x,
      y,
      width: options.width,
      height: options.height,
      label: options.label ?? `点击 (${x}, ${y})`
    })
    await runPowerShell(
      'desktop-mouse',
      MOUSE_SCRIPT,
      mouseArgs('click', { x, y, button, clicks, duration_ms: options.durationMs }),
      MOUSE_TIMEOUT
    )
    await waitFor(POST_MOUSE_DELAY_MS, options.signal)
  }

  async move(x: number, y: number, options: { signal: AbortSignal; durationMs?: number }): Promise<void> {
    this.options.highlight?.({ x, y, label: '鼠标移动' })
    await runPowerShell(
      'desktop-mouse',
      MOUSE_SCRIPT,
      mouseArgs('move', { x, y, duration_ms: options.durationMs }),
      MOUSE_TIMEOUT
    )
    await waitFor(POST_MOUSE_DELAY_MS, options.signal)
  }

  async drag(
    x: number,
    y: number,
    toX: number,
    toY: number,
    options: { signal: AbortSignal; durationMs?: number; label?: string }
  ): Promise<void> {
    this.options.highlight?.({ x, y, label: options.label ?? '拖拽起点' })
    await runPowerShell(
      'desktop-mouse',
      MOUSE_SCRIPT,
      mouseArgs('drag', { x, y, to_x: toX, to_y: toY, duration_ms: options.durationMs }),
      DRAG_TIMEOUT
    )
    await waitFor(POST_MOUSE_DELAY_MS, options.signal)
  }

  async scroll(amount: number, point?: { x: number; y: number }, signal?: AbortSignal): Promise<void> {
    if (point) {
      this.options.highlight?.({
        x: point.x,
        y: point.y,
        label: `滚轮 ${amount > 0 ? '↑' : '↓'} ${Math.abs(amount)}`
      })
    }
    await runPowerShell(
      'desktop-mouse',
      MOUSE_SCRIPT,
      mouseArgs('scroll', { amount, x: point?.x, y: point?.y }),
      MOUSE_TIMEOUT
    )
    if (signal) await waitFor(POST_MOUSE_DELAY_MS, signal)
  }

  /** 输入文字；SendInput 被安全软件拦截时脚本会自动改用剪贴板粘贴。 */
  async typeText(text: string): Promise<'sendinput' | 'clipboard'> {
    const encoded = Buffer.from(text, 'utf8').toString('base64')
    const mode = await runPowerShell(
      'desktop-keyboard',
      KEYBOARD_SCRIPT,
      ['-Action', 'type', '-EncodedText', encoded],
      KEYBOARD_TIMEOUT
    )
    return mode === 'clipboard' ? 'clipboard' : 'sendinput'
  }

  async pressKeys(keys: string): Promise<void> {
    await runPowerShell(
      'desktop-keyboard',
      KEYBOARD_SCRIPT,
      ['-Action', 'press', '-Keys', keys],
      MOUSE_TIMEOUT
    )
  }

  async pasteText(text: string): Promise<void> {
    const encoded = Buffer.from(text, 'utf8').toString('base64')
    await runPowerShell(
      'desktop-clipboard-text',
      CLIPBOARD_TEXT_SCRIPT,
      ['-EncodedText', encoded, '-WaitMs', '600'],
      DRAG_TIMEOUT
    )
  }

  async pasteFiles(paths: string[]): Promise<void> {
    const encoded = Buffer.from(JSON.stringify(paths), 'utf8').toString('base64')
    await runPowerShell(
      'desktop-clipboard',
      CLIPBOARD_PASTE_SCRIPT,
      ['-EncodedPaths', encoded, '-WaitMs', '900'],
      20_000
    )
  }
}
