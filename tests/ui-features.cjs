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
      model: 'demo-model',
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
  mcpServers: [
    {
      id: 'mock-mcp',
      name: 'Mock MCP',
      enabled: true,
      transport: 'stdio',
      command: 'node',
      args: [],
      env: {},
      url: '',
      headers: {}
    }
  ],
  systemPromptExtra: '',
  encryptionAvailable: true
}

const sessions = [
  {
    id: 'session-alpha',
    title: '修复登录页',
    createdAt: Date.now() - 400000,
    updatedAt: Date.now() - 120000,
    messageCount: 4,
    workspace: 'D:\\desk\\华强智码项目'
  },
  {
    id: 'session-beta',
    title: '数据清洗脚本',
    createdAt: Date.now() - 900000,
    updatedAt: Date.now() - 500000,
    messageCount: 6,
    workspace: 'D:\\desk\\python-lab'
  },
  {
    id: 'session-long',
    title: '长对话压缩',
    createdAt: Date.now() - 1800000,
    updatedAt: Date.now() - 100000,
    messageCount: 16,
    workspace: 'D:\\desk\\华强智码项目'
  }
]

const mock = `
  const settings = ${JSON.stringify(settings)};
  const initialSessions = ${JSON.stringify(sessions)};
  let agentListener = null;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  window.hq = {
    info: async () => ({ version: '1.0.0', electron: '45.0.0', chrome: '142.0.0', node: '24.14.1', platform: 'win32 x64', dataDir: 'C:\\\\Users\\\\hq\\\\AppData\\\\Roaming\\\\HuaqiangAgent' }),
    getSettings: async () => settings,
    saveSettings: async (input) => ({ ...settings, ...input }),
    chooseWorkspace: async () => settings.workspace,
    testProfile: async () => ({ ok: true, message: 'ok' }),
    listProfileModels: async () => ({ ok: true, message: 'ok', models: ['demo-model', 'demo-pro', 'demo-fast'], modelDetails: [
      { id: 'demo-model', contextWindow: 128000, maxOutputTokens: 8192 },
      { id: 'demo-pro', contextWindow: 200000, maxOutputTokens: 16384, vision: true },
      { id: 'demo-fast', contextWindow: 64000, maxOutputTokens: 4096 }
    ] }),
    listSessions: async () => initialSessions,
    loadSession: async (id) => {
      const meta = initialSessions.find((item) => item.id === id);
      if (!meta) return null;
      if (id === 'session-long') {
        const messages = [];
        for (let i = 0; i < 8; i += 1) {
          messages.push({ id: 'u-' + i, role: 'user', content: '第 ' + i + ' 轮：继续完善登录页面。' + '上下文细节。'.repeat(900), createdAt: Date.now() - 800000 + i * 1000 });
          messages.push({ id: 'a-' + i, role: 'assistant', content: '第 ' + i + ' 轮：已经完成对应修改。' + '处理结果。'.repeat(900), createdAt: Date.now() - 800000 + i * 1000 + 500 });
        }
        return { ...meta, messages };
      }
      return { ...meta, messages: [{ id: 'old-user', role: 'user', content: '继续这个任务', createdAt: Date.now() }] };
    },
    saveSession: async (session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: Date.now(),
      messageCount: session.messages.length,
      workspace: session.workspace
    }),
    deleteSession: async () => undefined,
    runAgent: async (input) => {
      const runId = input.runId;
      const messageId = 'assistant-demo';
      const toolCalls = Array.from({ length: 7 }, (_, index) => ({
        id: 'call-' + index,
        name: 'write_file',
        displayName: '写入文件',
        risk: 'write',
        args: { path: index === 0 ? 'src/hello.ts' : 'src/file-' + index + '.ts', content: 'line ' + index },
        status: 'ok',
        result: '已创建',
        isError: false,
        stats: { additions: index + 1, deletions: index },
        startedAt: Date.now(),
        endedAt: Date.now()
      }));
      setTimeout(() => {
        if (!agentListener) return;
        agentListener({ type: 'assistant-start', runId, messageId });
        agentListener({ type: 'text-delta', runId, messageId, delta: '已完成演示文件创建。' });
        agentListener({ type: 'tool-start', runId, messageId, callId: 'call-0', name: 'write_file', displayName: '写入文件', risk: 'write', args: { path: 'src/hello.ts', content: 'line 0' } });
        agentListener({ type: 'tool-end', runId, messageId, callId: 'call-0', status: 'ok', result: '已创建 src/hello.ts', isError: false, stats: { additions: 1, deletions: 0 } });
        agentListener({ type: 'assistant-end', runId, message: { id: messageId, role: 'assistant', content: '已完成演示文件创建。', toolCalls, createdAt: Date.now(), model: 'demo-model' } });
        agentListener({ type: 'run-end', runId, status: 'done' });
      }, 120);
      return {
        ok: true,
        workspaceChanges: [
          ...toolCalls.map((call) => ({
            path: call.args.path,
            kind: 'created',
            additions: call.stats.additions,
            deletions: call.stats.deletions
          })),
          { path: 'shell-created.html', kind: 'created', additions: 12, deletions: 0 }
        ]
      };
    },
    compactConversation: async (input) => ({ ok: true, summary: '已按说明压缩：保留登录流程、接口字段和未完成事项。' }),
    abortAgent: async () => undefined,
    approveTool: async () => undefined,
    onAgentEvent: (listener) => { agentListener = listener; return () => { agentListener = null; }; },
    workspaceList: async (path) => {
      if (!path || path === '.') return [
        { name: 'app.ts', path: 'app.ts', type: 'file', size: 220 },
        { name: '空白模板_2页.pptx', path: '空白模板_2页.pptx', type: 'file', size: 29600 },
        { name: 'src', path: 'src', type: 'dir' }
      ];
      return [];
    },
    workspaceRead: async (path) => path.endsWith('.pptx')
      ? ({ path, content: '', size: 29600, binary: true, truncated: false })
      : ({ path, content: 'export interface LoginForm {\\n  username: string;\\n  password: string;\\n}\\n\\nexport function submit(form: LoginForm): boolean {\\n  if (!form.username || !form.password) return false;\\n  return true;\\n}\\n', size: 220, binary: false, truncated: false }),
    workspaceReadAsset: async (path) => ({ path, mime: path.endsWith('.png') ? 'image/png' : 'application/octet-stream', size: 64, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', binary: true, truncated: false }),
    workspaceExtract: async (path) => ({ path, text: 'PDF 提取正文：登录流程说明', truncated: false }),
    workspaceOcr: async (path) => ({ path, text: 'OCR 识别：登录按钮' }),
    pickAttachments: async () => [{ path: 'C:\\\\temp\\\\notes.txt', kind: 'text', content: '上传文件内容', size: 12 }],
    pythonStatus: async () => ({ available: true, ready: true, installing: false, version: 'Python 3.12.10', venvPath: 'C:\\\\temp\\\\python-env', pythonPath: 'C:\\\\temp\\\\python-env\\\\Scripts\\\\python.exe', installed: ['openpyxl', 'pandas'], missing: [] }),
    pythonSetup: async () => ({ available: true, ready: true, installing: false, version: 'Python 3.12.10', venvPath: 'C:\\\\temp\\\\python-env', pythonPath: 'C:\\\\temp\\\\python-env\\\\Scripts\\\\python.exe', installed: ['openpyxl', 'pandas'], missing: [] }),
    workspaceWrite: async (path, content) => ({ path, content, size: content.length, binary: false, truncated: false }),
    workspaceReveal: async () => undefined,
    workspaceOpen: async () => { window.__binaryOpenCalls = (window.__binaryOpenCalls || 0) + 1; },
    workspaceOpenWith: async () => { window.__binaryOpenWithCalls = (window.__binaryOpenWithCalls || 0) + 1; },
    workspaceOpenOffice: async () => { window.__binaryOfficeCalls = (window.__binaryOfficeCalls || 0) + 1; },
    mcpStatuses: async () => [{ id: 'mock-mcp', name: 'Mock MCP', enabled: true, state: 'connected', tools: [{ name: 'echo', description: 'echo' }], resources: [{ uri: 'mock://readme', name: 'Mock README' }], prompts: [{ name: 'mock-prompt' }] }],
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
  page.on('pageerror', (error) => console.error('PAGEERROR', error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('CONSOLE', message.text())
  })
  await page.addInitScript(mock)
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)

  const sidebarText = await page.locator('.sidebar').innerText()
  if (!sidebarText.includes('华强智码项目') || !sidebarText.includes('python-lab')) {
    throw new Error('workspace grouping missing')
  }
  await page.screenshot({ path: 'shots/sidebar-workspaces.png' })
  if (!(await page.locator('.context-ring').isVisible())) throw new Error('context ring missing')
  if (!(await page.locator('.context-ring').innerText()).includes('%')) {
    throw new Error('context ring percentage missing')
  }
  await page.screenshot({ path: 'shots/context-ring.png' })

  await page.locator('#composer-input').fill('/')
  await page.waitForTimeout(150)
  if (!(await page.locator('.command-menu').isVisible())) throw new Error('command menu missing')
  const menuText = await page.locator('.command-menu').innerText()
  if (!menuText.includes('/compact') || !menuText.includes('/export')) {
    throw new Error('commands missing from menu')
  }
  await page.screenshot({ path: 'shots/command-menu.png' })
  await page.locator('#composer-input').fill('')

  await page.locator('#composer-input').fill('/file screenshot.png')
  await page.locator('#composer-input').press('Enter')
  await page.waitForTimeout(300)
  if (!(await page.locator('body').innerText()).includes('OCR 文本')) {
    throw new Error('OCR fallback notice missing')
  }
  await page.screenshot({ path: 'shots/ocr-fallback.png' })
  await page.locator('.attachment-chip button').click()

  await page.locator('.composer-model-chip').click()
  await page.waitForTimeout(300)
  if (!(await page.locator('.model-menu-popover').isVisible())) throw new Error('model menu missing')
  await page.screenshot({ path: 'shots/model-picker-open.png' })
  if (!(await page.locator('.model-menu-popover .vision-badge').isVisible())) {
    throw new Error('vision capability badge missing')
  }
  await page.locator('.model-menu-item', { hasText: 'demo-pro' }).click()
  await page.waitForTimeout(150)
  if (!(await page.locator('.composer-model-chip').innerText()).includes('demo-pro')) {
    throw new Error('session model not applied')
  }
  await page.screenshot({ path: 'shots/model-picker.png' })

  await page.locator('.composer-tool-btn').click()
  if (!(await page.locator('.plus-popover').isVisible())) throw new Error('plus menu missing')
  await page.locator('.plus-popover .popover-item', { hasText: '压缩上下文' }).click()
  if (!(await page.locator('#composer-input').inputValue()).startsWith('/compact')) {
    throw new Error('quick command did not fill composer')
  }
  await page.locator('#composer-input').fill('')

  await page.locator('.composer-reasoning-chip').click()
  await page.locator('.reasoning-popover .popover-item', { hasText: 'Max' }).click()
  if (!(await page.locator('.composer-reasoning-chip').innerText()).includes('Max')) {
    throw new Error('reasoning level not applied')
  }

  await page.locator('.composer-permission-chip').click()
  if (!(await page.locator('.permission-popover').isVisible())) {
    throw new Error('permission menu missing')
  }
  await page.locator('.permission-popover .popover-item', { hasText: '自动执行' }).click()
  await page.waitForTimeout(150)
  if (!(await page.locator('.composer-permission-chip').innerText()).includes('自动执行')) {
    throw new Error('permission choice not applied')
  }
  await page.locator('.composer-permission-chip').click()
  await page.locator('.permission-popover .popover-item', { hasText: '执行前确认' }).click()
  await page.waitForTimeout(150)

  await page.locator('.composer-tool-btn').click()
  await page.locator('.plus-popover .popover-item', { hasText: '上传文件' }).click()
  await page.waitForTimeout(200)
  if (!(await page.locator('.attachment-chip').innerText()).includes('notes.txt')) {
    throw new Error('uploaded attachment chip missing')
  }
  await page.screenshot({ path: 'shots/composer-menus.png' })
  await page.locator('.attachment-chip button').click()

  await page.locator('#composer-input').fill('/file app.ts')
  await page.locator('#composer-input').press('Enter')
  await page.waitForTimeout(200)
  if (!(await page.locator('.attachment-chip').innerText()).includes('app.ts')) {
    throw new Error('file attachment chip missing')
  }
  await page.screenshot({ path: 'shots/attachment-chip.png' })
  await page.locator('.attachment-chip button').click()

  await page.locator('#composer-input').fill('/file screenshot.png')
  await page.locator('#composer-input').press('Enter')
  await page.waitForTimeout(200)
  if (!(await page.locator('.attachment-thumb').isVisible())) throw new Error('image attachment thumbnail missing')
  await page.screenshot({ path: 'shots/image-attachment.png' })
  await page.locator('.attachment-chip button').click()

  await page.locator('#composer-input').fill('/file doc.pdf')
  await page.locator('#composer-input').press('Enter')
  await page.waitForTimeout(200)
  if (!(await page.locator('body').innerText()).includes('已提取 PDF 文本')) {
    throw new Error('PDF extraction attachment missing')
  }
  await page.screenshot({ path: 'shots/pdf-attachment.png' })
  await page.locator('.attachment-chip button').click()

  await page.locator('.header-actions .icon-btn').first().click()
  await page.waitForTimeout(200)
  await page.locator('.tree-row', { hasText: 'app.ts' }).click()
  await page.waitForTimeout(350)
  if (!(await page.locator('.preview-code .hljs-keyword').count())) {
    throw new Error('syntax highlighting missing')
  }
  await page.screenshot({ path: 'shots/workspace-highlight.png' })
  await page.locator('.preview-actions button[title="编辑文件"]').click()
  await page.locator('.preview-editor').fill('export const edited = true\\n')
  await page.locator('.preview-actions button[title^="保存"]').click()
  await page.waitForTimeout(150)
  if (!(await page.locator('.preview-code').innerText()).includes('edited')) {
    throw new Error('workspace editor save failed')
  }
  await page.locator('.preview-back').click()

  await page.locator('.tree-row', { hasText: '空白模板_2页.pptx' }).click()
  await page.waitForTimeout(250)
  if (!(await page.locator('.binary-actions').isVisible())) {
    throw new Error('binary file actions missing')
  }
  await page.locator('.binary-actions .btn.primary').click()
  await page.locator('.binary-actions .btn.ghost').click()
  await page.waitForTimeout(100)
  const openCalls = await page.evaluate(() => ({
    open: window.__binaryOpenCalls || 0,
    office: window.__binaryOfficeCalls || 0
  }))
  if (openCalls.open !== 1 || openCalls.office !== 1) {
    throw new Error('binary open actions are not wired')
  }
  await page.screenshot({ path: 'shots/binary-preview.png' })
  await page.locator('.preview-back').click()

  await page.locator('.session-item', { hasText: '长对话压缩' }).click()
  await page.waitForTimeout(250)
  await page.locator('#composer-input').fill('/compact 保留登录接口和未完成事项')
  await page.locator('#composer-input').press('Enter')
  await page.waitForTimeout(700)
  const compactText = await page.locator('body').innerText()
  if (!compactText.includes('上下文已压缩') || !compactText.includes('保留登录接口')) {
    throw new Error('manual compaction banner missing')
  }
  await page.screenshot({ path: 'shots/compact-banner.png' })

  await page.locator('.new-chat-btn').click()
  await page.locator('#composer-input').fill('创建演示文件')
  await page.locator('#composer-input').press('Enter')
  await page.waitForTimeout(700)
  const bodyText = await page.locator('body').innerText()
  if (!bodyText.includes('已编辑 8 个文件') || !bodyText.includes('src/hello.ts')) {
    throw new Error('turn change summary missing')
  }
  if (!bodyText.includes('全部 8 个文件')) throw new Error('expand-all control missing')
  await page.locator('.turn-changes-expand').click()
  await page.waitForTimeout(100)
  const expandedText = await page.locator('body').innerText()
  if (!expandedText.includes('src/file-6.ts') || !expandedText.includes('shell-created.html')) {
    throw new Error('expanded file list incomplete')
  }
  await page.screenshot({ path: 'shots/turn-changes.png' })

  await page.locator('.right-tab', { hasText: 'MCP' }).click()
  await page.waitForTimeout(100)
  const mcpText = await page.locator('body').innerText()
  if (!mcpText.includes('1 资源') || !mcpText.includes('1 提示')) {
    throw new Error('MCP resources/prompts counts missing')
  }
  await page.screenshot({ path: 'shots/mcp-resources.png' })

  await page.locator('[data-testid="open-settings"]').click()
  await page.waitForTimeout(200)
  if ((await page.locator('.profile-tab').count()) !== 1) {
    throw new Error('initial profile tab missing')
  }
  await page.locator('.profile-switcher-actions .icon-btn').first().click()
  await page.waitForTimeout(100)
  if ((await page.locator('.profile-tab').count()) !== 2) {
    throw new Error('new model profile was not added')
  }
  const secondProfile = page.locator('.profile-tab').nth(1)
  if (!(await secondProfile.innerText()).includes('配置 2')) {
    throw new Error('new model profile label missing')
  }
  await page.screenshot({ path: 'shots/multi-profile.png' })
  await page.locator('.settings-tab', { hasText: '工作区与权限' }).click()
  await page.waitForTimeout(150)
  const pythonText = await page.locator('body').innerText()
  if (!pythonText.includes('Python 基础环境') || !pythonText.includes('已就绪')) {
    throw new Error('Python environment status missing')
  }
  await page.screenshot({ path: 'shots/python-env.png' })
  await page.locator('.settings-tab', { hasText: '模型接入' }).click()
  await page.locator('.settings-modal').locator('.btn.primary').click()
  await page.waitForTimeout(600)
  if (await page.locator('.settings-modal').isVisible()) {
    throw new Error('settings modal did not close after saving profiles')
  }

  console.log('feature UI checks passed')
  await browser.close()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
