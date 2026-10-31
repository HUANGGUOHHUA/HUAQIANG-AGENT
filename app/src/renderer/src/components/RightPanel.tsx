import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import hljs from 'highlight.js/lib/common'
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileCode2,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  LoaderCircle,
  Pencil,
  Plug,
  RefreshCw,
  Save,
  Server,
  Settings2,
  ShieldCheck,
  X
} from 'lucide-react'
import type {
  FileContent,
  FileEntry,
  McpServerConfig,
  McpStatus,
  UiSettings
} from '../../../shared/types'
import { baseName, cn, formatBytes, isImagePath } from '../lib/utils'
import Markdown from './Markdown'
import BrowserPane from './BrowserPane'

interface RightPanelProps {
  settings: UiSettings
  statuses: McpStatus[]
  fileRequest?: { path: string; nonce: number } | null
  tabSignal?: { tab: 'files' | 'mcp' | 'web'; nonce: number } | null
  hidden?: boolean
  onClose: () => void
  onOpenSettings: (tab: 'model' | 'mcp' | 'workspace' | 'about') => void
  onRefreshMcp: () => void
  onNotify?: (type: 'success' | 'error' | 'info', message: string) => void
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  xml: 'xml',
  vue: 'xml',
  svelte: 'xml',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  sh: 'bash',
  bash: 'bash',
  ps1: 'powershell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  php: 'php',
  rb: 'ruby',
  lua: 'lua'
}

function languageFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return LANGUAGE_BY_EXT[ext] ?? ''
}

function clampPanelWidth(value: number): number {
  // 预留左侧栏 + 主区的最小空间，右栏再多也不会把布局挤坏
  const sidebar = window.innerWidth <= 1180 ? 252 : 300
  const maxPanel = Math.max(300, Math.min(760, window.innerWidth - sidebar - 420))
  return Math.max(300, Math.min(maxPanel, value))
}

function initialPanelWidth(): number {
  try {
    const saved = Number(localStorage.getItem('hq.rightWidth'))
    if (Number.isFinite(saved) && saved > 0) return clampPanelWidth(saved)
  } catch {
    // Ignore.
  }
  return 312
}

function highlightCode(path: string, content: string): { html: string; language: string } {
  if (content.length > 80_000) {
    return { html: escapeHtml(content), language: 'text' }
  }
  const language = languageFor(path)
  if (language && hljs.getLanguage(language)) {
    return {
      html: hljs.highlight(content, { language, ignoreIllegals: true }).value,
      language
    }
  }
  const automatic = hljs.highlightAuto(content)
  return {
    html: automatic.value,
    language: automatic.language ?? language ?? 'text'
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fileIcon(name: string): React.JSX.Element {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) {
    return <ImageIcon size={14} strokeWidth={1.7} />
  }
  if (['json', 'jsonc'].includes(ext)) return <FileJson2 size={14} strokeWidth={1.7} />
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'css', 'html', 'vue', 'svelte'].includes(ext)) {
    return <FileCode2 size={14} strokeWidth={1.7} />
  }
  return <FileText size={14} strokeWidth={1.7} />
}

