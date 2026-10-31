import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDir } from './data-dir'
import type { AppMessage, AttachmentPayload, ChatSession, SessionMeta, SessionStats, ToolCallView, Usage, WorkspaceChange } from '../shared/types'
import type { ReasoningEffort } from '../shared/types'

const ID_RE = /^[a-zA-Z0-9_-]{6,80}$/

function cleanReasoning(value: unknown): ReasoningEffort | undefined {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'max'
    ? value
    : undefined
}

function cleanUsage(value: unknown): Usage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const number = (key: string): number => Math.max(0, Math.round(Number(raw[key]) || 0))
  const usage: Usage = {
    inputTokens: number('inputTokens'),
    outputTokens: number('outputTokens'),
    totalTokens: number('totalTokens'),
    cacheReadTokens: number('cacheReadTokens'),
    cacheMissTokens: number('cacheMissTokens'),
    cacheCreationTokens: number('cacheCreationTokens')
  }
  return usage.totalTokens > 0 || usage.inputTokens > 0 ? usage : undefined
}

function cleanStats(value: unknown): SessionStats | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const number = (key: string): number => Math.max(0, Math.round(Number(raw[key]) || 0))
  const stats: SessionStats = {
    turns: number('turns'),
    steps: number('steps'),
    llmMs: number('llmMs'),
    toolMs: number('toolMs'),
    ttftMs: number('ttftMs'),
    ttftSteps: number('ttftSteps'),
    decodeMs: number('decodeMs'),
    outputTokens: number('outputTokens')
  }
  return stats.steps > 0 || stats.turns > 0 ? stats : undefined
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function cleanChanges(value: unknown): WorkspaceChange[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kinds = new Set(['created', 'updated', 'edited', 'deleted', 'moved', 'directory'])
  const changes: WorkspaceChange[] = []
  for (const item of value.slice(0, 300)) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const path = cleanText(raw.path, 2000)
    if (!path) continue
    const kind = typeof raw.kind === 'string' && kinds.has(raw.kind) ? raw.kind : 'updated'
    changes.push({
      path,
      kind: kind as WorkspaceChange['kind'],
      additions: Math.max(0, Math.round(Number(raw.additions) || 0)),
      deletions: Math.max(0, Math.round(Number(raw.deletions) || 0)),
      target: cleanText(raw.target, 2000) || undefined
    })
  }
  return changes
}

function cleanMessage(value: unknown): AppMessage | null {
  if (!value || typeof value !== 'object') return null
  const message = value as Record<string, unknown>
  if (message.role !== 'user' && message.role !== 'assistant') return null
  const toolCalls: ToolCallView[] | undefined = Array.isArray(message.toolCalls)
    ? message.toolCalls
        .filter((call): call is Record<string, unknown> => Boolean(call) && typeof call === 'object')
        .slice(0, 40)
        .map((call) => ({
          id: cleanText(call.id, 100) || crypto.randomUUID(),
          name: cleanText(call.name, 100) || 'unknown',
          displayName: cleanText(call.displayName, 100) || undefined,
          risk:
            call.risk === 'read' ||
            call.risk === 'write' ||
            call.risk === 'exec' ||
            call.risk === 'network' ||
            call.risk === 'mcp'
              ? call.risk
              : undefined,
          args:
            call.args && typeof call.args === 'object' && !Array.isArray(call.args)
              ? (call.args as Record<string, unknown>)
              : {},
          status:
            call.status === 'ok' ||
            call.status === 'error' ||
            call.status === 'denied' ||
            call.status === 'cancelled' ||
            call.status === 'running'
              ? call.status
              : 'ok',
          result: typeof call.result === 'string' ? call.result.slice(0, 300_000) : undefined,
          isError: Boolean(call.isError),
          stats:
            call.stats && typeof call.stats === 'object'
              ? {
                  additions: Math.max(
                    0,
                    Number((call.stats as Record<string, unknown>).additions) || 0
                  ),
                  deletions: Math.max(
                    0,
                    Number((call.stats as Record<string, unknown>).deletions) || 0
                  )
                }
              : undefined,
          startedAt: typeof call.startedAt === 'number' ? call.startedAt : undefined,
          endedAt: typeof call.endedAt === 'number' ? call.endedAt : undefined
        }))
    : undefined
  const attachments: AttachmentPayload[] | undefined = Array.isArray(message.attachments)
    ? message.attachments
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .slice(0, 8)
        .map((item): AttachmentPayload => {
          const kind =
            item.kind === 'image' || item.kind === 'binary' || item.kind === 'text'
              ? item.kind
              : 'binary'
          return {
            id: cleanText(item.id, 100) || undefined,
            path: cleanText(item.path, 500) || 'attachment',
            kind,
            mime: cleanText(item.mime, 100) || undefined,
            size: typeof item.size === 'number' ? Math.max(0, item.size) : undefined,
            content:
              kind === 'text' && typeof item.content === 'string'
                ? item.content.slice(0, 200_000)
                : undefined,
            dataUrl:
              kind === 'image' && typeof item.dataUrl === 'string'
                ? item.dataUrl.slice(0, 8_000_000)
                : undefined
          }
        })
    : undefined
  return {
    id: cleanText(message.id, 100) || crypto.randomUUID(),
    role: message.role,
    content: cleanText(message.content, 2_000_000),
    reasoning: cleanText(message.reasoning, 1_000_000) || undefined,
    toolCalls,
    createdAt: typeof message.createdAt === 'number' ? message.createdAt : Date.now(),
    model: cleanText(message.model, 200) || undefined,
    error: cleanText(message.error, 10_000) || undefined,
    attachments: attachments && attachments.length ? attachments : undefined
  }
}

