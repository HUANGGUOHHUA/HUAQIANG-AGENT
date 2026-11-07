/** 需要“接管屏幕和鼠标”审批的全部工具；新增桌面工具时同步这里。 */
export const DESKTOP_TOOL_NAMES = [
  'ui_snapshot',
  'screen_ocr',
  'screen_vision',
  'screen_act',
  'screen_edges',
  'screen_click',
  'ui_click',
  'mouse_move',
  'mouse_click',
  'mouse_drag',
  'mouse_scroll',
  'keyboard_type',
  'keyboard_press'
] as const

export { createDesktopTools } from './tools'
export { buildVisualPrompt, parseVisualAction } from './visual'
export type { ScreenBounds, VisualAction } from './visual'
export type {
  ClickOptions,
  DesktopToolOptions,
  HighlightTarget,
  OcrResult,
  ScreenCapture
} from './session'
