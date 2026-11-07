import { describe, expect, it } from 'vitest'
import type { AgentEvent, ApprovalRequest, ChatSession, Usage } from '../app/src/shared/types'
import { createAgentEventHandler, type AgentEventDeps } from '../app/src/renderer/src/lib/agent-events'
import type { LiveMessage, ToastMessage } from '../app/src/renderer/src/types'

function emptySession(): ChatSession {
  return {
    id: 'session-1',
    title: '新对话',
    createdAt: 0,
    updatedAt: 0,
    messages: []
  } as ChatSession
}

function harness() {
  const state = {
    live: null as LiveMessage | null,
    session: emptySession(),
    committed: [] as ChatSession[],
    persisted: [] as ChatSession[],
    toasts: [] as Array<{ type: ToastMessage['type']; message: string }>,
    approvals: [] as Array<ApprovalRequest | null>,
    usage: null as Usage | null,
    running: true,
    runError: null as string | null,
    statuses: [] as Array<{ name: string }>,
    flushes: 0
  }
  let approval: ApprovalRequest | null = null
  const deps: AgentEventDeps = {
    runIdRef: { current: 'run-1' },
    lastRunIdRef: { current: null },
    getLive: () => state.live,
    setLiveNow: (message) => {
      state.live = message
    },
    updateLive: (message) => {
      state.live = message
    },
    flushLive: () => {
      state.flushes += 1
    },
    getSession: () => state.session,
    commitSession: (session) => {
      state.session = session
      state.committed.push(session)
    },
    persistSession: (session) => {
      state.persisted.push(session)
    },
    showToast: (type, message) => {
      state.toasts.push({ type, message })
    },
    setApproval: (value) => {
      approval = typeof value === 'function' ? value(approval) : value
      state.approvals.push(approval)
    },
    setUsage: (usage) => {
      state.usage = usage
    },
    setRunning: (running) => {
      state.running = running
    },
    setRunError: (message) => {
      state.runError = message
    },
    setMcpStatuses: (statuses) => {
      state.statuses = statuses as Array<{ name: string }>
    }
  }
  const handle = createAgentEventHandler(deps)
  return { state, handle, emit: (event: unknown) => handle(event as AgentEvent) }
}

describe('agent event handler', () => {
  it('forwards MCP status pushes', () => {
    const { state, emit } = harness()
    emit({ type: 'mcp-status', statuses: [{ name: 'mock' }] })
    expect(state.statuses).toEqual([{ name: 'mock' }])
  })

  it('ignores events from another run', () => {
    const { state, emit } = harness()
    emit({ type: 'assistant-start', runId: 'other', messageId: 'm1' })
    expect(state.live).toBeNull()
    expect(state.committed).toHaveLength(0)
  })

  it('streams deltas then stores the finished message', () => {
    const { state, emit } = harness()
    emit({ type: 'assistant-start', runId: 'run-1', messageId: 'm1' })
    expect(state.live).toMatchObject({ id: 'm1', content: '' })
    emit({ type: 'text-delta', runId: 'run-1', messageId: 'm1', delta: '你好' })
    expect(state.live?.content).toBe('你好')
    expect(state.flushes).toBe(1)
    emit({
      type: 'assistant-end',
      runId: 'run-1',
      message: { id: 'm1', role: 'assistant', content: '你好', createdAt: 1 }
    })
    expect(state.session.messages).toHaveLength(1)
    expect(state.live).toBeNull()
    expect(state.persisted).toHaveLength(1)
  })

  it('keeps a pending streamed message on run end', () => {
    const { state, emit } = harness()
    emit({ type: 'assistant-start', runId: 'run-1', messageId: 'm1' })
    emit({ type: 'text-delta', runId: 'run-1', messageId: 'm1', delta: '半截' })
    emit({ type: 'run-end', runId: 'run-1', status: 'done' })
    expect(state.session.messages.map((message) => message.id)).toEqual(['m1'])
    expect(state.running).toBe(false)
    expect(state.live).toBeNull()
  })

  it('reports failures and stops the spinner', () => {
    const { state, emit } = harness()
    emit({ type: 'run-end', runId: 'run-1', status: 'error', error: '模型超时' })
    expect(state.running).toBe(false)
    expect(state.runError).toBe('模型超时')
  })

  it('raises and clears approvals', () => {
    const { state, emit } = harness()
    const request = { id: 'approval-1', runId: 'run-1' } as ApprovalRequest
    emit({ type: 'approval-request', runId: 'run-1', request })
    expect(state.approvals.at(-1)).toBe(request)
    emit({ type: 'approval-closed', runId: 'run-1', requestId: 'approval-1' })
    expect(state.approvals.at(-1)).toBeNull()
  })

  it('shows a notice for compressed context', () => {
    const { state, emit } = harness()
    emit({ type: 'context-compressed', runId: 'run-1', dropped: 6 })
    expect(state.toasts).toEqual([{ type: 'info', message: '上下文过长，已压缩 6 条较早消息' }])
  })
})
