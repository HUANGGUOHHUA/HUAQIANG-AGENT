import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import { state } from '../state'

/** Only the main window (or a webview hosted by it) may call privileged IPC. */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const main = state.mainWindow?.webContents
  if (!main) return false
  return event.sender.id === main.id || event.sender.hostWebContents?.id === main.id
}

export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedSender(event)) throw new Error('来源不受信任')
}

export function handleTrusted(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event)
    return listener(event, ...args)
  })
}