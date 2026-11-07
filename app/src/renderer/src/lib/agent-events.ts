import type { Dispatch, SetStateAction } from 'react'
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
  runIdRef: { current: string | null }
  lastRunIdRef: { current: string | null }
  getLive: () => LiveMessage | null
  /** 整体替换流式消息并立即刷新界面。 */
  setLiveNow: (message: LiveMessage | null) => void
  /** 只更新流式消息对象，由 flushLive 合并渲染。 */
  updateLive: (message: LiveMessage) => void
  flushLive: () => void
  getSession: () => ChatSession
  commitSession: (session: ChatSession) => void
  persistSession: (session: ChatSession) => void
  showToast: (type: ToastMessage['type'], message: string) => void
  setApproval: Dispatch<SetStateAction<ApprovalRequest | null>>
  setUsage: (usage: Usage) => void
  setRunning: (running: boolean) => void
  setRunError: (message: string | null) => void
  setMcpStatuses: (statuses: McpStatus[]) => void
}

/**
 * 把主进程推送的 Agent 事件折进会话状态。
 * 副作用全部通过 deps 注入，App 只负责订阅和渲染。
 */
export function createAgentEventHandler(
  deps: AgentEventDeps
): (event: AgentEvent) => void {
  return (event: AgentEvent): void => {
  if (event.type === 'mcp-status') {
    deps.setMcpStatuses(event.statuses)
    return
  }
  const isCurrentRun = deps.runIdRef.current === event.runId
  const isLateFinal =
    deps.runIdRef.current === null &&
    deps.lastRunIdRef.current === event.runId &&
    (event.type === 'assistant-end' || event.type === 'run-end')
  if (!isCurrentRun && !isLateFinal) return
  switch (event.type) {
    case 'notice': {
      deps.showToast('info', event.message)
      break
    }
    case 'assistant-start': {
      deps.setLiveNow({
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
      const current = deps.getLive()
      if (current && current.id === event.messageId) {
        deps.updateLive({ ...current, content: current.content + event.delta })
        deps.flushLive()
      }
      break
    }
    case 'reasoning-delta': {
      const current = deps.getLive()
      if (current && current.id === event.messageId) {
        deps.updateLive({ ...current, reasoning: current.reasoning + event.delta })
        deps.flushLive()
      }
      break
    }
    case 'tool-draft': {
      const current = deps.getLive()
      if (current && current.id === event.messageId) {
        deps.updateLive({
          ...current,
          toolDraft: { name: event.name, chars: event.chars }
        })
        deps.flushLive()
      }
      break
    }
    case 'tool-start': {
      const current = deps.getLive()
      if (!current || current.id !== event.messageId) break
      if (current.toolCalls.some((call) => call.id === event.callId)) break
      deps.setLiveNow({
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
      const current = deps.getLive()
      if (!current || current.id !== event.messageId) break
      deps.setLiveNow({
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
      const current = deps.getLive()
      if (!current || current.id !== event.messageId) break
      deps.setLiveNow({
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
      const current = deps.getSession()
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
      deps.commitSession(next)
      deps.setLiveNow(null)
      // Persist as soon as the assistant message is complete, not only when
      // the whole run finishes, so a crash/close cannot drop the reply.
      void deps.persistSession(next)
      break
    }
    case 'approval-request':
      deps.setApproval(event.request)
      break
    case 'approval-closed':
      deps.setApproval((current) => (current?.id === event.requestId ? null : current))
      break
    case 'usage':
      deps.setUsage(event.usage)
      break
    case 'context-compressed':
      deps.showToast('info', `上下文过长，已压缩 ${event.dropped} 条较早消息`)
      break
    case 'run-end': {
      const pending = deps.getLive()
      const currentSession = deps.getSession()
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
        deps.commitSession(next)
        void deps.persistSession(next)
      } else if (event.usage || event.stats) {
        deps.commitSession(sessionWithUsage)
        void deps.persistSession(sessionWithUsage)
      }
      deps.setRunning(false)
      deps.setLiveNow(null)
      deps.setApproval(null)
      const currentRun = deps.runIdRef.current
      deps.runIdRef.current = null
      if (event.status === 'aborted') {
        deps.showToast('info', '任务已停止')
        deps.setRunError(null)
      } else if (event.status === 'error') {
        const last = deps.getSession().messages[deps.getSession().messages.length - 1]
        if (!last?.error) deps.setRunError(event.error ?? '运行未完成')
      } else {
        deps.setRunError(null)
      }
      if (event.usage) deps.setUsage(event.usage)
      if (currentRun) void deps.persistSession(deps.getSession())
      break
    }
    case 'run-start':
      break
  }
  }
}
