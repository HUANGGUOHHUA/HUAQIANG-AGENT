import { afterAll, describe, expect, it, vi } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { SettingsStore } from '../app/src/main/settings'
import { SessionStore } from '../app/src/main/sessions'
import type { ChatSession } from '../app/src/shared/types'

vi.mock('electron', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-persist-'))
  return {
    app: {
      isPackaged: false,
      getAppPath: () => root,
      getPath: (name: string): string => {
        const target = name === 'documents' ? path.join(root, 'documents') : root
        fs.mkdirSync(target, { recursive: true })
        return target
      }
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(value, 'utf8'),
      decryptString: (value: Buffer) => value.toString('utf8')
    }
  }
})

const dataDir = join(app.getAppPath(), 'data')
const workspace = join(dataDir, 'workspace')

afterAll(() => {
  rmSync(app.getAppPath(), { recursive: true, force: true })
})

describe('settings persistence', () => {
  it('starts with the current generic endpoint as the default profile', () => {
    const store = new SettingsStore()
    const defaults = store.getPublic()
    expect(defaults.activeProfileId).toBe('custom')
    expect(defaults.maxSteps).toBe(0)
    expect(defaults.profiles[0]).toMatchObject({
      id: 'custom',
      name: '通用接口',
      provider: 'openai',
      baseUrl: 'http://10.1.0.10:8080/v1/chat/completions',
      model: 'swift-1.5-iq2_xs',
      contextWindow: 128_000,
      maxTokens: 128_000
    })
  })

  it('writes settings.json and reloads saved profile, workspace and approval mode', () => {
    const store = new SettingsStore()
    expect(existsSync(join(dataDir, 'settings.json'))).toBe(true)

    store.save({
      profiles: [
        {
          id: 'test-profile',
          name: '通用接口',
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
          model: 'example-chat',
          contextWindow: 128000,
          temperature: 0.2,
          maxTokens: 4096
        }
      ],
      activeProfileId: 'test-profile',
      workspace,
      approvalMode: 'auto',
      maxSteps: 30,
      mcpServers: [],
      systemPromptExtra: '项目规范'
    })

    const reloaded = new SettingsStore()
    const publicSettings = reloaded.getPublic()
    expect(publicSettings.profiles).toHaveLength(1)
    expect(publicSettings.profiles[0].baseUrl).toBe('https://api.example.com/v1')
    expect(publicSettings.profiles[0].model).toBe('example-chat')
    expect(publicSettings.profiles[0].contextWindow).toBe(128000)
    expect(publicSettings.workspace).toBe(workspace)
    expect(publicSettings.approvalMode).toBe('auto')
    expect(publicSettings.systemPromptExtra).toBe('项目规范')
  })

  it('saves multiple model profiles and keeps the active one', () => {
    const store = new SettingsStore()
    store.save({
      profiles: [
        {
          id: 'profile-a',
          name: '主配置',
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
          model: 'model-a',
          contextWindow: 128000,
          temperature: 0.2,
          maxTokens: 4096
        },
        {
          id: 'profile-b',
          name: '备用配置',
          provider: 'anthropic',
          baseUrl: 'https://api.another.com/v1',
          model: 'model-b',
          contextWindow: 200000,
          temperature: 0.1,
          maxTokens: 8192,
          vision: true
        }
      ],
      activeProfileId: 'profile-b',
      workspace,
      approvalMode: 'ask',
      maxSteps: 24,
      mcpServers: [],
      systemPromptExtra: '',
      apiKeys: { 'profile-b': 'sk-test-b' }
    })
    const reloaded = new SettingsStore()
    const publicSettings = reloaded.getPublic()
    expect(publicSettings.profiles).toHaveLength(2)
    expect(publicSettings.activeProfileId).toBe('profile-b')
    expect(publicSettings.profiles[1].name).toBe('备用配置')
    expect(publicSettings.profiles[1].vision).toBe(true)
    expect(reloaded.getProfileById('profile-b')?.apiKey).toBe('sk-test-b')
  })
})

describe('conversation persistence', () => {
  it('saves a conversation, lists it and reloads the full message history', async () => {
    const store = new SessionStore()
    const session: ChatSession = {
      id: 'session-persist-1',
      title: '持久化测试',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workspace,
      model: 'session-model',
      modelContextWindow: 200000,
      modelMaxTokens: 16384,
      modelVision: true,
      reasoningEffort: 'high',
      tokenUsage: {
        inputTokens: 1000,
        outputTokens: 200,
        totalTokens: 1200,
        cacheReadTokens: 800,
        cacheMissTokens: 200,
        cacheCreationTokens: 0
      },
      stats: {
        turns: 1,
        steps: 2,
        llmMs: 5000,
        toolMs: 1200,
        ttftMs: 800,
        ttftSteps: 2,
        decodeMs: 3000,
        outputTokens: 200
      },
      messages: [
        { id: 'message-user-1', role: 'user', content: '你好', createdAt: Date.now() },
        {
          id: 'message-assistant-1',
          role: 'assistant',
          content: '你好，这是保存后的回复。',
          createdAt: Date.now(),
          model: 'example-chat'
        }
      ]
    }

    await store.save(session)
    const list = await store.list()
    const meta = list.find((item) => item.id === session.id)
    expect(meta?.messageCount).toBe(2)

    const loaded = await store.load(session.id)
    expect(loaded?.title).toBe('持久化测试')
    expect(loaded?.workspace).toBe(workspace)
    expect(loaded?.model).toBe('session-model')
    expect(loaded?.modelContextWindow).toBe(200000)
    expect(loaded?.modelMaxTokens).toBe(16384)
    expect(loaded?.modelVision).toBe(true)
    expect(loaded?.reasoningEffort).toBe('high')
    expect(loaded?.tokenUsage).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      cacheReadTokens: 800,
      cacheMissTokens: 200,
      cacheCreationTokens: 0
    })
    expect(loaded?.stats?.steps).toBe(2)
    expect(loaded?.stats?.llmMs).toBe(5000)
    expect(loaded?.messages).toHaveLength(2)
    expect(loaded?.messages[1].content).toContain('保存后的回复')
  })
})
