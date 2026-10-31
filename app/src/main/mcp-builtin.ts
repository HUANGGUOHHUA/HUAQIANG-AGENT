import { spawn } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import { toolTempEnv } from './child-env'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js'

interface BuiltinMcpOptions {
  workspace: () => string
  pythonPath: () => string
  version: string
}

interface BuiltinCallResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function result(text: string, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: text.slice(0, 300_000) }],
    ...(isError ? { isError: true } : {})
  } as CallToolResult
}

const TOOL_DEFINITIONS = [
  {
    name: 'python_run',
    description:
      'Run Python code with 华强以太 portable Python in the workspace. Use for data processing, Office files and image tasks. Prefer this over global Python.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python source code executed with python - (stdin).' },
        timeoutMs: { type: 'number', description: 'Timeout in milliseconds, default 120000.' }
      },
      required: ['code'],
      additionalProperties: false
    }
  },
  {
    name: 'create_excel',
    description: 'Create an .xlsx workbook in the workspace from sheet data using openpyxl.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative .xlsx path.' },
        sheets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              rows: { type: 'array', items: { type: 'array', items: {} } }
            },
            required: ['name', 'rows'],
            additionalProperties: false
          }
        }
      },
      required: ['path', 'sheets'],
      additionalProperties: false
    }
  },
  {
    name: 'create_word',
    description: 'Create a .docx document in the workspace using python-docx.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        title: { type: 'string' },
        paragraphs: { type: 'array', items: { type: 'string' } }
      },
      required: ['path', 'paragraphs'],
      additionalProperties: false
    }
  },
  {
    name: 'create_ppt',
    description: 'Create a .pptx presentation in the workspace using python-pptx.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        title: { type: 'string' },
        slides: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              bullets: { type: 'array', items: { type: 'string' } }
            },
            required: ['title'],
            additionalProperties: false
          }
        }
      },
      required: ['path', 'slides'],
      additionalProperties: false
    }
  },
  {
    name: 'create_pdf',
    description: 'Create a PDF in the workspace with reportlab.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        title: { type: 'string' },
        paragraphs: { type: 'array', items: { type: 'string' } }
      },
      required: ['path', 'paragraphs'],
      additionalProperties: false
    }
  },
  {
    name: 'extract_pdf',
    description: 'Extract text from a PDF in the workspace with pdfplumber.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: 'web_search',
    description:
      'Search the web (Bing, DuckDuckGo fallback) and return the top results (title, URL, snippet). Use for finding up-to-date information online.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords, e.g. "electron webview tutorial".' }
      },
      required: ['query'],
      additionalProperties: false
    }
  }
]

const INSTRUCTIONS = [
  '华强以太内置 MCP 服务，提供便携 Python 与办公文档能力。',
  '所有文件路径都必须相对于当前工作区；服务会拒绝工作区外的路径。',
  '处理 Excel/Word/PPT/PDF/图片时优先使用这里的工具，而不是临时手写 PowerShell。',
  'python_run 使用随程序携带的 Python，已安装 openpyxl、python-docx、python-pptx、pypdf、reportlab、pandas、numpy、matplotlib、Pillow、requests、beautifulsoup4、XlsxWriter、pdfplumber。',
  '生成文件后请检查返回的 stdout/stderr，必要时再用文件工具验证。'
].join('\n')

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

interface SearchResultItem {
  title: string
  url: string
  snippet: string
}

async function webSearch(query: string): Promise<SearchResultItem[]> {
  try {
    const items = await searchBing(query)
    if (items.length) return items
  } catch {
    // Fall through to DuckDuckGo.
  }
  return searchDuckDuckGo(query)
}

const SEARCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
} as const

