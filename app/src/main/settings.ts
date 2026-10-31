import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { dataDir } from './data-dir'
import type {
  ApiProfile,
  McpServerConfig,
  ProfileDraft,
  SettingsSaveInput,
  UiSettings
} from '../shared/types'

interface StoredProfile extends ProfileDraft {
  apiKeyEnc?: string
}

interface StoredSettings {
  version: number
  profiles: StoredProfile[]
  activeProfileId: string
  workspace: string
  elevateOnStart: boolean
  agentElevated: boolean
  approvalMode: 'ask' | 'auto'
  maxSteps: number
  mcpServers: McpServerConfig[]
  systemPromptExtra: string
}

const DEFAULT_API_KEY = "sk-134567890sv"

const DEFAULT_PROFILE: StoredProfile = {
  id: 'custom',
  name: '通用接口',
  provider: 'openai',
  baseUrl: 'http://10.1.0.10:8080/v1/chat/completions',
  model: 'swift-1.5-iq2_xs',
  contextWindow: 128000,
  temperature: 0.2,
  maxTokens: 128000
}

function defaultKeyFor(profile: StoredProfile): string {
  const stored = decryptKey(profile.apiKeyEnc)
  if (stored) return stored
  return profile.id === DEFAULT_PROFILE.id && profile.baseUrl === DEFAULT_PROFILE.baseUrl
    ? DEFAULT_API_KEY
    : ''
}

const LEGACY_KIMI_PROFILE = {
  id: 'kimi-code',
  baseUrl: 'https://api.kimi.com/coding/v1',
  model: 'kimi-for-coding'
}

function defaultWorkspace(): string {
  // Security software often protects the Documents folder and blocks unsigned
  // apps from writing there. Prefer a user-writable non-system drive first.
  for (const drive of ['D', 'E', 'F', 'G']) {
    const root = `${drive}:\\`
    if (!existsSync(root)) continue
    const candidate = join(root, '华强以太项目')
    try {
      mkdirSync(candidate, { recursive: true })
      return candidate
    } catch {
      // Drive exists but is not writable; try the next one.
    }
  }
  const dir = join(app.getPath('documents'), '华强以太项目')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // If Documents is unavailable, fall back to userData.
  }
  if (existsSync(dir)) return dir
  const fallback = join(app.getPath('userData'), 'workspace')
  mkdirSync(fallback, { recursive: true })
  return fallback
}

function defaults(): StoredSettings {
  return {
    version: 1,
    profiles: [{ ...DEFAULT_PROFILE }],
    activeProfileId: DEFAULT_PROFILE.id,
    workspace: defaultWorkspace(),
    elevateOnStart: false,
    agentElevated: false,
    approvalMode: 'ask',
    maxSteps: 0,
    mcpServers: [],
    systemPromptExtra: ''
  }
}

