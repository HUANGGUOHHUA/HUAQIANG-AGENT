import { registerScreenshotIpc } from '../screenshot'
import { state } from '../state'
import { registerAgentIpc } from './agent'
import { registerAppIpc } from './app'
import { registerWorkspaceIpc } from './workspace'

/** 注册全部 IPC；必须在窗口创建前调用。 */
export function registerIpc(): void {
  registerAppIpc()
  registerWorkspaceIpc()
  registerAgentIpc()
  registerScreenshotIpc(() => state.mainWindow)
}
