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
  window.hq = {
    info: async () => ({ version: '1.0.0', electron: '45.0.0', chrome: '142.0.0', node: '24.14.1', platform: 'win32 x64', dataDir: 'C:\\\\temp' }),
    getSettings: async () => settings,
    saveSettings: async (input) => ({ ...settings, ...input }),
    chooseWorkspace: async () => settings.workspace,
    testProfile: async () => ({ ok: true, message: 'ok' }),
    listProfileModels: async () => ({ ok: true, message: 'ok', models: [] }),
    listSessions: async () => [],
    loadSession: async () => null,
    saveSession: async (session) => ({ id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: Date.now(), messageCount: session.messages.length, workspace: session.workspace }),
    deleteSession: async () => undefined,
    runAgent: async (input) => {
      const runId = input.runId;
      const messageId = 'html-message';
      const prompt = input.messages[input.messages.length - 1]?.content || '';
      if (prompt.includes('工具进度')) {
        const toolCall = { id: 'draft-call', name: 'write_file', displayName: '写入文件', risk: 'write', args: { path: 'src/html.ts', content: 'html' }, status: 'ok', result: '已创建', isError: false, stats: { additions: 1, deletions: 0 } };
        setTimeout(() => {
          if (!agentListener) return;
          agentListener({ type: 'assistant-start', runId, messageId: 'draft-message' });
          for (let index = 0; index < 80; index += 1) {
            setTimeout(() => {
              if (agentListener) agentListener({ type: 'tool-draft', runId, messageId: 'draft-message', name: 'write_file', chars: index * 1000 });
            }, index * 10);
          }
          setTimeout(() => {
            if (!agentListener) return;
            agentListener({ type: 'tool-start', runId, messageId: 'draft-message', callId: 'draft-call', name: 'write_file', displayName: '写入文件', risk: 'write', args: { path: 'src/html.ts', content: 'html' } });
            agentListener({ type: 'tool-end', runId, messageId: 'draft-message', callId: 'draft-call', status: 'ok', result: '已创建', isError: false, stats: { additions: 1, deletions: 0 } });
            agentListener({ type: 'assistant-end', runId, message: { id: 'draft-message', role: 'assistant', content: 'HTML 已创建。', toolCalls: [toolCall], createdAt: Date.now(), model: 'demo-model' } });
            agentListener({ type: 'run-end', runId, status: 'done' });
          }, 1000);
        }, 30);
        return { ok: true };
      }
      const lines = ['<!DOCTYPE html>', '<html><head><title>Large HTML</title></head><body>'];
      for (let i = 0; i < 1600; i += 1) {
        lines.push('  <section class="row-' + i + '"><h2>Section ' + i + '</h2><p>' + '内容'.repeat(20) + '</p></section>');
      }
      lines.push('</body></html>');
      const full = lines.join('\\n');
      const chunkSize = 120;
      let offset = 0;
      const emitChunk = () => {
        if (!agentListener) return;
        if (offset === 0) agentListener({ type: 'assistant-start', runId, messageId });
        const chunk = full.slice(offset, offset + chunkSize);
        offset += chunkSize;
        if (chunk) {
          agentListener({ type: 'text-delta', runId, messageId, delta: chunk });
          setTimeout(emitChunk, 1);
        } else {
          agentListener({ type: 'assistant-end', runId, message: { id: messageId, role: 'assistant', content: full, createdAt: Date.now(), model: 'demo-model' } });
          agentListener({ type: 'run-end', runId, status: 'done' });
        }
      };
      setTimeout(emitChunk, 30);
      return { ok: true };
    },
    compactConversation: async () => ({ ok: true, summary: 'ok' }),
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
  const started = Date.now()
  await page.locator('#composer-input').fill('写一个很大的 HTML 页面')
  await page.locator('#composer-input').press('Enter')
  await page.waitForFunction(
    () => {
      const input = document.querySelector('#composer-input')
      const state = document.querySelector('.run-state')
      const body = document.body.innerText
      return Boolean(
        input &&
          !input.disabled &&
          state &&
          state.textContent.includes('准备就绪') &&
          body.includes('展开全文')
      )
    },
    { timeout: 20_000 }
  )
  const elapsed = Date.now() - started
  if (elapsed > 15_000) throw new Error(`large HTML stream took ${elapsed}ms`)
  await page.locator('#composer-input').fill('仍然可交互')
  await page.screenshot({ path: 'shots/large-html-stream.png' })

  await page.locator('#composer-input').fill('工具进度测试')
  await page.locator('#composer-input').press('Enter')
  await page.waitForTimeout(450)
  if (!(await page.locator('.step-tool-draft').isVisible())) {
    throw new Error('tool argument progress indicator missing')
  }
  const progressText = await page.locator('.step-tool-draft').innerText()
  if (!progressText.includes('正在生成') || !progressText.includes('字符')) {
    throw new Error('tool argument progress text missing')
  }
  await page.screenshot({ path: 'shots/tool-argument-progress.png' })
  await page.waitForFunction(() => document.body.innerText.includes('src/html.ts'), { timeout: 10_000 })
  console.log(`large HTML UI passed in ${elapsed}ms; tool progress passed`)
  await browser.close()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
