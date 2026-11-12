import { ToolError } from '../types'

/** 视觉模型必须返回的单步动作。每次只执行一个，下一步重新截图。 */
export type VisualAction =
  | { action: 'click'; x: number; y: number; clicks?: number; button?: 'left' | 'right' | 'middle' }
  | { action: 'double_click'; x: number; y: number }
  | { action: 'move'; x: number; y: number }
  | { action: 'right_click'; x: number; y: number }
  | { action: 'drag'; x: number; y: number; toX: number; toY: number }
  | { action: 'type'; text: string }
  | { action: 'paste_text'; text: string }
  | { action: 'paste_file'; paths: string[] }
  | { action: 'press'; keys: string }
  | { action: 'scroll'; amount: number; x?: number; y?: number }
  | { action: 'wait'; ms: number }
  | { action: 'done'; message?: string }

export interface ScreenBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 从模型输出中抽出第一个 JSON 对象并校验成动作。 */
export function parseVisualAction(raw: string): VisualAction {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new ToolError('视觉模型没有返回 JSON 动作')
  let value: Record<string, unknown>
  try {
    value = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    throw new ToolError(`视觉动作 JSON 无法解析：${match[0].slice(0, 200)}`)
  }
  const action = typeof value.action === 'string' ? value.action.toLowerCase() : ''
  if (action === 'click' || action === 'double_click' || action === 'move' || action === 'right_click') {
    const x = Number(value.x)
    const y = Number(value.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new ToolError(`${action} 缺少有效 x/y`)
    if (action === 'double_click') return { action, x: Math.round(x), y: Math.round(y) }
    if (action === 'move') return { action, x: Math.round(x), y: Math.round(y) }
    if (action === 'right_click') return { action, x: Math.round(x), y: Math.round(y) }
    const button = value.button === 'right' || value.button === 'middle' ? value.button : 'left'
    const clicks = Math.max(1, Math.min(3, Math.round(Number(value.clicks ?? 1))))
    return { action: 'click', x: Math.round(x), y: Math.round(y), clicks, button }
  }
  if (action === 'drag') {
    const x = Number(value.x)
    const y = Number(value.y)
    const toX = Number(value.toX ?? value.to_x)
    const toY = Number(value.toY ?? value.to_y)
    if (![x, y, toX, toY].every(Number.isFinite)) throw new ToolError('drag 缺少有效坐标')
    return {
      action,
      x: Math.round(x),
      y: Math.round(y),
      toX: Math.round(toX),
      toY: Math.round(toY)
    }
  }
  if (action === 'type' || action === 'paste_text') {
    const text = typeof value.text === 'string' ? value.text.slice(0, 4000) : ''
    if (!text) throw new ToolError(`${action} 缺少 text`)
    return { action, text }
  }
  if (action === 'paste_file') {
    const rawPaths = Array.isArray(value.paths) ? value.paths : [value.path]
    const paths = rawPaths
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8)
    if (!paths.length) throw new ToolError('paste_file 缺少有效的 path/paths')
    return { action, paths }
  }
  if (action === 'press' || action === 'hotkey') {
    const keys = typeof value.keys === 'string' ? value.keys.slice(0, 200).trim() : ''
    if (!keys) throw new ToolError(`${action} 缺少 keys`)
    return { action: 'press', keys }
  }
  if (action === 'scroll') {
    const amount = Math.round(Number(value.amount))
    if (!Number.isFinite(amount) || amount === 0) throw new ToolError('scroll 缺少有效 amount')
    return {
      action,
      amount: Math.max(-20, Math.min(20, amount)),
      x: Number.isFinite(Number(value.x)) ? Math.round(Number(value.x)) : undefined,
      y: Number.isFinite(Number(value.y)) ? Math.round(Number(value.y)) : undefined
    }
  }
  if (action === 'wait') {
    return {
      action,
      ms: Math.max(0, Math.min(10_000, Math.round(Number(value.ms ?? 500))))
    }
  }
  if (action === 'done') {
    return {
      action,
      message: typeof value.message === 'string' ? value.message.slice(0, 1000) : ''
    }
  }
  throw new ToolError(`不支持的视觉动作：${action || '(empty)'}`)
}

/** 交给视觉模型的系统指令：只允许 JSON 动作，坐标以这次截图为准。 */
export function buildVisualPrompt(instruction: string, bounds: ScreenBounds): string {
  return [
    '你在操作 Windows 桌面。只返回一个 JSON 动作，不要返回解释或 Markdown。',
    `目标：${instruction}`,
    '允许的动作：',
    '{"action":"click","x":123,"y":456}',
    '{"action":"double_click","x":123,"y":456}',
    '{"action":"right_click","x":123,"y":456}',
    '{"action":"move","x":123,"y":456}',
    '{"action":"drag","x":123,"y":456,"toX":600,"toY":300}',
    '{"action":"type","text":"要输入的文字"}',
    '{"action":"paste_text","text":"粘贴输入的文字"}',
    '{"action":"paste_file","path":"D:\\path\\file.zip"}',
    '{"action":"press","keys":"ENTER"}',
    '{"action":"hotkey","keys":"CTRL+S"}',
    '{"action":"scroll","amount":-3}',
    '{"action":"wait","ms":500}',
    '{"action":"done","message":"完成说明"}',
    `截图坐标范围：x=${bounds.x} y=${bounds.y} width=${bounds.width} height=${bounds.height}`,
    '坐标必须是截图中的像素坐标。无法确认时返回 {"action":"wait","ms":500}，不要猜。'
  ].join('\n')
}