function TreeNode({
  entry,
  depth,
  onOpenFile
}: {
  entry: FileEntry
  depth: number
  onOpenFile: (path: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<FileEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const toggle = async (): Promise<void> => {
    if (entry.type !== 'dir') {
      onOpenFile(entry.path)
      return
    }
    if (loading) return
    if (!open && !children) {
      setLoading(true)
      setError('')
      try {
        setChildren(await window.hq.workspaceList(entry.path))
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      } finally {
        setLoading(false)
      }
    }
    setOpen((value) => !value)
  }

  return (
    <div className="tree-node">
      <button
        type="button"
        className={cn('tree-row', entry.type === 'dir' && 'is-dir')}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => void toggle()}
        title={entry.path}
      >
        <span className="tree-chevron">
          {entry.type === 'dir' ? (
            open ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )
          ) : null}
        </span>
        <span className={cn('tree-icon', entry.type === 'dir' ? 'folder' : 'file')}>
          {entry.type === 'dir' ? (
            open ? (
              <FolderOpen size={14} strokeWidth={1.7} />
            ) : (
              <Folder size={14} strokeWidth={1.7} />
            )
          ) : (
            fileIcon(entry.name)
          )}
        </span>
        <span className="tree-name">{entry.name}</span>
        {entry.type === 'file' && entry.size !== undefined && (
          <span className="tree-size">{formatBytes(entry.size)}</span>
        )}
      </button>
      {open && loading && (
        <div className="tree-loading" style={{ paddingLeft: 32 + depth * 14 }}>
          <LoaderCircle size={12} className="spin" /> 加载…
        </div>
      )}
      {open && error && (
        <div className="tree-error" style={{ paddingLeft: 32 + depth * 14 }}>
          <AlertCircle size={12} /> 无法读取
        </div>
      )}
      {open &&
        children?.map((child) => (
          <TreeNode key={child.path} entry={child} depth={depth + 1} onOpenFile={onOpenFile} />
        ))}
    </div>
  )
}