function titleFor(session: ChatSession): string {
  const first = session.messages.find((m) => m.role === 'user' && m.content.trim())
  if (!first) return '新对话'
  const text = first.content
    .replace(/[#*`>\[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 30 ? `${text.slice(0, 30)}…` : text || '新对话'
}

export class SessionStore {
  private dir: string

  constructor() {
    this.dir = join(dataDir(), 'conversations')
    mkdirSync(this.dir, { recursive: true })
  }

  private fileFor(id: string): string {
    if (!ID_RE.test(id)) throw new Error('无效的会话 ID')
    return join(this.dir, `${id}.json`)
  }

  async list(): Promise<SessionMeta[]> {
    const files = await readdir(this.dir).catch(() => [] as string[])
    const metas: SessionMeta[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = JSON.parse(await readFile(join(this.dir, file), 'utf8')) as ChatSession
        if (!raw || !ID_RE.test(raw.id)) continue
        metas.push({
          id: raw.id,
          title: cleanText(raw.title, 100) || '新对话',
          createdAt: raw.createdAt || Date.now(),
          updatedAt: raw.updatedAt || raw.createdAt || Date.now(),
          messageCount: Array.isArray(raw.messages) ? raw.messages.length : 0,
          workspace: cleanText(raw.workspace, 2000) || undefined
        })
      } catch {
        // Ignore corrupt session files.
      }
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async load(id: string): Promise<ChatSession | null> {
    const file = this.fileFor(id)
    if (!existsSync(file)) return null
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as ChatSession
      if (!raw || !ID_RE.test(raw.id)) return null
      return {
        id: raw.id,
        title: cleanText(raw.title, 100) || '新对话',
        createdAt: raw.createdAt || Date.now(),
        updatedAt: raw.updatedAt || Date.now(),
        workspace: cleanText(raw.workspace, 2000) || undefined,
        model: cleanText(raw.model, 200) || undefined,
        modelContextWindow:
          typeof raw.modelContextWindow === 'number' && raw.modelContextWindow > 0
            ? Math.round(raw.modelContextWindow)
            : undefined,
        modelMaxTokens:
          typeof raw.modelMaxTokens === 'number' && raw.modelMaxTokens > 0
            ? Math.round(raw.modelMaxTokens)
            : undefined,
        modelVision: typeof raw.modelVision === 'boolean' ? raw.modelVision : undefined,
        reasoningEffort: cleanReasoning(raw.reasoningEffort),
        tokenUsage: cleanUsage(raw.tokenUsage),
        stats: cleanStats(raw.stats),
        contextSummary: cleanText(raw.contextSummary, 20_000) || undefined,
        contextInstruction: cleanText(raw.contextInstruction, 2_000) || undefined,
        lastChanges: cleanChanges(raw.lastChanges),
        messages: Array.isArray(raw.messages)
          ? raw.messages.map(cleanMessage).filter((m): m is AppMessage => Boolean(m)).slice(0, 400)
          : []
      }
    } catch {
      return null
    }
  }

  async save(input: ChatSession): Promise<SessionMeta> {
    if (!input || !ID_RE.test(input.id)) throw new Error('无效的会话 ID')
    const messages = Array.isArray(input.messages)
      ? input.messages.map(cleanMessage).filter((m): m is AppMessage => Boolean(m)).slice(-400)
      : []
    const now = Date.now()
    const session: ChatSession = {
      id: input.id,
      title: cleanText(input.title, 100) || titleFor({ ...input, messages }),
      createdAt: input.createdAt || now,
      updatedAt: now,
      workspace: cleanText(input.workspace, 2000) || undefined,
      model: cleanText(input.model, 200) || undefined,
      modelContextWindow:
        typeof input.modelContextWindow === 'number' && input.modelContextWindow > 0
          ? Math.round(input.modelContextWindow)
          : undefined,
      modelMaxTokens:
        typeof input.modelMaxTokens === 'number' && input.modelMaxTokens > 0
          ? Math.round(input.modelMaxTokens)
          : undefined,
      modelVision: typeof input.modelVision === 'boolean' ? input.modelVision : undefined,
      reasoningEffort: cleanReasoning(input.reasoningEffort),
      tokenUsage: cleanUsage(input.tokenUsage),
      stats: cleanStats(input.stats),
      contextSummary: cleanText(input.contextSummary, 20_000) || undefined,
      contextInstruction: cleanText(input.contextInstruction, 2_000) || undefined,
      lastChanges: cleanChanges(input.lastChanges),
      messages
    }
    const json = JSON.stringify(session, null, 2)
    if (Buffer.byteLength(json, 'utf8') > 20 * 1024 * 1024) {
      throw new Error('会话过大，无法保存')
    }
    const file = this.fileFor(session.id)
    const temp = `${file}.${randomUUID().slice(0, 8)}.tmp`
    await writeFile(temp, json, 'utf8')
    try {
      // Windows: rename can transiently fail with EPERM while Defender or the
      // search indexer holds the freshly written temp file — retry briefly.
      let lastError: unknown
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await rename(temp, file)
          lastError = undefined
          break
        } catch (error) {
          lastError = error
          await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)))
        }
      }
      if (lastError) throw lastError
    } catch (error) {
      await unlink(temp).catch(() => {})
      throw error
    }
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: messages.length,
      workspace: session.workspace
    }
  }

  async remove(id: string): Promise<void> {
    const file = this.fileFor(id)
    await unlink(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}
