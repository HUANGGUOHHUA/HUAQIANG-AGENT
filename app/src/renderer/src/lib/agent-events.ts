import type {
  AgentEvent,
  ApprovalRequest,
  ChatSession,
  McpStatus,
  Usage
} from '../../../shared/types'
import type { LiveMessage, ToastMessage } from '../types'
import { mergeStats, mergeUsage } from './usage'
import { deriveTitle } from './utils'

/** 处理 Agent 事件所需的会话状态与 setter；由 App 注入。 */
export interface AgentEventDeps {
  /** Fallback for legacy events that do not carry a sessionId. */
  getActiveSessionId: () => string
  getRunId: (sessionId: string) => string | null
  setRunId: (sessionId: string, runId: string | null) => void
  getLastRunId: (sessionId: string) => string | null
  getLive: (sessionId: string) => LiveMessage | null
  /** 整体替换流式消息并立即刷新界面。 */
  setLiveNow: (sessionId: string, message: LiveMessage | null) => void
  /** 只更新流式消息对象，由 flushLive 合并渲染。 */
  updateLive: (sessionId: string, message: LiveMessage) => void
  flushLive: (sessionId: string) => void
  getSession: (sessionId: string) => ChatSession | null
  commitSession: (sessionId: string, session: ChatSession) => void
  persistSession: (session: ChatSession) => void
  showToast: (type: ToastMessage['type'], message: string) => void
  setApproval: (
    sessionId: string,
    update:
      | ApprovalRequest
      | null
      | ((current: ApprovalRequest | null) => ApprovalRequest | null)
  ) => void
  setUsage: (sessionId: string, usage: Usage | null) => void
  setRunning: (sessionId: string, running: boolean) => void
  setRunError: (sessionId: string, message: string | null) => void
  setMcpStatuses: (statuses: McpStatus[]) => void
}

/**
 * 把主进程推送的 Agent 事件折进事件所属会话。
 * 事件带 sessionId，因此多个会话可以同时运行而不会串写。
 */
