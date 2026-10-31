import type { WebContents } from 'electron'
import type { ApprovalDecision, ApprovalRequest } from '../shared/types'

interface PendingApproval {
  request: ApprovalRequest
  sessionId: string
  sender: WebContents
  resolve: (decision: ApprovalDecision) => void
}

export class ApprovalService {
  private pending = new Map<string, PendingApproval>()
  private allowlists = new Map<string, Set<string>>()

  async request(
    request: ApprovalRequest,
    sessionId: string,
    sender: WebContents
  ): Promise<ApprovalDecision> {
    if (this.allowlists.get(sessionId)?.has(request.toolName)) return 'always'
    if (sender.isDestroyed()) return 'deny'
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(request.id, { request, sessionId, sender, resolve })
      sender.send('agent:event', {
        type: 'approval-request',
        runId: request.runId,
        request
      })
    })
  }

  decide(id: string, decision: ApprovalDecision): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    if (decision === 'always') {
      const set = this.allowlists.get(pending.sessionId) ?? new Set<string>()
      set.add(pending.request.toolName)
      this.allowlists.set(pending.sessionId, set)
    }
    if (!pending.sender.isDestroyed()) {
      pending.sender.send('agent:event', {
        type: 'approval-closed',
        runId: pending.request.runId,
        requestId: id
      })
    }
    pending.resolve(decision)
  }

  cancelRun(runId: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.request.runId !== runId) continue
      this.pending.delete(id)
      if (!pending.sender.isDestroyed()) {
        pending.sender.send('agent:event', {
          type: 'approval-closed',
          runId: pending.request.runId,
          requestId: id
        })
      }
      pending.resolve('deny')
    }
  }

  forgetSession(sessionId: string): void {
    this.allowlists.delete(sessionId)
  }
}
