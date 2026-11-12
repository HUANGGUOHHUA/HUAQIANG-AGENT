import { describe, expect, it } from 'vitest'
import {
  blankProfile,
  draftFromProfile,
  formatTokens,
  parsePairs,
  pairsText,
  toSaveInput
} from '../app/src/renderer/src/lib/settings-form'
import type { UiSettings } from '../app/src/shared/types'

const saved = {
  id: 'p1',
  name: '通用接口',
  provider: 'openai' as const,
  baseUrl: 'https://api.example.com/v1',
  model: 'demo',
  contextWindow: 128_000,
  temperature: 0.3,
  maxTokens: 8_192,
  hasKey: true
}

describe('settings form helpers', () => {
  it('turns a saved profile into an empty-key draft', () => {
    const draft = draftFromProfile(saved)
    expect(draft).toMatchObject({ id: 'p1', model: 'demo', hasKey: true, apiKey: '', clearKey: false })
  })

  it('creates independent blank profiles', () => {
    const first = blankProfile()
    const second = blankProfile()
    expect(first.id).not.toBe(second.id)
    expect(first).toMatchObject({ provider: 'openai', contextWindow: 128_000, maxTokens: 8_192 })
  })

  it('parses KEY=VALUE lines and skips junk', () => {
    expect(parsePairs('A=1\n\n# comment\nB = two\nno equals\n=empty')).toEqual({
      A: '1',
      B: 'two'
    })
  })

  it('round-trips pairs through text', () => {
    const pairs = { TOKEN: 'abc', REGION: 'cn' }
    expect(parsePairs(pairsText(pairs))).toEqual(pairs)
  })

  it('formats token counts the way the model list shows them', () => {
    expect(formatTokens()).toBe('未知')
    expect(formatTokens(0)).toBe('未知')
    expect(formatTokens(512)).toBe('512')
    expect(formatTokens(128_000)).toBe('128K')
    expect(formatTokens(1_500_000)).toBe('1.5M')
  })

  it('keeps security and vision flags when a quick override is saved', () => {
    const settings: UiSettings = {
      version: 1,
      profiles: [
        {
          id: 'p1',
          name: '通用接口',
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
          model: 'demo',
          contextWindow: 128_000,
          temperature: 0.3,
          maxTokens: 8_192,
          hasKey: true,
          vision: true
        }
      ],
      activeProfileId: 'p1',
      workspace: 'C:/workspace',
      elevateOnStart: false,
      agentElevated: false,
      approvalMode: 'ask',
      maxSteps: 0,
      networkLocked: true,
      mcpServers: [],
      systemPromptExtra: '',
      encryptionAvailable: false
    }
    const input = toSaveInput(settings, { approvalMode: 'auto' })
    expect(input.networkLocked).toBe(true)
    expect(input.profiles[0].vision).toBe(true)
    expect(input.approvalMode).toBe('auto')
  })
})
