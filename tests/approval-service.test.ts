import { describe, expect, it } from 'vitest'
import { ApprovalService } from '../app/src/main/approval'
import type { ApprovalRequest } from '../app/src/shared/types'

const sender = { isDestroyed: () => false, send: () => undefined } as never

function makeRequest(id: string, sticky?: boolean): ApprovalRequest {
  return {
    id,
    runId: 'run-1',
    toolName: 'write_file',
    displayName: '写文件',
    risk: 'write',
    summary: 'write_file',
    preview: '',
    sticky
  }
}

describe('ApprovalService.resolvePendingForSession', () => {
  it('releases only sticky-safe approvals of the given session', async () => {
    const service = new ApprovalService()
    const normal = service.request(makeRequest('normal'), 'session-1', sender)
    const dangerous = service.request(makeRequest('dangerous', false), 'session-1', sender)
    const other = service.request(makeRequest('other'), 'session-2', sender)

    expect(service.resolvePendingForSession('session-1', 'allow', true)).toBe(1)
    expect(await normal).toBe('allow')

    // Dangerous requests keep waiting until the user answers or the run stops.
    service.cancelRun('run-1')
    expect(await dangerous).toBe('deny')
    expect(await other).toBe('deny')
  })

  it('does nothing when switching back to ask mode', () => {
    const service = new ApprovalService()
    void service.request(makeRequest('pending'), 'session-1', sender)
    expect(service.resolvePendingForSession('session-1', 'deny', false)).toBe(1)
  })
})