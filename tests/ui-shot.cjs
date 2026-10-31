const { chromium } = require('playwright-core')
const fs = require('node:fs')
const path = require('node:path')

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const base = process.env.UI_URL || 'http://127.0.0.1:4173'
const outDir = path.resolve(__dirname, '..', 'shots')
fs.mkdirSync(outDir, { recursive: true })

const now = Date.now()
const settings = {
  version: 1,
  profiles: [
    {
      id: 'custom',
      name: '通用接口',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      model: 'example-chat',
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
  window.hq = {
    info: async () => ({
      version: '1.0.0', electron: '45.0.0', chrome: '142.0.0', node: '24.14.1',
      platform: 'win32 x64', dataDir: 'C:\\\\Users\\\\hq\\\\AppData\\\\Roaming\\\\HuaqiangAgent'
    }),
    getSettings: async () => settings,
    saveSettings: async (input) => ({ ...settings, ...input, profiles: settings.profiles }),
    chooseWorkspace: async () => settings.workspace,
    testProfile: async () => ({ ok: true, message: '连接成功，模型已响应' }),
    listProfileModels: async () => ({
      ok: true, message: '已读取 3 个模型',
      models: ['example-chat', 'example-reasoner', 'example-coder'],
      modelDetails: [
        { id: 'example-chat', contextWindow: 128000, maxOutputTokens: 8192 },
        { id: 'example-reasoner', contextWindow: 200000, maxOutputTokens: 16384 },
        { id: 'example-coder', contextWindow: 256000, maxOutputTokens: 32768 }
      ]
    }),
    listSessions: async () => [],
    loadSession: async () => null,
    saveSession: async (session) => ({
      id: session.id, title: session.title, createdAt: session.createdAt,
      updatedAt: Date.now(), messageCount: session.messages.length
    }),
    deleteSession: async () => undefined,
    runAgent: async () => ({ ok: true }),
    abortAgent: async () => undefined,
    approveTool: async () => undefined,
    onAgentEvent: (listener) => { agentListener = listener; return () => { agentListener = null; }; },
    workspaceList: async () => [],
    workspaceRead: async (path) => ({ path, content: '', size: 0, binary: false, truncated: false }),
    workspaceReveal: async () => undefined,
    workspaceOpen: async () => undefined,
    pythonStatus: async () => ({ available: true, ready: true, installing: false, version: 'Python 3.12.10', venvPath: 'C:\\\\temp\\\\python-env', pythonPath: 'C:\\\\temp\\\\python-env\\\\Scripts\\\\python.exe', installed: ['openpyxl', 'pandas'], missing: [] }),
    pythonSetup: async () => ({ available: true, ready: true, installing: false, version: 'Python 3.12.10', venvPath: 'C:\\\\temp\\\\python-env', pythonPath: 'C:\\\\temp\\\\python-env\\\\Scripts\\\\python.exe', installed: ['openpyxl', 'pandas'], missing: [] }),
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
    args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1']
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } })
  await page.addInitScript(mock)
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  await page.screenshot({ path: path.join(outDir, 'welcome.png') })
  console.log('shot welcome')

  await page.getByTestId('open-settings').click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(outDir, 'settings-model.png') })
  console.log('shot settings-model')

  await browser.close()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
