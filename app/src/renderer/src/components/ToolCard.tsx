import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  CircleSlash,
  Cpu,
  FilePenLine,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderPlus,
  Globe2,
  LoaderCircle,
  MoveRight,
  PlugZap,
  Search,
  Terminal,
  Trash2
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ToolCallView } from '../../../shared/types'
import { cn, stringValue } from '../lib/utils'

interface ToolMeta {
  icon: LucideIcon
  label: string
  tone: string
}

const TOOL_META: Record<string, ToolMeta> = {
  list_files: { icon: FolderOpen, label: '浏览目录', tone: 'blue' },
  read_file: { icon: FileText, label: '读取文件', tone: 'blue' },
  write_file: { icon: FilePlus2, label: '写入文件', tone: 'gold' },
  edit_file: { icon: FilePenLine, label: '编辑文件', tone: 'gold' },
  create_directory: { icon: FolderPlus, label: '新建目录', tone: 'gold' },
  delete_path: { icon: Trash2, label: '删除路径', tone: 'red' },
  move_file: { icon: MoveRight, label: '移动文件', tone: 'gold' },
  search_files: { icon: Search, label: '搜索代码', tone: 'blue' },
  run_command: { icon: Terminal, label: '运行命令', tone: 'ink' },
  get_system_info: { icon: Cpu, label: '系统信息', tone: 'blue' },
  web_fetch: { icon: Globe2, label: '访问网页', tone: 'teal' }
}

function metaFor(call: ToolCallView): ToolMeta {
  if (call.risk === 'mcp' || call.name.startsWith('mcp')) {
    return { icon: PlugZap, label: 'MCP 工具', tone: 'purple' }
  }
  return TOOL_META[call.name] ?? { icon: PlugZap, label: call.displayName ?? call.name, tone: 'blue' }
}

function summarize(call: ToolCallView): string {
  const args = call.args ?? {}
  switch (call.name) {
    case 'run_command':
      return stringValue(args.command).replace(/\s+/g, ' ').slice(0, 180)
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'create_directory':
    case 'delete_path':
      return stringValue(args.path)
    case 'list_files':
      return stringValue(args.path) || '.'
    case 'search_files':
      return `${stringValue(args.query)}${args.glob ? `  ·  ${stringValue(args.glob)}` : ''}`
    case 'web_fetch':
      return stringValue(args.url)
    case 'move_file':
      return `${stringValue(args.source)} → ${stringValue(args.destination)}`
    case 'get_system_info':
      return '读取本机环境信息'
    default: {
      const serialized = JSON.stringify(args)
      return serialized === '{}' ? call.displayName ?? call.name : serialized.slice(0, 180)
    }
  }
}

function StatusPill({ call }: { call: ToolCallView }): React.JSX.Element {
  if (call.status === 'running') {
    return (
      <span className="tool-status running">
        <LoaderCircle size={12} className="spin" /> 执行中
      </span>
    )
  }
  if (call.status === 'ok') {
    return (
      <span className="tool-status ok">
        <Check size={12} /> 完成
      </span>
    )
  }
  if (call.status === 'denied') {
    return (
      <span className="tool-status denied">
        <Ban size={12} /> 已拒绝
      </span>
    )
  }
  if (call.status === 'cancelled') {
    return (
      <span className="tool-status cancelled">
        <CircleSlash size={12} /> 已中止
      </span>
    )
  }
  return (
    <span className="tool-status error">
      <AlertTriangle size={12} /> 失败
    </span>
  )
}

export default function ToolCard({
  call,
  compact = false
}: {
  call: ToolCallView
  compact?: boolean
}): React.JSX.Element {
  const meta = metaFor(call)
  const Icon = meta.icon
  const [expanded, setExpanded] = useState<boolean>(
    call.status === 'running' || call.status === 'error' || call.status === 'denied'
  )

  useEffect(() => {
    if (call.status === 'running') setExpanded(true)
    if (call.status === 'error' || call.status === 'denied') setExpanded(true)
  }, [call.status])

  const summary = summarize(call)
  const argsForDisplay = useMemo(() => {
    const args = { ...(call.args ?? {}) }
    for (const key of ['content', 'old_string', 'new_string']) {
      const value = args[key]
      if (typeof value === 'string' && value.length > 4_000) {
        args[key] = `${value.slice(0, 4_000)}\n…（参数较长，已截断显示）`
      }
    }
    return args
  }, [call.args])
  const output = useMemo(() => {
    const raw = call.result ?? ''
    if (raw.length <= 16_000) return raw
    return `${raw.slice(0, 16_000)}\n…（预览已截断，完整结果已交给模型）`
  }, [call.result])
  const hasDetails = summary || output || Object.keys(call.args ?? {}).length > 0
  const elapsed =
    call.startedAt && call.endedAt ? Math.max(0, Math.round((call.endedAt - call.startedAt) / 100) / 10) : null

  return (
    <div
      className={cn(
        'tool-card',
        compact && 'is-compact',
        `tone-${meta.tone}`,
        expanded && 'expanded'
      )}
    >
      <button
        type="button"
        className="tool-card-head"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className={cn('tool-icon', `tone-${meta.tone}`)}>
          <Icon size={15} strokeWidth={1.9} />
        </span>
        <span className="tool-heading">
          <span className="tool-title-row">
            <span className="tool-name">{call.displayName ?? meta.label}</span>
            <StatusPill call={call} />
            {call.stats && (call.stats.additions > 0 || call.stats.deletions > 0) && (
              <span className="tool-stats">
                {call.stats.additions > 0 && <span className="add">+{call.stats.additions}</span>}
                {call.stats.deletions > 0 && <span className="del">-{call.stats.deletions}</span>}
              </span>
            )}
            {elapsed !== null && <span className="tool-elapsed">{elapsed}s</span>}
          </span>
          {summary && <span className="tool-summary">{summary}</span>}
        </span>
        {hasDetails && (
          <ChevronDown size={15} className={cn('tool-chevron', expanded && 'open')} />
        )}
      </button>

      {expanded && (
        <div className="tool-card-body">
          {call.name === 'run_command' && stringValue(call.args.cwd) && (
            <div className="tool-path">工作目录 · {stringValue(call.args.cwd)}</div>
          )}
          {call.name === 'run_command' && (
            <pre className="tool-command">
              <span className="prompt-symbol">PS&gt;</span> {stringValue(call.args.command)}
            </pre>
          )}
          {output ? (
            <pre className={cn('tool-output', call.isError && 'is-error')}>{output}</pre>
          ) : call.status === 'running' ? (
            <div className="tool-waiting">
              <LoaderCircle size={13} className="spin" /> 等待工具返回…
            </div>
          ) : (
            <div className="tool-waiting muted">没有可显示的输出</div>
          )}
          {call.name !== 'run_command' && Object.keys(call.args ?? {}).length > 0 && (
            <details className="tool-args">
              <summary>查看参数</summary>
              <pre>{JSON.stringify(argsForDisplay, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
