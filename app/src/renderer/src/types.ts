import type { ToolCallView } from '../../shared/types'

export interface LiveMessage {
  id: string
  role: 'assistant'
  content: string
  reasoning: string
  toolCalls: ToolCallView[]
  toolDraft?: { name: string; chars: number }
  model?: string
  error?: string
  createdAt: number
}

export interface ToastMessage {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
}
