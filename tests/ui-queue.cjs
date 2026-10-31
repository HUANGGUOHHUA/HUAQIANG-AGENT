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
  mcpServers: [],
  systemPromptExtra: '',
  encryptionAvailable: true
}

const mock = `
  const settings = ${JSON.stringify(settings)};
  let agentListener = null;
  window.__calls = [];
  const finalEvent = (runId, messageId, content) => {
    setTimeout(() => {
      if (!agentListener) return;
      agentListener({ type: 'assistant-start', runId, messageId });
      agentListener({ type: 'text-delta', runId, messageId, delta: content });
      agentListener({ type: 'assistant-end', runId, message: { id: messageId, role: 'assistant', content, createdAt: Date.now(), model: 'demo-model' } });
      agentListener({ type: 'run-end', runId, status: 'done' });
    }, 100);
  };
  window.hq = {
    info: async () => ({ version: '1.0.0', electron: '45.0.0', chrome: '142.0.0', node: '24.14.1', platform: 'win32 x64', dataDir: 'C:\\\\temp' }),
    getSettings: async () => settings,
    saveSettings: async (input) => ({ ...settings, ...input }),
    chooseWorkspace: async () => settings.workspace,
    testProfile: async () => ({ ok: true, message: 'ok' }),
    listProfileModels: async () => ({ ok: true, message: 'ok', models: ['demo-model'], modelDetails: [{ id: 'demo-model', contextWindow: 128000, maxOutputTokens: 8192 }] }),
    listSessions: async () => [],
    loadSession: async () => null,
    saveSession: async (session) => ({ id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: Date.now(), messageCount: session.messages.length, workspace: session.workspace }),
    deleteSession: async () => undefined,
    runAgent: async (input) => {
      const prompt = input.messages[input.messages.length - 1]?.content || '';
      window.__calls.push(prompt);
      const runId = input.runId;
      const messageId = 'queue-message-' + window.__calls.length;
      if (prompt.includes('失败任务') && window.__calls.filter((item) => item.includes('失败任务')).length === 1) {
        setTimeout(() => {
          if (!agentListener) return;
          agentListener({ type: 'assistant-start', runId, messageId });
          agentListener({ type: 'assistant-end', runId, message: { id: messageId, role: 'assistant', content: '', createdAt: Date.now(), error: '模拟失败' } });
          agentListener({ type: 'run-end', runId, status: 'error', error: '模拟失败' });
        }, 100);
        return { ok: false, error: '模拟失败' };
      }
      if (prompt.includes('慢任务')) {
        setTimeout(() => {
          if (!agentListener) return;
          agentListener({ type: 'assistant-start', runId, messageId });
          setTimeout(() => {
            if (!agentListener) return;
            agentListener({ type: 'text-delta', runId, messageId, delta: '慢任务完成' });
            agentListener({ type: 'assistant-end', runId, message: { id: messageId, role: 'assistant', content: '慢任务完成', createdAt: Date.now(), model: 'demo-model' } });
            agentListener({ type: 'run-end', runId, status: 'done' });
          }, 700);
        }, 50);
        return { ok: true };
      }
      finalEvent(runId, messageId, '回复：' + prompt);
      return { ok: true };
    },
    compactConversation: async () => ({ ok: true, summary: 'ok' }),
    abortAgent: async () => undefined,
    approveTool: async () => undefined,
    onAgentEvent: (listener) => { agentListener = listener; return () => { agentListener = null; }; },
    workspaceList: async () => [],
    workspaceRead: async (path) => ({ path, content: '', size: 0, binary: false, truncated: false }),
    workspaceWrite: async (path, content) => ({ path, content, size: content.length, binary: false, truncated: false }),
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

  await page.locator('#composer-input').fill('慢任务')
  await page.locator('#composer-input').press('Enter')
  await page.waitForTimeout(120)
  await page.locator('#composer-input').fill('排队任务')
  await page.locator('#composer-input').press('Enter')
  await page.waitForTimeout(100)
  if (!(await page.locator('.composer-queue').isVisible())) throw new Error('queue chip missing')
  await page.screenshot({ path: 'shots/queue.png' })
  await page.waitForTimeout(1400)
  const calls = await page.evaluate(() => window.__calls)
  if (!calls.includes('排队任务')) throw new Error('queued message was not sent')
  const queueText = await page.locator('.composer-queue').count()
  if (queueText !== 0) throw new Error('queue was not drained')

  await page.locator('#composer-input').fill('失败任务')
  await page.locator('#composer-input').press('Enter')
  await page.waitForTimeout(500)
  if (!(await page.locator('.run-retry').isVisible())) throw new Error('retry button missing')
  await page.locator('.run-retry').click()
  await page.waitForTimeout(500)
  const callsAfterRetry = await page.evaluate(() => window.__calls)
  if (callsAfterRetry.filter((item) => item === '失败任务').length < 2) {
    throw new Error('retry did not resend the last user message')
  }

  await page.locator('#composer-input').fill('慢任务')
  await page.locator('#composer-input').press('Enter')
  await page.waitForTimeout(100)
  await page.locator('#composer-input').fill('不应发送')
  await page.locator('#composer-input').press('Enter')
  await page.waitForTimeout(100)
  if (!(await page.locator('.composer-queue').isVisible())) throw new Error('stop test queue missing')
  await page.locator('.send-btn.stop').click()
  await page.waitForTimeout(200)
  if ((await page.locator('.composer-queue').count()) !== 0) {
    throw new Error('stop did not clear queued messages')
  }
  await page.waitForTimeout(1000)
  const callsAfterStop = await page.evaluate(() => window.__calls)
  if (callsAfterStop.includes('不应发送')) {
    throw new Error('queued message was sent after stop')
  }
  console.log('queue and retry checks passed')
  await browser.close()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
