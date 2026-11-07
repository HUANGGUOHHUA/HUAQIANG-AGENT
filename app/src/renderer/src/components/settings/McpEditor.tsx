import { useState } from 'react'
import { ChevronRight, LoaderCircle, Trash2, Zap } from 'lucide-react'
import type { McpServerConfig, McpStatus, McpTestResult } from '../../../../shared/types'
import { cn, stripIpcError } from '../../lib/utils'
import { parsePairs, pairsText } from '../../lib/settings-form'

function McpEditor({
  config,
  status,
  onChange,
  onRemove
}: {
  config: McpServerConfig
  status?: McpStatus
  onChange: (next: McpServerConfig) => void
  onRemove: () => void
}): React.JSX.Element {
  const [argsText, setArgsText] = useState(config.args.join('\n'))
  const [envText, setEnvText] = useState(pairsText(config.env))
  const [headersText, setHeadersText] = useState(pairsText(config.headers))
  const [expanded, setExpanded] = useState(true)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<McpTestResult | null>(null)

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await window.hq.mcpTest(config))
    } catch (error) {
      setTestResult({ ok: false, message: stripIpcError(String(error)) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className={cn('mcp-editor', !config.enabled && 'disabled')}>
      <div className="mcp-editor-head">
        <button
          type="button"
          className={cn('mini-switch', config.enabled && 'on')}
          onClick={() => onChange({ ...config, enabled: !config.enabled })}
          role="switch"
          aria-checked={config.enabled}
          title={config.enabled ? '已启用' : '已停用'}
        >
          <span />
        </button>
        <input
          className="mcp-name-input"
          value={config.name}
          onChange={(event) => onChange({ ...config, name: event.target.value })}
          placeholder="MCP 服务名称"
        />
        <span className={cn('mcp-editor-state', status?.state ?? 'disconnected')}>
          {status?.state === 'connected' ? `${status.tools.length} 个工具` : status?.state === 'error' ? '连接失败' : config.enabled ? '待连接' : '已停用'}
        </span>
        <button type="button" className="icon-btn tiny" onClick={() => setExpanded((v) => !v)}>
          <ChevronRight size={14} className={cn('rotate-icon', expanded && 'open')} />
        </button>
        <button type="button" className="icon-btn tiny danger" onClick={onRemove} title="删除">
          <Trash2 size={14} />
        </button>
      </div>

      {expanded && (
        <div className="mcp-editor-body">
          <div className="form-row two">
            <label className="field">
              <span>传输方式</span>
              <select
                value={config.transport}
                onChange={(event) =>
                  onChange({ ...config, transport: event.target.value as 'stdio' | 'http' })
                }
              >
                <option value="stdio">stdio · 本地进程</option>
                <option value="http">HTTP · Streamable HTTP</option>
              </select>
            </label>
            <label className="field">
              <span>启动命令或 URL</span>
              {config.transport === 'stdio' ? (
                <input
                  value={config.command}
                  onChange={(event) => onChange({ ...config, command: event.target.value })}
                  placeholder="例如 npx"
                />
              ) : (
                <input
                  value={config.url}
                  onChange={(event) => onChange({ ...config, url: event.target.value })}
                  placeholder="https://example.com/mcp"
                />
              )}
            </label>
          </div>

          {config.transport === 'stdio' ? (
            <div className="form-row two align-start">
              <label className="field">
                <span>启动参数 · 每行一个</span>
                <textarea
                  rows={4}
                  value={argsText}
                  onChange={(event) => {
                    setArgsText(event.target.value)
                    onChange({
                      ...config,
                      args: event.target.value
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .filter(Boolean)
                    })
                  }}
                  placeholder={'-y\n@modelcontextprotocol/server-filesystem\nD:\\我的项目'}
                />
              </label>
              <label className="field">
                <span>环境变量 · KEY=VALUE</span>
                <textarea
                  rows={4}
                  value={envText}
                  onChange={(event) => {
                    setEnvText(event.target.value)
                    onChange({ ...config, env: parsePairs(event.target.value) })
                  }}
                  placeholder={'API_KEY=...\n# 每行一个 KEY=VALUE'}
                />
              </label>
            </div>
          ) : (
            <label className="field">
              <span>请求头 · KEY=VALUE</span>
              <textarea
                rows={3}
                value={headersText}
                onChange={(event) => {
                  setHeadersText(event.target.value)
                  onChange({ ...config, headers: parsePairs(event.target.value) })
                }}
                placeholder="Authorization=Bearer ..."
              />
            </label>
          )}

          <div className="mcp-editor-foot">
            <button type="button" className="btn ghost small" onClick={() => void runTest()} disabled={testing}>
              {testing ? <LoaderCircle size={13} className="spin" /> : <Zap size={13} />}
              测试连接
            </button>
            {testResult && (
              <span className={cn('inline-test', testResult.ok ? 'ok' : 'error')}>
                {testResult.message}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default McpEditor
