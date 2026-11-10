import type {
  ApiProfile,
  ProfileDraft,
  SettingsSaveInput,
  UiSettings
} from '../../../shared/types'
import { uid } from './utils'

/** 设置面板里正在编辑的配置草稿：密钥只保留本次输入，已保存密钥不回落。 */
export interface DraftProfile extends ProfileDraft {
  apiKey: string
  clearKey: boolean
  hasKey: boolean
}

export function draftFromProfile(profile: ApiProfile): DraftProfile {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    contextWindow: profile.contextWindow,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    vision: profile.vision,
    apiKey: '',
    clearKey: false,
    hasKey: profile.hasKey
  }
}

export function formatTokens(value?: number): string {
  if (!value || value <= 0) return '未知'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}

export function blankProfile(): DraftProfile {
  return {
    id: uid(),
    name: '通用接口',
    provider: 'openai',
    baseUrl: '',
    model: '',
    contextWindow: 128000,
    temperature: 0.3,
    maxTokens: 8192,
    apiKey: '',
    clearKey: false,
    hasKey: false
  }
}

export function parsePairs(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    if (!key) continue
    result[key] = line.slice(index + 1).trim()
  }
  return result
}

export function pairsText(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}
/** Map the visible settings back into the IPC payload without dropping fields. */
export function toSaveInput(
  settings: UiSettings,
  overrides: Partial<SettingsSaveInput> = {}
): SettingsSaveInput {
  return {
    profiles: settings.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      contextWindow: profile.contextWindow,
      temperature: profile.temperature,
      maxTokens: profile.maxTokens,
      vision: profile.vision
    })),
    activeProfileId: settings.activeProfileId,
    workspace: settings.workspace,
    elevateOnStart: settings.elevateOnStart,
    agentElevated: settings.agentElevated,
    approvalMode: settings.approvalMode,
    maxSteps: settings.maxSteps,
    networkLocked: settings.networkLocked,
    mcpServers: settings.mcpServers,
    systemPromptExtra: settings.systemPromptExtra,
    ...overrides
  }
}