export default function RightPanel({
  settings,
  statuses,
  fileRequest,
  tabSignal,
  hidden,
  onClose,
  onOpenSettings,
  onRefreshMcp,
  onNotify
}: RightPanelProps): React.JSX.Element {
  const [tab, setTab] = useState<'files' | 'mcp' | 'web'>('files')
  const [width, setWidth] = useState(initialPanelWidth)

  // 窗口变窄时按比例收紧侧栏，防止挤压主区
  useEffect(() => {
    const onResize = (): void => setWidth((current) => clampPanelWidth(current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selected, setSelected] = useState<FileContent | null>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const loadRoot = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError('')
    try {
      setEntries(await window.hq.workspaceList('.'))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setSelected(null)
    void loadRoot()
  }, [settings.workspace, loadRoot])

  const openFileRequestRef = useRef(0)

  const openFile = async (path: string): Promise<void> => {
    const requestId = ++openFileRequestRef.current
    setPreviewLoading(true)
    setEditing(false)
    setSaveError('')
    setPreviewImage(null)
    setSelected({ path, content: '', size: 0, binary: false, truncated: false })
    try {
      if (isImagePath(path)) {
        const asset = await window.hq.workspaceReadAsset(path)
        if (requestId !== openFileRequestRef.current) return
        setSelected({ path, content: '', size: asset.size, binary: true, truncated: false })
        setPreviewImage(asset.dataUrl)
        return
      }
      const content = await window.hq.workspaceRead(path)
      if (requestId !== openFileRequestRef.current) return
      setSelected(content)
    } catch (error) {
      if (requestId !== openFileRequestRef.current) return
      setSelected(null)
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      if (requestId === openFileRequestRef.current) setPreviewLoading(false)
    }
  }

  const beginEdit = (): void => {
    if (!selected || selected.binary || selected.truncated) return
    setDraft(selected.content)
    setSaveError('')
    setEditing(true)
  }

  const saveFile = async (): Promise<void> => {
    if (!selected || saving) return
    setSaving(true)
    setSaveError('')
    try {
      const updated = await window.hq.workspaceWrite(selected.path, draft)
      setSelected(updated)
      setEditing(false)
      void loadRoot()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!fileRequest) return
    setTab('files')
    if (fileRequest.path) void openFile(fileRequest.path)
  }, [fileRequest?.nonce])

  const lastTabSignalNonceRef = useRef(tabSignal?.nonce ?? 0)

  useEffect(() => {
    if (tabSignal && tabSignal.nonce !== lastTabSignalNonceRef.current) {
      lastTabSignalNonceRef.current = tabSignal.nonce
      setTab(tabSignal.tab)
    }
  }, [tabSignal])

  const startResize = (event: React.MouseEvent): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    document.body.classList.add('hq-resizing')
    const onMove = (moveEvent: MouseEvent): void => {
      setWidth(clampPanelWidth(startWidth + (startX - moveEvent.clientX)))
    }
    const onUp = (upEvent: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('hq-resizing')
      const finalWidth = clampPanelWidth(startWidth + (startX - upEvent.clientX))
      setWidth(finalWidth)
      try {
        localStorage.setItem('hq.rightWidth', String(finalWidth))
      } catch {
        // Ignore.
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const highlighted = useMemo(() => {
    if (!selected || selected.binary) return null
    return highlightCode(selected.path, selected.content.slice(0, 200_000))
  }, [selected])

  const copyPath = async (): Promise<void> => {
    if (!selected) return
    try {
      const root = settings.workspace.replace(/[\\/]+$/, '')
      const relative = selected.path.replace(/\//g, '\\')
      await navigator.clipboard.writeText(
        relative ? `${root}\\${relative}` : root
      )
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      // Ignore.
    }
  }

  const mcpRows = [
    ...settings.mcpServers.map((config) => ({
      config,
      status: statuses.find((status) => status.id === config.id)
    })),
    ...statuses
      .filter(
        (status) =>
          status.builtin && !settings.mcpServers.some((config) => config.id === status.id)
      )
      .map((status) => ({
        config: {
          id: status.id,
          name: status.name,
          enabled: true,
          transport: 'stdio' as const,
          command: '',
          args: [],
          env: {},
          url: '',
          headers: {}
        } satisfies McpServerConfig,
        status
      }))
  ]

  return (
    <aside
      className={cn('right-panel', hidden && 'right-panel-hidden')}
      style={{ width, flexBasis: width }}
    >
      <div className="right-resize-handle" onMouseDown={startResize} aria-hidden="true" />
      <div className="right-head">
        <div className="right-tabs">
          <button
            type="button"
            className={cn('right-tab', tab === 'files' && 'active')}
            onClick={() => setTab('files')}
          >
            <Folder size={14} /> 工作区
          </button>
          <button
            type="button"
            className={cn('right-tab', tab === 'mcp' && 'active')}
            onClick={() => setTab('mcp')}
          >
            <Plug size={14} /> MCP
            {mcpRows.length > 0 && <span className="right-tab-count">{mcpRows.length}</span>}
          </button>
          <button
            type="button"
            className={cn('right-tab', tab === 'web' && 'active')}
            onClick={() => setTab('web')}
          >
            <Globe size={14} /> 网页
          </button>
        </div>
        <button type="button" className="right-close" onClick={onClose} title="收起侧栏">
          <X size={15} />
        </button>
      </div>

      {tab === 'files' ? (
        selected ? (
          <div className="file-preview">
            <div className="preview-head">
              <button type="button" className="preview-back" onClick={() => setSelected(null)}>
                <ArrowLeft size={14} /> 返回
              </button>
              <div className="preview-actions">
                {!editing && (
                  <button
                    type="button"
                    onClick={beginEdit}
                    disabled={selected.binary || selected.truncated}
                    title={
                      selected.binary
                        ? '二进制文件不能编辑'
                        : selected.truncated
                          ? '文件过大，暂不支持编辑'
                          : '编辑文件'
                    }
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {editing && (
                  <>
                    <button
                      type="button"
                      onClick={() => void saveFile()}
                      disabled={saving}
                      title="保存（Ctrl+S）"
                    >
                      {saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      disabled={saving}
                      title="取消编辑"
                    >
                      <X size={14} />
                    </button>
                  </>
                )}
                <button type="button" onClick={() => void copyPath()} title="复制绝对路径">
                  {copied ? <span className="copied-text">已复制</span> : <Copy size={14} />}
                </button>
                <button
                  type="button"
                  className="preview-open-btn"
                  onClick={() =>
                    void (async () => {
                      try {
                        await window.hq.workspaceOpen(selected.path)
                        onNotify?.('success', '已请求系统打开文件')
                      } catch (error) {
                        onNotify?.(
                          'error',
                          `无法打开文件：${error instanceof Error ? error.message : String(error)}`
                        )
                      }
                    })()
                  }
                  title="用系统默认程序打开"
                >
                  <ExternalLink size={14} />
                  <span>打开</span>
                </button>
              </div>
            </div>
            <div className="preview-title">
              <span>{baseName(selected.path)}</span>
              <small>{selected.path}</small>
            </div>
            {previewLoading ? (
              <div className="panel-empty">
                <LoaderCircle size={18} className="spin" /> 读取中…
              </div>
            ) : editing ? (
              <div className="preview-editor-wrap">
                <textarea
                  className="preview-editor"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                      event.preventDefault()
                      void saveFile()
                    }
                  }}
                  spellCheck={false}
                />
                {saveError && <div className="preview-save-error">{saveError}</div>}
                <div className="preview-foot">
                  {draft.length.toLocaleString()} 字符 · Ctrl+S 保存
                </div>
              </div>
            ) : previewImage ? (
              <div className="preview-image-wrap">
                <img src={previewImage} alt={selected.path} />
                <div className="preview-foot">{formatBytes(selected.size)} · 图片预览</div>
              </div>
            ) : /\.(md|markdown)$/i.test(selected.path) ? (
              <div className="preview-markdown-wrap">
                <Markdown content={selected.content} className="preview-markdown" />
                <div className="preview-foot">{formatBytes(selected.size)} · Markdown 预览</div>
              </div>
            ) : selected.binary ? (
              <div className="binary-preview">
                <FileText size={30} strokeWidth={1.4} />
                <strong>{baseName(selected.path)}</strong>
                <span>
                  {formatBytes(selected.size)} · 二进制文档，无法在侧栏预览
                </span>
                <div className="binary-actions">
                  <button
                    type="button"
                    className="btn primary small"
                    title="用系统默认程序打开（Office / WPS 等）"
                    onClick={() =>
                      void (async () => {
                        try {
                          await window.hq.workspaceOpen(selected.path)
                          onNotify?.('success', '已请求系统打开文件')
                        } catch (error) {
                          onNotify?.(
                            'error',
                            `无法用默认程序打开：${error instanceof Error ? error.message : String(error)}`
                          )
                        }
                      })()
                    }
                  >
                    用默认程序打开
                  </button>
                  <button
                    type="button"
                    className="btn ghost small"
                    title="直接用 Microsoft Office 或 WPS 打开"
                    onClick={() =>
                      void (async () => {
                        try {
                          await window.hq.workspaceOpenOffice(selected.path)
                          onNotify?.('success', '已请求办公软件打开文件')
                        } catch (error) {
                          onNotify?.(
                            'error',
                            `无法用办公软件打开：${error instanceof Error ? error.message : String(error)}`
                          )
                        }
                      })()
                    }
                  >
                    用办公软件打开
                  </button>
                </div>
              </div>
            ) : (
              <div className="preview-code-wrap">
                <pre className="preview-code">
                  <code
                    className="hljs"
                    dangerouslySetInnerHTML={{ __html: highlighted?.html ?? '' }}
                  />
                </pre>
                <div className="preview-foot">
                  {formatBytes(selected.size)}
                  {selected.truncated ? ' · 文件较大，仅显示前 1MB' : ''}
                  {highlighted?.language && ` · ${highlighted.language}`}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="files-toolbar">
              <div className="files-root">
                <FolderOpen size={14} />
                <span>{baseName(settings.workspace)}</span>
              </div>
              <div className="files-actions">
                <button type="button" onClick={() => void loadRoot()} title="刷新">
                  <RefreshCw size={14} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void (async () => {
                      try {
                        await navigator.clipboard.writeText(settings.workspace)
                        onNotify?.('success', '已复制工作区路径')
                      } catch {
                        onNotify?.('error', `工作区：${settings.workspace}`)
                      }
                    })()
                  }
                  title="复制工作区路径"
                >
                  <Copy size={14} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void (async () => {
                      try {
                        await window.hq.workspaceReveal('.')
                        onNotify?.('success', '已请求打开资源管理器')
                      } catch (error) {
                        onNotify?.(
                          'error',
                          `无法打开资源管理器：${error instanceof Error ? error.message : String(error)}`
                        )
                      }
                    })()
                  }
                  title="在资源管理器中打开"
                >
                  <ExternalLink size={14} />
                </button>
              </div>
            </div>
            <div className="file-tree">
              {loading ? (
                <div className="panel-empty">
                  <LoaderCircle size={16} className="spin" /> 读取工作区…
                </div>
              ) : loadError ? (
                <div className="panel-empty error">
                  <AlertCircle size={16} /> {loadError}
                </div>
              ) : entries.length === 0 ? (
                <div className="panel-empty">工作区还是空的。让 Agent 在这里创建第一个文件吧。</div>
              ) : (
                entries.map((entry) => (
                  <TreeNode key={entry.path} entry={entry} depth={0} onOpenFile={(path) => void openFile(path)} />
                ))
              )}
            </div>
            <div className="panel-foot">
              <span>只读预览</span>
              <span>·</span>
              <span>{entries.length} 项</span>
            </div>
          </>
        )
      ) : tab === 'mcp' ? (
        <>
          <div className="mcp-panel-head">
            <span>已接入的 MCP 服务</span>
            <div className="files-actions">
              <button type="button" onClick={onRefreshMcp} title="重新连接所有 MCP 服务">
                <RefreshCw size={14} />
              </button>
              <button type="button" onClick={() => onOpenSettings('mcp')} title="管理 MCP">
                <Settings2 size={14} />
              </button>
            </div>
          </div>
          <div className="mcp-list">
            {!mcpRows.length && (
              <div className="panel-empty mcp-empty">
                <span className="mcp-empty-icon">
                  <Server size={20} strokeWidth={1.6} />
                </span>
                还没有 MCP 服务
                <small>接入本地文件、数据库、浏览器等外部工具</small>
                <button type="button" className="panel-btn" onClick={() => onOpenSettings('mcp')}>
                  添加 MCP 服务
                </button>
              </div>
            )}
            {mcpRows.map(({ config, status }) => {
              const state = !config.enabled
                ? 'disabled'
                : status?.state ?? 'disconnected'
              return (
                <div className={cn('mcp-card', `state-${state}`)} key={config.id}>
                  <div className="mcp-card-top">
                    <span className={cn('mcp-dot', state)} />
                    <span className="mcp-name">{config.name}</span>
                    {status?.builtin && <span className="mcp-builtin-badge">内置</span>}
                    <span className="mcp-transport">{config.transport}</span>
                  </div>
                  <div className="mcp-state">
                    {state === 'connected' &&
                      `已连接 · ${status?.tools.length ?? 0} 工具 · ${status?.resources?.length ?? 0} 资源 · ${status?.prompts?.length ?? 0} 提示`}
                    {state === 'connecting' && '正在连接…'}
                    {state === 'error' && '连接失败'}
                    {state === 'disabled' && '已停用'}
                    {state === 'disconnected' && '未连接'}
                  </div>
                  {state === 'error' && status?.error && (
                    <div className="mcp-error">{status.error}</div>
                  )}
                  {state === 'connected' && !!status?.tools.length && (
                    <div className="mcp-tools">
                      {status.tools.slice(0, 3).map((tool) => (
                        <span key={tool.name}>{tool.name}</span>
                      ))}
                      {status.tools.length > 3 && <span>+{status.tools.length - 3}</span>}
                    </div>
                  )}
                  {state === 'connected' && !!status?.resources?.length && (
                    <div className="mcp-tools">
                      {status.resources.slice(0, 2).map((resource) => (
                        <span key={resource.uri}>资源 · {resource.name}</span>
                      ))}
                      {status.resources.length > 2 && <span>+{status.resources.length - 2}</span>}
                    </div>
                  )}
                  {state === 'connected' && !!status?.prompts?.length && (
                    <div className="mcp-tools">
                      {status.prompts.slice(0, 2).map((prompt) => (
                        <span key={prompt.name}>提示 · {prompt.name}</span>
                      ))}
                      {status.prompts.length > 2 && <span>+{status.prompts.length - 2}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="panel-foot mcp-foot">
            <ShieldCheck size={12} /> MCP 写操作会先请求你的确认
          </div>
        </>
      ) : null}
      <div className="browser-slot" style={tab === 'web' ? undefined : { display: 'none' }}>
        <BrowserPane />
      </div>
    </aside>
  )
}
