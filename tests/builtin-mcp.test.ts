import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { BuiltinMcpService } from '../app/src/main/mcp-builtin'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

describe('built-in MCP service', () => {
  it('exposes office tools, resources and prompts through MCP', async () => {
    const tempRoot = join(process.cwd(), 'tmp')
    await mkdir(tempRoot, { recursive: true })
    const workspace = await mkdtemp(join(tempRoot, 'hq-builtin-mcp-'))
    cleanups.push(() => rm(workspace, { recursive: true, force: true }))
    const python = join(process.cwd(), 'runtime', 'python', 'python.exe')
    expect(existsSync(python)).toBe(true)
    const service = new BuiltinMcpService({
      workspace: () => workspace,
      pythonPath: () => python,
      version: '1.0.0'
    })
    const transport = await service.start()
    const client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} })
    await client.connect(transport)
    cleanups.push(async () => {
      await client.close()
      await service.close()
    })

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['python_run', 'create_excel', 'create_word', 'create_pdf', 'web_search'])
    )
    const prompts = await client.listPrompts()
    expect(prompts.prompts.map((prompt) => prompt.name)).toContain('office_report')
    const resources = await client.listResources()
    expect(resources.resources.map((resource) => resource.uri)).toContain('huaqiang://python')
    expect(client.getInstructions()).toContain('华强以太内置 MCP 服务')

    const pythonResult = await client.callTool({
      name: 'python_run',
      arguments: { code: 'print("builtin-python-ok")' }
    })
    expect(JSON.stringify(pythonResult)).toContain('builtin-python-ok')

    const excel = await client.callTool({
      name: 'create_excel',
      arguments: {
        path: '报告.xlsx',
        sheets: [{ name: '数据', rows: [['姓名', '分数'], ['小明', 95]] }]
      }
    })
    expect(JSON.stringify(excel)).toContain('exit code: 0')
    const bytes = await readFile(join(workspace, '报告.xlsx'))
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK')
  }, 120_000)
})
