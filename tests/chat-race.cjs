const { chromium } = require('playwright-core')

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const base = process.env.UI_URL || 'http://127.0.0.1:4173'

const mock = `
  const settings = {
    version: 1,
    profiles: [{
      id: 'custom', name: '通用接口', provider: 'openai',
      baseUrl: 'https://api.example.com/v1', model: 'example-chat',
      contextWindow: 128000, temperature: 0.3, maxTokens: 8192, hasKey: true
    }],
    activeProfileId: 'custom',
    workspace: 'D:\\\\desk\\\\华强智码项目',
    approvalMode: 'ask', maxSteps: 24, mcpServers: [], systemPromptExtra: '',
    encryptionAvailable: true
  };
  let agentListener = null;
  window.hq = {
    info: async () => ({ version: '1.0.0', electron: '45.0.0', chrome: '142.0.0', node: '24.14.1', platform: 'win32 x64', dataDir: 'C:\\\\temp' }),
    getSettings: async () => settings,
    saveSettings: async (input) => ({ ...settings, ...input, profiles: settings.profiles }),
    chooseWorkspace: async () => settings.workspace,
    testProfile: async () => ({ ok: true, message: 'ok' }),
    listProfileModels: async () => ({ ok: true, message: 'ok', models: ['example-chat'] }),
    listSessions: async () => [],
    loadSession: async () => null,
    saveSession: async (session) => ({ id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: Date.now(), messageCount: session.messages.length }),
    deleteSession: async () => undefined,
    runAgent: async (input) => {
      const runId = input.runId;
      const messageId = 'final-message';
      setTimeout(() => {
        if (!agentListener) return;
        agentListener({ type: 'assistant-start', runId, messageId });
        agentListener({ type: 'text-delta', runId, messageId, delta: '这是模型最终回复。' });
        agentListener({ type: 'run-end', runId, status: 'done' });
      }, 80);
      return { ok: true };
    },
    abortAgent: async () => undefined,
    approveTool: async () => undefined,
    onAgentEvent: (listener) => { agentListener = listener; return () => { agentListener = null; }; },
    workspaceList: async () => [],
    workspaceRead: async (path) => ({ path, content: '', size: 0, binary: false, truncated: false }),
    workspaceReveal: async () => undefined,
    workspaceOpen: async () => undefined,
    mcpStatuses: async () => [],
    mcpRestart: async () => [],
    mcpTest: async () => ({ ok: true, message: 'ok', tools: [] }),
    openExternal: async () => undefined,
    openDataFolder: async () => undefined,
    minimizeWindow: async () => undefined,
    toggleMaximize: async () => false,
    closeWindow: async () => undefined,
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
  await page.locator('#composer-input').fill('测试最终回复不会被清空')
  await page.locator('#composer-input').press('Enter')
  await page.waitForTimeout(900)
  const text = await page.locator('body').innerText()
  if (!text.includes('这是模型最终回复。')) {
    console.error(text.slice(-2000))
    throw new Error('assistant final message disappeared')
  }
  console.log('race test passed: final assistant message remains')
  await browser.close()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
