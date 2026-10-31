const { chromium } = require('playwright-core')

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const base = process.env.UI_URL || 'http://127.0.0.1:4173'

const now = Date.now()
const longMessages = Array.from({ length: 12 }, (_, index) => ({
  id: `long-${index}`,
  role: index % 2 ? 'assistant' : 'user',
  content: `第 ${index} 条历史消息：` + '上下文测试内容。'.repeat(900),
  createdAt: now - (12 - index) * 60_000
}))
const longSession = {
  id: 'long-context',
  title: '长上下文自动压缩',
  createdAt: now - 900_000,
  updatedAt: now,
  workspace: 'D:\\desk\\华强智码项目',
  messages: longMessages,
  tokenUsage: {
    inputTokens: 653_954_501,
    outputTokens: 1_325_522,
    totalTokens: 655_280_023,
    cacheReadTokens: 648_861_952,
    cacheMissTokens: 3_767_027,
    cacheCreationTokens: 1_325_522
  },
  stats: {
    turns: 49,
    steps: 1835,
    llmMs: 12_220_000,
    toolMs: 7_183_000,
    ttftMs: 6_973,
    ttftSteps: 1835,
    decodeMs: 5_206_000,
    outputTokens: 1_325_522
  }
}
const meta = {
  id: longSession.id,
  title: longSession.title,
  createdAt: longSession.createdAt,
  updatedAt: longSession.updatedAt,
  messageCount: longMessages.length,
  workspace: longSession.workspace
}

const settings = {
  version: 1,
  profiles: [
    {
      id: 'custom',
      name: '通用接口',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      model: 'demo-model',
      contextWindow: 8000,
      temperature: 0.3,
      maxTokens: 4096,
      hasKey: true
    }
  ],
  activeProfileId: 'custom',
  workspace: 'D:\\desk\\华强智码项目',
  approvalMode: 'ask',
  maxSteps: 24,
  mcpServers: [],
  systemPromptExtra: '',
  encryptionAvailable: true
}

const mock = `
  const settings = ${JSON.stringify(settings)};
  const longSession = ${JSON.stringify(longSession)};
  window.__compactCalls = 0;
  const noop = async () => undefined;
  window.hq = {
    info: async () => ({ version: '1.0.0', electron: '45.0.0', chrome: '142.0.0', node: '24.14.1', platform: 'win32 x64', dataDir: 'C:\\\\temp' }),
    getSettings: async () => settings,
    saveSettings: async (input) => ({ ...settings, ...input }),
    chooseWorkspace: async () => settings.workspace,
    testProfile: async () => ({ ok: true, message: 'ok' }),
    listProfileModels: async () => ({ ok: true, message: 'ok', models: ['demo-model'] }),
    listSessions: async () => [${JSON.stringify(meta)}],
    loadSession: async () => longSession,
    saveSession: async (session) => ({ id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: Date.now(), messageCount: session.messages.length }),
    deleteSession: noop,
    runAgent: async () => ({ ok: true }),
    compactConversation: async () => { window.__compactCalls += 1; return { ok: true, summary: '自动压缩摘要内容' } },
    abortAgent: noop,
    approveTool: noop,
    onAgentEvent: () => () => undefined,
    workspaceList: async () => [],
    workspaceRead: async (path) => ({ path, content: '', size: 0, binary: false, truncated: false }),
    workspaceWrite: async (path, content) => ({ path, content, size: content.length, binary: false, truncated: false }),
    workspaceReadAsset: async (path) => ({ path, mime: 'application/octet-stream', size: 0, dataUrl: '', binary: true, truncated: false }),
    workspaceExtract: async (path) => ({ path, text: '', truncated: false }),
    workspaceOcr: async (path) => ({ path, text: '' }),
    pickAttachments: async () => [],
    workspaceReveal: noop,
    workspaceOpen: noop,
    mcpStatuses: async () => [],
    mcpRestart: async () => [],
    mcpTest: async () => ({ ok: true, message: 'ok', tools: [] }),
    openExternal: noop,
    openDataFolder: noop,
    minimizeWindow: noop,
    toggleMaximize: async () => false,
    closeWindow: noop,
    isMaximized: async () => false,
    onWindowState: () => () => undefined
  };
`

;(async () => {
  const browser = await chromium.launch({
    executablePath: edge,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } })
  await page.addInitScript(mock)
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  await page.locator('.session-item', { hasText: '长上下文自动压缩' }).click()
  await page.waitForTimeout(900)
  const calls = await page.evaluate(() => window.__compactCalls)
  if (calls < 1) throw new Error('auto compaction was not triggered')
  if (!(await page.locator('body').innerText()).includes('上下文已压缩')) {
    throw new Error('auto compaction banner missing')
  }
  const text = await page.locator('body').innerText()
  if (!text.includes('缓存命中')) {
    throw new Error('cache usage pill missing')
  }
  if (!text.includes('轮') || !text.includes('步')) {
    throw new Error('session activity pill missing')
  }
  await page.locator('.stat-pill', { hasText: '轮' }).click()
  await page.waitForTimeout(150)
  const statsText = await page.locator('body').innerText()
  if (!statsText.includes('会话统计') || !statsText.includes('首 token 平均')) {
    throw new Error('session statistics dialog missing')
  }
  await page.screenshot({ path: 'shots/session-stats.png' })
  await page.locator('.stat-pill', { hasText: '缓存命中' }).click()
  await page.waitForTimeout(150)
  const usageText = await page.locator('body').innerText()
  if (!usageText.includes('Token 用量') || !usageText.includes('未缓存输入') || !usageText.includes('缓存读取')) {
    throw new Error('cache usage dialog missing')
  }
  await page.screenshot({ path: 'shots/token-usage.png' })
  await page.locator('.context-ring').click()
  await page.waitForTimeout(150)
  const contextText = await page.locator('body').innerText()
  if (
    !contextText.includes('上下文已用') ||
    !contextText.includes('系统提示词') ||
    !contextText.includes('工具定义') ||
    !contextText.includes('对话消息')
  ) {
    throw new Error('context breakdown dialog missing')
  }
  await page.screenshot({ path: 'shots/context-auto-compact.png' })
  console.log('context ring and auto compaction passed')
  await browser.close()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