function encryptKey(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return `safe:${safeStorage.encryptString(plain).toString('base64')}`
  }
  return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`
}

function decryptKey(stored: string | undefined): string {
  if (!stored) return ''
  try {
    if (stored.startsWith('safe:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(5), 'base64'))
    }
    if (stored.startsWith('plain:')) {
      return Buffer.from(stored.slice(6), 'base64').toString('utf8')
    }
    return stored
  } catch {
    return ''
  }
}

function cleanString(value: unknown, max = 4000): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function cleanMcpServers(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .slice(0, 30)
    .map((item, index) => ({
      id: cleanString(item.id, 80) || `mcp-${index + 1}`,
      name: cleanString(item.name, 80) || `MCP ${index + 1}`,
      enabled: Boolean(item.enabled),
      transport: item.transport === 'http' ? 'http' : 'stdio',
      command: cleanString(item.command, 500),
      args: Array.isArray(item.args)
        ? item.args.filter((arg): arg is string => typeof arg === 'string').slice(0, 50)
        : [],
      env:
        item.env && typeof item.env === 'object' && !Array.isArray(item.env)
          ? Object.fromEntries(
              Object.entries(item.env as Record<string, unknown>)
                .filter(([, v]) => typeof v === 'string')
                .slice(0, 40)
                .map(([k, v]) => [cleanString(k, 120), cleanString(v, 2000)])
            )
          : {},
      url: cleanString(item.url, 2000),
      headers:
        item.headers && typeof item.headers === 'object' && !Array.isArray(item.headers)
          ? Object.fromEntries(
              Object.entries(item.headers as Record<string, unknown>)
                .filter(([, v]) => typeof v === 'string')
                .slice(0, 40)
                .map(([k, v]) => [cleanString(k, 120), cleanString(v, 4000)])
            )
          : {}
    }))
}

export class SettingsStore {
  private file: string
  private data: StoredSettings

  constructor() {
    this.file = join(dataDir(), 'settings.json')
    this.data = this.load()
    if (!existsSync(this.data.workspace)) {
      try {
        mkdirSync(this.data.workspace, { recursive: true })
      } catch (error) {
        console.error('Failed to create workspace:', error)
      }
    }
    if (!this.data.profiles.some((profile) => profile.id === this.data.activeProfileId)) {
      this.data.activeProfileId = this.data.profiles[0]?.id ?? DEFAULT_PROFILE.id
    }
    try {
      // Normalize and write once at startup so new fields (e.g. contextWindow)
      // and legacy migrations are persisted even for existing settings files.
      this.persist()
    } catch (error) {
      console.error('Failed to persist settings:', error)
    }
  }

  private load(): StoredSettings {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoredSettings>
        const base = defaults()
        const profiles: StoredProfile[] = Array.isArray(raw.profiles)
          ? raw.profiles
              .filter((p): p is StoredProfile => Boolean(p) && typeof p === 'object')
              .map((p) => ({
                ...p,
                id: cleanString(p.id, 80) || `profile-${Date.now()}`,
                name: cleanString(p.name, 80) || '通用接口',
                provider: p.provider === 'anthropic' ? ('anthropic' as const) : ('openai' as const),
                baseUrl: cleanString(p.baseUrl, 1000),
                model: cleanString(p.model, 200),
                contextWindow: Math.round(clampNumber(p.contextWindow, 4000, 2_000_000, 128000)),
                temperature: clampNumber(p.temperature, 0, 2, 0.3),
                maxTokens: Math.round(clampNumber(p.maxTokens, 256, 128000, 8192)),
                vision: typeof p.vision === 'boolean' ? p.vision : undefined,
                apiKeyEnc: typeof p.apiKeyEnc === 'string' ? p.apiKeyEnc : undefined
              }))
          : base.profiles
        const untouchedKimi =
          profiles.length === 1 &&
          !profiles[0].apiKeyEnc &&
          profiles[0].id === LEGACY_KIMI_PROFILE.id &&
          profiles[0].baseUrl === LEGACY_KIMI_PROFILE.baseUrl &&
          profiles[0].model === LEGACY_KIMI_PROFILE.model
        if (untouchedKimi) profiles[0] = { ...base.profiles[0] }
        let activeProfileId = cleanString(raw.activeProfileId, 80)
        if (!profiles.some((profile) => profile.id === activeProfileId)) {
          activeProfileId = profiles[0]?.id ?? base.activeProfileId
        }
        return {
          version: 1,
          profiles: profiles.length ? profiles : base.profiles,
          activeProfileId,
          workspace: cleanString(raw.workspace, 2000) || base.workspace,
          elevateOnStart: raw.elevateOnStart === true,
          agentElevated: raw.agentElevated === true,
          approvalMode: raw.approvalMode === 'auto' ? 'auto' : 'ask',
          maxSteps: Math.max(0, Math.round(clampNumber(raw.maxSteps, 0, Number.MAX_SAFE_INTEGER, 0))),
          mcpServers: cleanMcpServers(raw.mcpServers),
          systemPromptExtra: cleanString(raw.systemPromptExtra, 20000)
        }
      }
    } catch (error) {
      console.error('Failed to load settings, using defaults:', error)
    }
    return defaults()
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const temp = `${this.file}.tmp`
    writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(temp, this.file)
  }

  private toPublic(): UiSettings {
    return {
      version: 1,
      profiles: this.data.profiles.map<ApiProfile>((p) => ({
        id: p.id,
        name: p.name,
        provider: p.provider,
        baseUrl: p.baseUrl,
        model: p.model,
        contextWindow: p.contextWindow,
        temperature: p.temperature,
        maxTokens: p.maxTokens,
        hasKey: Boolean(p.apiKeyEnc) || Boolean(defaultKeyFor(p)),
        vision: p.vision
      })),
      activeProfileId: this.data.activeProfileId,
      workspace: this.data.workspace,
      elevateOnStart: this.data.elevateOnStart,
      agentElevated: this.data.agentElevated,
      approvalMode: this.data.approvalMode,
      maxSteps: this.data.maxSteps,
      mcpServers: this.data.mcpServers,
      systemPromptExtra: this.data.systemPromptExtra,
      encryptionAvailable: safeStorage.isEncryptionAvailable()
    }
  }

  getPublic(): UiSettings {
    return this.toPublic()
  }

  getRaw(): StoredSettings {
    return this.data
  }

  setWorkspace(workspace: string): void {
    const cleaned = workspace.trim()
    if (!cleaned) return
    this.data.workspace = cleaned
    this.persist()
  }

  setAgentElevated(value: boolean): void {
    this.data.agentElevated = value
    this.persist()
  }

  getActiveProfile(): { profile: StoredProfile; apiKey: string } {
    let profile =
      this.data.profiles.find((p) => p.id === this.data.activeProfileId) ?? this.data.profiles[0]
    if (!profile) {
      profile = { ...DEFAULT_PROFILE }
      this.data.profiles = [profile]
      this.data.activeProfileId = profile.id
      this.persist()
    }
    return { profile, apiKey: defaultKeyFor(profile) }
  }

  getProfileById(id: string): { profile: StoredProfile; apiKey: string } | null {
    const profile = this.data.profiles.find((p) => p.id === id)
    return profile ? { profile, apiKey: defaultKeyFor(profile) } : null
  }

  save(input: SettingsSaveInput): UiSettings {
    if (!input || !Array.isArray(input.profiles) || input.profiles.length === 0) {
      throw new Error('至少需要保留一个模型配置')
    }

    const oldById = new Map(this.data.profiles.map((p) => [p.id, p]))
    const seen = new Set<string>()
    const profiles: StoredProfile[] = []

    for (const draft of input.profiles.slice(0, 20)) {
      const id = cleanString(draft.id, 80) || crypto.randomUUID()
      if (seen.has(id)) continue
      seen.add(id)
      const old = oldById.get(id)
      const provider = draft.provider === 'anthropic' ? 'anthropic' : 'openai'
      const baseUrl = cleanString(draft.baseUrl, 1000).trim()
      const model = cleanString(draft.model, 200).trim()
      if (baseUrl) {
        try {
          const parsed = new URL(baseUrl)
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('仅支持 http/https')
          }
        } catch {
          throw new Error(`Base URL 格式不正确：${baseUrl}`)
        }
      }

      let apiKeyEnc = old?.apiKeyEnc
      if (input.apiKeys && Object.prototype.hasOwnProperty.call(input.apiKeys, id)) {
        const key = input.apiKeys[id]
        apiKeyEnc = typeof key === 'string' && key.trim() ? encryptKey(key.trim()) : undefined
      }

      profiles.push({
        id,
        name: cleanString(draft.name, 80).trim() || '通用接口',
        provider,
        baseUrl: baseUrl.replace(/\/+$/, ''),
        model,
        contextWindow: Math.round(clampNumber(draft.contextWindow, 4000, 2_000_000, 128000)),
        temperature: clampNumber(draft.temperature, 0, 2, 0.3),
        maxTokens: Math.round(clampNumber(draft.maxTokens, 256, 128000, 8192)),
        vision: typeof draft.vision === 'boolean' ? draft.vision : undefined,
        apiKeyEnc
      })
    }

    if (!profiles.length) throw new Error('至少需要保留一个模型配置')

    const cleanedWorkspace = cleanString(input.workspace, 2000)
    const workspace =
      cleanedWorkspace && !isAbsolute(cleanedWorkspace)
        ? this.data.workspace
        : resolve(cleanedWorkspace || this.data.workspace)
    if (!existsSync(workspace)) {
      try {
        mkdirSync(workspace, { recursive: true })
      } catch {
        throw new Error(`无法创建工作区：${workspace}`)
      }
    }

    const previous = this.data
    this.data = {
      version: 1,
      profiles,
      activeProfileId: profiles.some((p) => p.id === input.activeProfileId)
        ? input.activeProfileId
        : profiles[0].id,
      workspace,
      elevateOnStart: input.elevateOnStart === true,
      agentElevated: input.agentElevated === true,
      approvalMode: input.approvalMode === 'auto' ? 'auto' : 'ask',
      maxSteps: Math.max(0, Math.round(clampNumber(input.maxSteps, 0, Number.MAX_SAFE_INTEGER, 0))),
      mcpServers: cleanMcpServers(input.mcpServers),
      systemPromptExtra: cleanString(input.systemPromptExtra, 20000)
    }
    try {
      this.persist()
    } catch (error) {
      this.data = previous
      console.error('Failed to persist settings:', error)
      throw new Error('保存设置失败，请检查磁盘权限')
    }
    return this.toPublic()
  }
}
