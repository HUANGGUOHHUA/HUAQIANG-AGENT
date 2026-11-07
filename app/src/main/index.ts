import { app, dialog, protocol } from 'electron'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bootstrap } from './bootstrap'
import {
  elevationLog,
  hadRecentElevationAttempt,
  isElevated,
  markReady
} from './elevation'
import { abortAllRuns, state } from './state'
import { createWindow } from './window'

app.setName('华强以太')
app.setAppUserModelId('cn.edu.szft.hqzx.agent')

if (!app.isPackaged) {
  // Keep development data inside the project and use the same compatibility
  // flags as the packaged shortcut on this machine. HQ_DEV_PROFILE lets a
  // second instance run beside the user's window for local testing.
  const devProfile = process.env.HQ_DEV_PROFILE
    ? resolve(process.env.HQ_DEV_PROFILE)
    : join(app.getAppPath(), '.dev-profile')
  mkdirSync(devProfile, { recursive: true })
  app.setPath('userData', devProfile)
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

// A UAC relaunch starts the new instance before the old one exits; retry the
// single-instance lock briefly instead of quitting silently.
function acquireSingleInstanceLock(): boolean {
  if (app.requestSingleInstanceLock()) return true
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    } catch {
      const until = Date.now() + 250
      while (Date.now() < until) {
        // Fallback busy wait.
      }
    }
    if (app.requestSingleInstanceLock()) return true
  }
  return false
}

function reportAlreadyRunning(): void {
  try {
    dialog.showMessageBoxSync({
      type: 'info',
      title: '华强以太已在运行',
      message: '已有一个实例正在运行（可能正在以管理员身份重启）。',
      buttons: ['知道了'],
      noLink: true
    })
  } catch {
    // Dialog may not be ready on some systems; quitting is still correct.
  }
  app.quit()
}

function focusOrRecreateWindow(): void {
  const win = state.mainWindow
  if (!win || win.isDestroyed()) {
    // The primary instance lost its window (e.g. renderer crash); reopen one
    // instead of leaving the user with a locked, invisible app.
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// Signal aliveness before waiting for the lock: the instance that requested the
// elevation is waiting on this marker while still holding the lock itself.
markReady()
const gotLock = acquireSingleInstanceLock()
elevationLog(
  `start argv=${JSON.stringify(process.argv.slice(1))} elevated=${isElevated()} lock=${gotLock} marker=${hadRecentElevationAttempt()}`
)

if (!gotLock) {
  reportAlreadyRunning()
} else {
  app.on('second-instance', focusOrRecreateWindow)
  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      console.error('Failed to start:', error)
      dialog.showErrorBox('华强以太启动失败', error instanceof Error ? error.message : String(error))
      app.quit()
    })
}

app.on('activate', () => {
  if (app.isReady() && state.mainWindow === null) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  abortAllRuns()
  state.worker?.close()
  void state.mcp?.closeAll()
  void state.builtinMcp?.close()
})
