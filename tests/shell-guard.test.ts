import { describe, expect, it } from 'vitest'
import { KEYBOARD_SCRIPT } from '../app/src/main/agent/tools/desktop/scripts'
import { desktopAutomationHint } from '../app/src/main/agent/tools/shell'

describe('run_command desktop automation guard', () => {
  it('rejects re-inventing mouse input', () => {
    expect(desktopAutomationHint('[HqMouse]::mouse_event(2,0,0,0,0)')).toContain('mouse_click')
    expect(desktopAutomationHint('Add-Type ... SetCursorPos(10,10)')).toContain('mouse_move')
  })

  it('rejects re-inventing keyboard input', () => {
    const hint = desktopAutomationHint('Add-Type -TypeDefinition "...SendInput..."')
    expect(hint).toContain('keyboard_type')
    expect(hint).toContain('剪贴板')
  })

  it('rejects ad-hoc OCR engines', () => {
    expect(desktopAutomationHint('[Windows.Media.Ocr.OcrEngine,Windows.Foundation]')).toContain(
      'screen_ocr'
    )
    expect(desktopAutomationHint('tesseract shot.png out -l chi_sim')).toContain(
      'screen_click_target'
    )
  })

  it('leaves ordinary commands alone', () => {
    expect(desktopAutomationHint('npm run build')).toBeNull()
    expect(desktopAutomationHint('git clone https://example.com/a.git')).toBeNull()
    expect(desktopAutomationHint('Get-Process | Select-Object ProcessName,Id')).toBeNull()
    expect(desktopAutomationHint('powershell -ExecutionPolicy Bypass -File qq.ps1')).toBeNull()
  })
})

describe('keyboard fallback', () => {
  it('falls back to clipboard paste when SendInput is blocked', () => {
    expect(KEYBOARD_SCRIPT).toContain('SendInput')
    expect(KEYBOARD_SCRIPT).toContain("SendWait('^v')")
    expect(KEYBOARD_SCRIPT).toContain("Write-Output 'clipboard'")
  })
})