export function createAgentEventHandler(
  deps: AgentEventDeps
): (event: AgentEvent) => void {
  return (event: AgentEvent): void => {
    if (event.type === 'mcp-status') {
      deps.setMcpStatuses(event.statuses)
      return
    }
    const sessionId = event.sessionId ?? deps.getActiveSessionId()
    const currentRun = deps.getRunId(sessionId)
    const isCurrentRun = currentRun === event.runId
    const isLateFinal =
      currentRun === null &&
      deps.getLastRunId(sessionId) === event.runId &&
      (event.type === 'assistant-end' || event.type === 'run-end')
    if (!isCurrentRun && !isLateFinal) return

    switch (event.type) {
      case 'notice': {
        deps.showToast('info', event.message)
        break
      }
      case 'assistant-start': {
        deps.setLiveNow(sessionId, {
          id: event.messageId,
          role: 'assistant',
          content: '',
          reasoning: '',
          toolCalls: [],
          createdAt: Date.now()
        })
        break
      }
      case 'text-delta': {
        const current = deps.getLive(sessionId)
        if (current && current.id === event.messageId) {
          deps.updateLive(sessionId, { ...current, content: current.content + event.delta })
          deps.flushLive(sessionId)
        }
        break
      }
      case 'reasoning-delta': {
        const current = deps.getLive(sessionId)
        if (current && current.id === event.messageId) {
          deps.updateLive(sessionId, {
            ...current,
            reasoning: current.reasoning + event.delta
          })
          deps.flushLive(sessionId)
        }
        break
      }
      case 'tool-draft': {
        const current = deps.getLive(sessionId)
        if (current && current.id === event.messageId) {
          deps.updateLive(sessionId, {
            ...current,
            toolDraft: { name: event.name, chars: event.chars }
          })
          deps.flushLive(sessionId)
        }
        break
      }
      case 'tool-start': {
        const current = deps.getLive(sessionId)
        if (!current || current.id !== event.messageId) break
        if (current.toolCalls.some((call) => call.id === event.callId)) break
        deps.setLiveNow(sessionId, {
          ...current,
          toolDraft: undefined,
          toolCalls: [
            ...current.toolCalls,
            {
              id: event.callId,
              name: event.name,
              displayName: event.displayName,
              risk: event.risk,
              args: event.args,
              status: 'running',
              startedAt: Date.now()
            }
          ]
        })
        break
      }
      case 'tool-output': {
        const current = deps.getLive(sessionId)
        if (!current || current.id !== event.messageId) break
        deps.setLiveNow(sessionId, {
          ...current,
          toolCalls: current.toolCalls.map((call) =>
            call.id === event.callId
              ? { ...call, result: `${call.result ?? ''}${event.delta}` }
              : call
          )
        })
        break
      }
      case 'tool-end': {
        const current = deps.getLive(sessionId)
        if (!current || current.id !== event.messageId) break
        deps.setLiveNow(sessionId, {
          ...current,
          toolCalls: current.toolCalls.map((call) =>
            call.id === event.callId
              ? {
                  ...call,
                  status: event.status,
                  result: event.result,
                  isError: event.isError,
                  stats: event.stats,
                  endedAt: Date.now()
                }
              : call
          )
        })
        break
      }
      case 'assistant-end': {
        const current = deps.getSession(sessionId)
        if (!current) break
        const alreadySaved = current.messages.some((message) => message.id === event.message.id)
        const next: ChatSession = {
          ...current,
          title:
            current.title === '新对话' && current.messages.some((message) => message.role === 'user')
              ? deriveTitle(current.messages.find((message) => message.role === 'user')?.content ?? '')
              : current.title,
          messages: alreadySaved
            ? current.messages.map((message) =>
                message.id === event.message.id ? event.message : message
              )
            : [...current.messages, event.message],
          updatedAt: Date.now()
        }
        deps.commitSession(sessionId, next)
        deps.setLiveNow(sessionId, null)
        // Persist as soon as the assistant message is complete, not only when
        // the whole run finishes, so a crash/close cannot drop the reply.
        void deps.persistSession(next)
        break
      }
      case 'approval-request':
        deps.setApproval(sessionId, event.request)
        break
      case 'approval-closed':
        deps.setApproval(sessionId, (current) =>
          current?.id === event.requestId ? null : current
        )
        break
      case 'usage':
        deps.setUsage(sessionId, event.usage)
        break
      case 'context-compressed':
        deps.showToast('info', `上下文过长，已压缩 ${event.dropped} 条较早消息`)
        break
      case 'run-end': {
        const pending = deps.getLive(sessionId)
        const currentSession = deps.getSession(sessionId)
        if (!currentSession) {
          // The conversation was deleted while the run was still finishing.
          deps.setRunning(sessionId, false)
          deps.setLiveNow(sessionId, null)
          deps.setApproval(sessionId, null)
          deps.setRunId(sessionId, null)
          break
        }
        const sessionWithUsage: ChatSession = {
          ...currentSession,
          tokenUsage: mergeUsage(currentSession.tokenUsage, event.usage),
          stats: mergeStats(currentSession.stats, event.stats)
        }
        const hasPendingMessage =
          pending &&
          !currentSession.messages.some((message) => message.id === pending.id) &&
          (pending.content.trim() ||
            (pending.reasoning ?? '').trim() ||
            pending.toolCalls.length > 0)
        if (pending && hasPendingMessage) {
          const next: ChatSession = {
            ...sessionWithUsage,
            title:
              currentSession.title === '新对话' &&
              currentSession.messages.some((message) => message.role === 'user')
                ? deriveTitle(
                    currentSession.messages.find((message) => message.role === 'user')?.content ??
                      ''
                  )
                : currentSession.title,
            messages: [...currentSession.messages, pending],
            updatedAt: Date.now()
          }
          deps.commitSession(sessionId, next)
          void deps.persistSession(next)
        } else if (event.usage || event.stats) {
          deps.commitSession(sessionId, sessionWithUsage)
          void deps.persistSession(sessionWithUsage)
        }
        deps.setRunning(sessionId, false)
        deps.setLiveNow(sessionId, null)
        deps.setApproval(sessionId, null)
        deps.setRunId(sessionId, null)
        if (event.status === 'aborted') {
          deps.showToast('info', '任务已停止')
          deps.setRunError(sessionId, null)
        } else if (event.status === 'error') {
          const messages = currentSession.messages
          const last = messages[messages.length - 1]
          if (!last?.error) deps.setRunError(sessionId, event.error ?? '运行未完成')
        } else {
          deps.setRunError(sessionId, null)
        }
        if (event.usage) deps.setUsage(sessionId, event.usage)
        if (currentRun) void deps.persistSession(currentSession)
        break
      }
      case 'run-start':
        break
    }
  }
}