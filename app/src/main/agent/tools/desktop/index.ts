export { createDesktopTools } from './tools'
export { buildVisualPrompt, parseVisualAction } from './visual'
export type { ScreenBounds, VisualAction } from './visual'
export type { DesktopToolOptions } from './session'

/**
 * 需要“接管屏幕和鼠标”审批的全部工具；新增桌面工具时同步这里。
 * 只保留“像人一样看和操作”的工具：眼睛（截图/OCR/视觉）、手（鼠标/键盘）、切窗口。
 */
export const DESKTOP_TOOL_NAMES = [
  'screen_ocr',
  'screen_vision',
  'screen_act',
  'screen_click',
  'screen_click_target',
  'window_focus',
  'window_restore',
  'mouse_move',
  'mouse_click',
  'mouse_drag',
  'mouse_scroll',
  'keyboard_type',
  'keyboard_press'
] as const
