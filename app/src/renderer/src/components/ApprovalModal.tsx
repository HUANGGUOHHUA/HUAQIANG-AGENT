import { useEffect } from 'react'
import {
  AlertTriangle,
  Ban,
  Check,
  FilePenLine,
  Globe2,
  Plug,
  ShieldQuestion,
  Terminal,
  Trash2
} from 'lucide-react'
import type { ApprovalDecision, ApprovalRequest, ToolRisk } from '../../../shared/types'
import { cn, parseJson, stringValue } from '../lib/utils'

const RISK_LABEL: Record<ToolRisk, string> = {
  read: '只读',
  write: '写入文件',
  exec: '执行命令',
  network: '访问网络',
  mcp: 'MCP 工具'
}

function RiskIcon({ risk }: { risk: ToolRisk }): React.JSX.Element {
  if (risk === 'exec') return <Terminal size={18} />
  if (risk === 'write') return <FilePenLine size={18} />
  if (risk === 'network') return <Globe2 size={18} />
  if (risk === 'mcp') return <Plug size={18} />
  return <ShieldQuestion size={18} />
}

function Detail({ request, args }: { request: ApprovalRequest; args: Record<string, unknown> | null }): React.JSX.Element {
  if (!args) {
    return <pre className="approval-json">{request.preview}</pre>
  }
  if (request.toolName === 'run_command') {
    return (
      <div className="approval-terminal-wrap">
        <div className="approval-terminal-head">
          <span className="terminal-dots">
            <i />
            <i />
            <i />
          </span>
          <span>PowerShell</span>
          {!!stringValue(args.cwd) && <span className="terminal-cwd">{stringValue(args.cwd)}</span>}
        </div>
        <pre className="approval-terminal">
          <span className="prompt-symbol">PS&gt;</span> {stringValue(args.command)}
        </pre>
      </div>
    )
  }
  if (request.toolName === 'write_file') {
    const content = stringValue(args.content)
    return (
      <div className="approval-file">
        <div className="approval-file-path">{stringValue(args.path)}</div>
        <pre className="approval-file-content">
          {content.slice(0, 4000)}
          {content.length > 4000 ? '\n…（内容较长，仅展示前 4000 字符）' : ''}
        </pre>
        <div className="approval-file-meta">{content.length.toLocaleString()} 字符</div>
      </div>
    )
  }
  if (request.toolName === 'edit_file') {
    return (
      <div className="approval-file">
        <div className="approval-file-path">{stringValue(args.path)}</div>
        <div className="approval-diff">
          <div className="diff-old">
            <span>原始内容</span>
            <pre>{stringValue(args.old_string).slice(0, 1800)}</pre>
          </div>
          <div className="diff-new">
            <span>替换为</span>
            <pre>{stringValue(args.new_string).slice(0, 1800)}</pre>
          </div>
        </div>
      </div>
    )
  }
  if (request.toolName === 'delete_path') {
    return (
      <div className="approval-danger">
        <AlertTriangle size={15} />
        <div>
          <strong>此操作不可恢复</strong>
          <p>将删除工作区内的路径：{stringValue(args.path)}</p>
        </div>
      </div>
    )
  }
  if (request.toolName === 'web_fetch') {
    return <div className="approval-url">{stringValue(args.url)}</div>
  }
  return <pre className="approval-json">{JSON.stringify(args, null, 2).slice(0, 8000)}</pre>
}

export default function ApprovalModal({
  request,
  onDecision
}: {
  request: ApprovalRequest
  onDecision: (decision: ApprovalDecision) => void
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDecision('deny')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDecision])

  const args = parseJson(request.preview)
  const danger = request.toolName === 'delete_path' || request.risk === 'exec'
  const alwaysLabel =
    request.risk === 'exec'
      ? '本会话始终允许执行命令'
      : request.risk === 'write'
        ? '本会话始终允许文件写入'
        : request.risk === 'network'
          ? '本会话始终允许访问网络'
          : '本会话始终允许此 MCP 工具'

  return (
    <div className="modal-backdrop approval-backdrop">
      <div className={cn('approval-modal', danger && 'danger')} role="dialog" aria-modal="true">
        <div className="approval-top">
          <span className={cn('approval-risk-icon', request.risk)}>
            <RiskIcon risk={request.risk} />
          </span>
          <div className="approval-heading">
            <span className="approval-kicker">需要你的确认</span>
            <h2>{request.displayName}</h2>
          </div>
          <span className={cn('approval-risk-badge', request.risk)}>{RISK_LABEL[request.risk]}</span>
        </div>

        <p className="approval-summary">{request.summary}</p>

        <Detail request={request} args={args} />

        <div className="approval-note">
          <Ban size={14} />
          只有你确认后，Agent 才会执行这一步。拒绝后它会收到通知并尝试其他方案。
        </div>

        <div className="approval-actions">
          <button type="button" className="btn ghost" onClick={() => onDecision('deny')}>
            <Ban size={14} /> 拒绝
          </button>
          <div className="approval-actions-right">
            <button
              type="button"
              className="btn secondary small"
              onClick={() => onDecision('always')}
              title={alwaysLabel}
            >
              本会话始终允许
            </button>
            <button type="button" className="btn primary" onClick={() => onDecision('allow')}>
              <Check size={15} /> 仅本次允许
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