async function searchBing(query: string): Promise<SearchResultItem[]> {
  const response = await fetch(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&count=10`,
    { signal: AbortSignal.timeout(15_000), headers: SEARCH_HEADERS }
  )
  if (!response.ok) throw new Error(`必应搜索返回 HTTP ${response.status}`)
  const html = await response.text()
  const items: SearchResultItem[] = []
  const blocks = html.split(/<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>/i).slice(1)
  for (const block of blocks) {
    if (items.length >= 8) break
    const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!linkMatch) continue
    const url = decodeHtmlEntities(linkMatch[1])
    const title = stripTags(linkMatch[2])
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).slice(0, 300) : ''
    if (title && /^https?:\/\//i.test(url)) items.push({ title, url, snippet })
  }
  return items
}

async function searchDuckDuckGo(query: string): Promise<SearchResultItem[]> {
  const response = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { signal: AbortSignal.timeout(15_000), headers: SEARCH_HEADERS }
  )
  if (!response.ok) throw new Error(`搜索服务返回 HTTP ${response.status}`)
  const html = await response.text()
  const items: SearchResultItem[] = []
  const blocks = html.split(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*>/i).slice(1)
  const anchors = html.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*>/gi) ?? []
  for (let index = 0; index < blocks.length && items.length < 8; index += 1) {
    const anchor = anchors[index] ?? ''
    const hrefMatch = anchor.match(/href="([^"]*)"/i)
    let url = hrefMatch ? decodeHtmlEntities(hrefMatch[1]) : ''
    const uddg = url.match(/[?&]uddg=([^&]+)/)
    if (uddg) {
      try {
        url = decodeURIComponent(uddg[1])
      } catch {
        url = uddg[1]
      }
    }
    const block = blocks[index]
    const title = stripTags(block.slice(0, block.indexOf('</a>')))
    const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).slice(0, 300) : ''
    if (title && url) items.push({ title, url, snippet })
  }
  return items
}

function safeWorkspacePath(root: string, input: unknown): string {
  const relativePath = typeof input === 'string' ? input.trim() : ''
  if (!relativePath) throw new Error('path 不能为空')
  const base = resolve(root)
  const target = resolve(base, relativePath)
  const baseLower = base.toLowerCase()
  const targetLower = target.toLowerCase()
  if (targetLower !== baseLower && !targetLower.startsWith(baseLower + sep)) {
    throw new Error('路径必须位于工作区内')
  }
  return target
}

function pythonSource(payload: unknown, body: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  return [
    'import base64, json',
    `payload = json.loads(base64.b64decode(${JSON.stringify(encoded)}).decode('utf-8'))`,
    body
  ].join('\n')
}

function runPython(
  pythonPath: string,
  cwd: string,
  code: string,
  timeoutMs = 120_000
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolvePromise, reject) => {
    if (!pythonPath) {
      reject(new Error('便携 Python 解释器尚未就绪'))
      return
    }
    const child = spawn(pythonPath, ['-'], {
      cwd,
      windowsHide: true,
      env: { ...toolTempEnv(), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolvePromise({ stdout, stderr, code: exitCode })
    }
    let exitCode = -1
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error(`Python 执行超过 ${Math.round(timeoutMs / 1000)} 秒`))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString('utf8')}`.slice(-400_000)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-200_000)
    })
    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      exitCode = code ?? -1
      finish()
    })
    child.stdin.on('error', () => {})
    child.stdin.end(code, 'utf8')
  })
}

export class BuiltinMcpService {
  private readonly options: BuiltinMcpOptions
  private server: Server | null = null
  private clientTransport: Transport | null = null
  private serverTransport: Transport | null = null

  constructor(options: BuiltinMcpOptions) {
    this.options = options
  }

  async start(): Promise<Transport> {
    const server = new Server(
      { name: 'huaqiang-builtin', version: this.options.version },
      {
        capabilities: { tools: {}, resources: {}, prompts: {} },
        instructions: INSTRUCTIONS
      }
    )
    this.server = server
    this.registerHandlers(server)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    this.clientTransport = clientTransport
    this.serverTransport = serverTransport
    await server.connect(serverTransport)
    return clientTransport
  }

  async close(): Promise<void> {
    await this.server?.close().catch(() => undefined)
    await this.clientTransport?.close().catch(() => undefined)
    await this.serverTransport?.close().catch(() => undefined)
  }

