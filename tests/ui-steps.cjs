const { chromium } = require('playwright-core')

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const base = process.env.UI_URL || 'http://127.0.0.1:4173'

const settings = {
  version: 1,
  profiles: [
    {
      id: 'custom',
      name: '通用接口',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      model: 'deepseek-flash',
      contextWindow: 128000,
      temperature: 0.3,
      maxTokens: 8192,
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
  let agentListener = null;
  const noop = async () => undefined;
  window.hq = {
    info: async () => ({ version: '1.0.0', electron: '45.0.0', chrome: '142.0.0', node: '24.14.1', platform: 'win32 x64', dataDir: 'C:\\\\temp' }),
    getSettings: async () => settings,
    saveSettings: async (input) => ({ ...settings, ...input }),
    chooseWorkspace: async () => settings.workspace,
    testProfile: async () => ({ ok: true, message: 'ok' }),
    listProfileModels: async () => ({ ok: true, message: 'ok', models: ['deepseek-flash'] }),
    listSessions: async () => [],
    loadSession: async () => null,
    saveSession: async (session) => ({ id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: Date.now(), messageCount: session.messages.length }),
    deleteSession: noop,
    runAgent: async (input) => {
      const runId = input.runId;
      const messageId = 'assistant-steps';
      setTimeout(() => {
        if (!agentListener) return;
        agentListener({ type: 'assistant-start', runId, messageId });
        agentListener({ type: 'reasoning-delta', runId, messageId, delta: '先确认项目结构和现有脚本。' });
        agentListener({ type: 'reasoning-delta', runId, messageId, delta: '然后运行构建并检查输出。' });
        agentListener({ type: 'text-delta', runId, messageId, delta: '构建完成。' });
        agentListener({
          type: 'assistant-end',
          runId,
          message: {
            id: messageId,
            role: 'assistant',
            content: '构建完成。',
            reasoning: '先确认项目结构和现有脚本。\\n\\n然后运行构建并检查输出。',
            createdAt: Date.now(),
            model: 'deepseek-flash',
            toolCalls: [
              { id: 'c1', name: 'run_command', displayName: '运行命令', risk: 'exec', args: { command: 'npm run build' }, status: 'ok', result: 'built successfully', startedAt: Date.now() - 900, endedAt: Date.now() },
              { id: 'c2', name: 'read_file', displayName: '读取文件', risk: 'read', args: { path: 'package.json' }, status: 'ok', result: '{}', startedAt: Date.now() - 500, endedAt: Date.now() }
            ]
          }
        });
        agentListener({ type: 'run-end', runId, status: 'done' });
      }, 120);
      return { ok: true };
    },
    compactConversation: async () => ({ ok: true, summary: 'ok' }),
    abortAgent: noop,
    approveTool: noop,
    onAgentEvent: (listener) => { agentListener = listener; return () => { agentListener = null; }; },
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
  await page.locator('#composer-input').fill('运行构建')
  await page.locator('#composer-input').press('Enter')
  await page.waitForTimeout(600)

  if ((await page.locator('.assistant-model').count()) !== 0) {
    throw new Error('assistant model chip should be removed')
  }
  if (!(await page.locator('.step-summary').isVisible())) {
    throw new Error('completed thought chain should be collapsed')
  }
  await page.screenshot({ path: 'shots/thought-chain-collapsed.png' })
  await page.locator('.step-summary').click()
  await page.waitForTimeout(150)
  if ((await page.locator('.step-thought').count()) < 2) {
    throw new Error('thought chain segments missing')
  }
  if ((await page.locator('.tool-card.is-compact').count()) !== 2) {
    throw new Error('compact tool steps missing')
  }
  const text = await page.locator('.step-timeline').innerText()
  if (!text.includes('思考') || !text.includes('运行命令') || !text.includes('读取文件')) {
    throw new Error('step labels missing')
  }
  await page.screenshot({ path: 'shots/thought-chain.png' })
  console.log('DSH-style thought chain passed')
  await browser.close()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