  private registerHandlers(server: Server): void {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }))

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const name = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, unknown>
      try {
        const root = this.options.workspace()
        const python = this.options.pythonPath()
        if (name === 'python_run') {
          const code = typeof args.code === 'string' ? args.code : ''
          if (!code.trim()) return result('code 不能为空', true)
          const timeout = Number(args.timeoutMs) || 120_000
          const output = await runPython(python, root, code, Math.min(timeout, 300_000))
          return result(
            [
              output.stdout.trim() ? `stdout:\n${output.stdout.trim()}` : '',
              output.stderr.trim() ? `stderr:\n${output.stderr.trim()}` : '',
              `exit code: ${output.code}`
            ]
              .filter(Boolean)
              .join('\n\n'),
            output.code !== 0
          )
        }

        if (name === 'create_excel') {
          const path = safeWorkspacePath(root, args.path)
          const sheets = Array.isArray(args.sheets) ? args.sheets : []
          const code = pythonSource({ path, sheets }, [
            'import openpyxl',
            'wb = openpyxl.Workbook()',
            'wb.remove(wb.active)',
            'for sheet in payload["sheets"]:',
            '    ws = wb.create_sheet(str(sheet.get("name") or "Sheet"))',
            '    for row in sheet.get("rows") or []:',
            '        ws.append(list(row) if isinstance(row, list) else [row])',
            'wb.save(payload["path"])',
            'print("created", payload["path"], len(wb.sheetnames), "sheets")'
          ].join('\n'))
          return this.runGenerated(python, root, code)
        }

        if (name === 'create_word') {
          const path = safeWorkspacePath(root, args.path)
          const title = typeof args.title === 'string' ? args.title : ''
          const paragraphs = Array.isArray(args.paragraphs) ? args.paragraphs : []
          const code = pythonSource({ path, title, paragraphs }, [
            'from docx import Document',
            'doc = Document()',
            'if payload["title"]: doc.add_heading(payload["title"], level=1)',
            'for text in payload["paragraphs"]: doc.add_paragraph(str(text))',
            'doc.save(payload["path"])',
            'print("created", payload["path"])'
          ].join('\n'))
          return this.runGenerated(python, root, code)
        }

        if (name === 'create_ppt') {
          const path = safeWorkspacePath(root, args.path)
          const title = typeof args.title === 'string' ? args.title : ''
          const slides = Array.isArray(args.slides) ? args.slides : []
          const code = pythonSource({ path, title, slides }, [
            'from pptx import Presentation',
            'prs = Presentation()',
            'if payload["title"]:',
            '    slide = prs.slides.add_slide(prs.slide_layouts[0])',
            '    slide.shapes.title.text = payload["title"]',
            'for item in payload["slides"]:',
            '    slide = prs.slides.add_slide(prs.slide_layouts[1])',
            '    slide.shapes.title.text = str(item.get("title") or "")',
            '    body = slide.placeholders[1].text_frame',
            '    body.clear()',
            '    for index, bullet in enumerate(item.get("bullets") or []):',
            '        paragraph = body.paragraphs[0] if index == 0 else body.add_paragraph()',
            '        paragraph.text = str(bullet)',
            'prs.save(payload["path"])',
            'print("created", payload["path"], len(prs.slides), "slides")'
          ].join('\n'))
          return this.runGenerated(python, root, code)
        }

        if (name === 'create_pdf') {
          const path = safeWorkspacePath(root, args.path)
          const title = typeof args.title === 'string' ? args.title : ''
          const paragraphs = Array.isArray(args.paragraphs) ? args.paragraphs : []
          const code = pythonSource({ path, title, paragraphs }, [
            'from reportlab.lib.styles import getSampleStyleSheet',
            'from reportlab.lib.enums import TA_LEFT',
            'from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer',
            'styles = getSampleStyleSheet()',
            'story = []',
            'if payload["title"]:',
            '    story.append(Paragraph(payload["title"], styles["Title"]))',
            '    story.append(Spacer(1, 12))',
            'for text in payload["paragraphs"]:',
            '    story.append(Paragraph(str(text), styles["BodyText"]))',
            '    story.append(Spacer(1, 6))',
            'SimpleDocTemplate(payload["path"]).build(story)',
            'print("created", payload["path"])'
          ].join('\n'))
          return this.runGenerated(python, root, code)
        }

        if (name === 'extract_pdf') {
          const path = safeWorkspacePath(root, args.path)
          const code = pythonSource({ path }, [
            'import pdfplumber',
            'with pdfplumber.open(payload["path"]) as pdf:',
            '    text = "\\n\\n".join((page.extract_text() or "") for page in pdf.pages)',
            'print(text[:300000])'
          ].join('\n'))
          return this.runGenerated(python, root, code)
        }

        if (name === 'inspect_image') {
          const path = safeWorkspacePath(root, args.path)
          const code = pythonSource({ path }, [
            'from PIL import Image',
            'with Image.open(payload["path"]) as image:',
            '    print({"format": image.format, "mode": image.mode, "size": list(image.size)})'
          ].join('\n'))
          return this.runGenerated(python, root, code)
        }

        if (name === 'web_search') {
          const query = typeof args.query === 'string' ? args.query.trim() : ''
          if (!query) return result('query 不能为空', true)
          try {
            const items = await webSearch(query.slice(0, 500))
            if (items.length === 0) return result(`没有找到与「${query}」相关的结果`)
            const lines = items.map(
              (item, index) =>
                `${index + 1}. ${item.title}\n   ${item.url}${item.snippet ? `\n   ${item.snippet}` : ''}`
            )
            return result(`搜索「${query}」的前 ${items.length} 条结果：\n\n${lines.join('\n\n')}`)
          } catch (error) {
            return result(
              `网络搜索失败：${error instanceof Error ? error.message : String(error)}`,
              true
            )
          }
        }

        return result(`未知工具：${name}`, true)
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), true)
      }
    })

    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'huaqiang://workspace',
          name: '当前工作区',
          description: '工作区根目录与第一层文件列表',
          mimeType: 'text/plain'
        },
        {
          uri: 'huaqiang://python',
          name: '便携 Python 环境',
          description: '内置 Python 解释器和已安装库',
          mimeType: 'text/plain'
        }
      ]
    }))

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri
      if (uri === 'huaqiang://workspace') {
        const root = this.options.workspace()
        const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
        const lines = await Promise.all(
          entries.slice(0, 200).map(async (entry) => {
            const full = resolve(root, entry.name)
            if (entry.isDirectory()) return `[dir] ${entry.name}/`
            const info = await stat(full).catch(() => null)
            return `[file] ${entry.name} ${info ? `${info.size} bytes` : ''}`
          })
        )
        return {
          contents: [
            {
              uri,
              mimeType: 'text/plain',
              text: [`工作区：${root}`, `文件：${basename(root)}`, ...lines].join('\n')
            }
          ]
        }
      }
      if (uri === 'huaqiang://python') {
        const python = this.options.pythonPath()
        return {
          contents: [
            {
              uri,
              mimeType: 'text/plain',
              text: python
                ? `解释器：${python}\n模块：openpyxl, docx, pptx, pypdf, reportlab, pandas, numpy, matplotlib, PIL, requests, bs4, xlsxwriter, pdfplumber`
                : '便携 Python 尚未就绪'
            }
          ]
        }
      }
      throw new Error(`未知资源：${uri}`)
    })

    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        {
          name: 'office_report',
          description: '根据主题生成 Word/Excel/PDF 办公文档的任务提示',
          arguments: [{ name: 'topic', description: '报告主题', required: true }]
        },
        {
          name: 'data_clean',
          description: '清洗表格数据并输出统计结果',
          arguments: [{ name: 'file', description: '工作区内的表格路径', required: true }]
        }
      ]
    }))

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const topic = String(request.params.arguments?.topic ?? '未指定主题')
      const file = String(request.params.arguments?.file ?? '未指定文件')
      if (request.params.name === 'office_report') {
        return {
          description: `办公报告：${topic}`,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `请围绕「${topic}」生成一份完整办公报告。先在工作区创建结构化内容，然后使用内置 MCP 的 create_word、create_excel 或 create_pdf 工具生成实际文件；最后检查文件并汇报路径。`
              }
            }
          ]
        }
      }
      if (request.params.name === 'data_clean') {
        return {
          description: `数据清洗：${file}`,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `请读取工作区内的「${file}」，用内置 MCP 的 python_run 做数据清洗和统计，输出清洗后的文件与关键结论，并说明缺失值和异常值。`
              }
            }
          ]
        }
      }
      throw new Error(`未知提示模板：${request.params.name}`)
    })
  }

  private async runGenerated(pythonPath: string, cwd: string, code: string): Promise<CallToolResult> {
    const output = await runPython(pythonPath, cwd, code, 120_000)
    const text = [
      output.stdout.trim() ? `stdout:\n${output.stdout.trim()}` : '',
      output.stderr.trim() ? `stderr:\n${output.stderr.trim()}` : '',
      `exit code: ${output.code}`
    ]
      .filter(Boolean)
      .join('\n\n')
    return result(text, output.code !== 0)
  }
}

export const BUILTIN_MCP_INSTRUCTIONS = INSTRUCTIONS
