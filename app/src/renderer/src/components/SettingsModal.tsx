import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronRight,
  Cpu,
  ExternalLink,
  FolderOpen,
  Info,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Plug,
  Save,
  ShieldAlert,
  ShieldCheck,
  X
} from 'lucide-react'
import type {
  ApprovalMode,
  McpServerConfig,
  McpStatus,
  ModelInfo,
  ProfileDraft,
  SettingsSaveInput,
  UiSettings,
  PythonStatus
} from '../../../shared/types'
import logo from '../assets/logo.png'
import emblem from '../assets/emblem.png'
import { cn, stripIpcError, uid } from '../lib/utils'
import { blankProfile, draftFromProfile, type DraftProfile } from '../lib/settings-form'
import McpEditor from './settings/McpEditor'
import ModelTab from './settings/ModelTab'

export type SettingsTab = 'model' | 'mcp' | 'workspace' | 'about'

const TABS: Array<{ id: SettingsTab; label: string; icon: React.JSX.Element; hint: string }> = [
  { id: 'model', label: '模型接入', icon: <Cpu size={16} />, hint: 'API 与模型参数' },
  { id: 'mcp', label: 'MCP 扩展', icon: <Plug size={16} />, hint: '本地工具与外部能力' },
  { id: 'workspace', label: '工作区与权限', icon: <FolderOpen size={16} />, hint: '执行范围与确认策略' },
  { id: 'about', label: '关于', icon: <Info size={16} />, hint: '版本与校园文化' }
]


interface SettingsModalProps {
  settings: UiSettings
  initialTab: SettingsTab
  appVersion: string
  statuses: McpStatus[]
  onClose: () => void
  onSaved: (settings: UiSettings) => void
}

export default function SettingsModal({
  settings,
  initialTab,
  appVersion,
  statuses,
  onClose,
  onSaved
}: SettingsModalProps): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [profiles, setProfiles] = useState<DraftProfile[]>(() => {
    const drafts = settings.profiles.map(draftFromProfile)
    return drafts.length ? drafts : [blankProfile()]
  })
  const [selectedId, setSelectedId] = useState(() => {
    const active =
      settings.profiles.find((profile) => profile.id === settings.activeProfileId) ??
      settings.profiles[0]
    return active?.id ?? ''
  })
  const selected =
    profiles.find((profile) => profile.id === selectedId) ?? profiles[0] ?? blankProfile()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [workspace, setWorkspace] = useState(settings.workspace)
  const [elevateOnStart, setElevateOnStart] = useState(settings.elevateOnStart)
  const [agentElevated, setAgentElevated] = useState(settings.agentElevated)
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(settings.approvalMode)
  const [confirmAuto, setConfirmAuto] = useState(false)
  const [elevateState, setElevateState] = useState<'idle' | 'working' | 'denied'>('idle')
  const [maxSteps, setMaxSteps] = useState(settings.maxSteps)
  const [networkLocked, setNetworkLocked] = useState(settings.networkLocked)
  const [extra, setExtra] = useState(settings.systemPromptExtra)
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(settings.mcpServers)
  const [pythonStatus, setPythonStatus] = useState<PythonStatus | null>(null)
  const [pythonBusy, setPythonBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const didAutoFetch = useRef(false)
  const selectedIdRef = useRef(selectedId)
  const savedTimerRef = useRef<number | null>(null)
  const pendingSavedRef = useRef<UiSettings | null>(null)
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(
    () => () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current)
        savedTimerRef.current = null
      }
      // The save is already on disk; make sure the app still receives it even
      // when the dialog closes before the 350ms confirmation delay.
      const pending = pendingSavedRef.current
      pendingSavedRef.current = null
      if (pending) onSavedRef.current(pending)
    },
    []
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || saving) return
      // The approval dialog owns Escape while it is open.
      if (document.querySelector('.approval-modal')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  useEffect(() => {
    void window.hq.pythonStatus().then(setPythonStatus).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!pythonStatus?.installing) return
    const timer = window.setInterval(() => {
      void window.hq.pythonStatus().then(setPythonStatus).catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [pythonStatus?.installing])

  const setupPython = async (): Promise<void> => {
    setPythonBusy(true)
    try {
      setPythonStatus(
        pythonStatus?.ready ? await window.hq.pythonStatus() : await window.hq.pythonSetup()
      )
    } catch (error) {
      setPythonStatus((current) =>
        current
          ? { ...current, error: stripIpcError(String(error)) }
          : {
              available: false,
              ready: false,
              installing: false,
              venvPath: '',
              installed: [],
              missing: [],
              error: stripIpcError(String(error))
            }
      )
    } finally {
      setPythonBusy(false)
    }
  }

  const updateProfile = (patch: Partial<DraftProfile>): void => {
    setProfiles((list) =>
      list.map((profile) => (profile.id === selected.id ? { ...profile, ...patch } : profile))
    )
    setTestResult(null)
  }

  const switchProfile = (id: string): void => {
    setSelectedId(id)
    setModels([])
    setModelsError('')
    setTestResult(null)
  }

  const addProfile = (): void => {
    const profile = blankProfile()
    profile.name = `配置 ${profiles.length + 1}`
    setProfiles((list) => [...list, profile])
    setSelectedId(profile.id)
    setModels([])
    setModelsError('')
    setTestResult(null)
  }

  const removeProfile = (): void => {
    if (profiles.length <= 1) return
    const remaining = profiles.filter((profile) => profile.id !== selected.id)
    setProfiles(remaining)
    setSelectedId(remaining[0]?.id ?? '')
    setModels([])
    setModelsError('')
    setTestResult(null)
  }

  const applyModel = (model: ModelInfo): void => {
    updateProfile({
      model: model.id,
      contextWindow: model.contextWindow ?? selected.contextWindow,
      maxTokens: model.maxOutputTokens ?? selected.maxTokens,
      vision: model.vision
    })
  }

  const discoverModels = async (quiet = false): Promise<void> => {
    if (!selected.baseUrl.trim()) {
      if (!quiet) setModelsError('请先填写 Base URL')
      return
    }
    const profileId = selected.id
    setModelsLoading(true)
    setModelsError('')
    try {
      const result = await window.hq.listProfileModels({
        profile: {
          id: selected.id,
          name: selected.name,
          provider: selected.provider,
          baseUrl: selected.baseUrl,
          model: selected.model,
          contextWindow: selected.contextWindow,
          temperature: selected.temperature,
          maxTokens: selected.maxTokens
        },
        apiKey: selected.clearKey ? null : selected.apiKey.trim() || undefined
      })
      if (selectedIdRef.current !== profileId) return
      if (!result.ok) {
        setModelsError(result.message)
        return
      }
      const nextModels =
        result.modelDetails ?? (result.models ?? []).map((id) => ({ id }) as ModelInfo)
      setModels(nextModels)
      const matched = nextModels.find((model) => model.id === selected.model.trim())
      if (matched) {
        applyModel(matched)
      } else if (!selected.model.trim() && nextModels[0]) {
        applyModel(nextModels[0])
      }
    } catch (error) {
      if (selectedIdRef.current !== profileId) return
      setModelsError(stripIpcError(String(error)))
    } finally {
      setModelsLoading(false)
    }
  }

  useEffect(() => {
    if (didAutoFetch.current) return
    didAutoFetch.current = true
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(selected.baseUrl)
    if (selected.baseUrl.trim() && (selected.hasKey || selected.apiKey.trim() || local)) {
      void discoverModels(true)
    }
    // Run once when the settings panel opens; later edits use blur/button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const testConnection = async (): Promise<void> => {
    if (!selected.baseUrl.trim() || !selected.model.trim()) {
      setTestResult({ ok: false, message: '请先填写 Base URL 与 Model ID' })
      return
    }
    setTesting(true)
    setTestResult(null)
    const profileId = selected.id
    try {
      const draft: ProfileDraft = {
        id: selected.id,
        name: selected.name,
        provider: selected.provider,
        baseUrl: selected.baseUrl,
        model: selected.model,
        contextWindow: selected.contextWindow,
        temperature: selected.temperature,
        maxTokens: selected.maxTokens
      }
      const result = await window.hq.testProfile({
        profile: draft,
        apiKey: selected.clearKey ? null : selected.apiKey.trim() || undefined
      })
      if (selectedIdRef.current !== profileId) return
      setTestResult(result)
    } catch (error) {
      if (selectedIdRef.current !== profileId) return
      setTestResult({ ok: false, message: stripIpcError(String(error)) })
    } finally {
      setTesting(false)
    }
  }

  const chooseWorkspace = async (): Promise<void> => {
    const path = await window.hq.chooseWorkspace()
    if (path) setWorkspace(path)
  }

  const addMcp = (): void => {
    const config: McpServerConfig = {
      id: uid(),
      name: '新 MCP 服务',
      enabled: false,
      transport: 'stdio',
      command: '',
      args: [],
      env: {},
      url: '',
      headers: {}
    }
    setMcpServers((list) => [...list, config])
  }

  const save = async (): Promise<void> => {
    setError('')
    for (const profile of profiles) {
      if (!profile.baseUrl.trim()) continue
      try {
        const parsed = new URL(profile.baseUrl.trim())
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          setError(`配置「${profile.name || '未命名'}」的 Base URL 仅支持 http/https`)
          setTab('model')
          return
        }
      } catch {
        setError(`配置「${profile.name || '未命名'}」的 Base URL 格式不正确`)
        setTab('model')
        return
      }
    }
    const apiKeys: Record<string, string | null> = {}
    for (const profile of profiles) {
      if (profile.clearKey) apiKeys[profile.id] = null
      else if (profile.apiKey.trim()) apiKeys[profile.id] = profile.apiKey.trim()
    }
    const input: SettingsSaveInput = {
      profiles: profiles.map((profile) => ({
        id: profile.id,
        name: profile.name.trim() || '未命名配置',
        provider: profile.provider,
        baseUrl: profile.baseUrl,
        model: profile.model,
        contextWindow: profile.contextWindow,
        temperature: profile.temperature,
        maxTokens: profile.maxTokens,
        vision: profile.vision
      })),
      activeProfileId: selected.id,
      workspace,
      elevateOnStart,
      agentElevated,
      approvalMode,
      maxSteps,
      networkLocked,
      mcpServers,
      systemPromptExtra: extra,
      apiKeys
    }
    setSaving(true)
    try {
      const updated = await window.hq.saveSettings(input)
      setSaved(true)
      pendingSavedRef.current = updated
      savedTimerRef.current = window.setTimeout(() => {
        savedTimerRef.current = null
        pendingSavedRef.current = null
        onSavedRef.current(updated)
      }, 350)
    } catch (saveError) {
      setError(stripIpcError(saveError instanceof Error ? saveError.message : String(saveError)))
    } finally {
      setSaving(false)
    }
  }

  const profileKeyHint = selected
    ? selected.clearKey
      ? '已标记清除，保存后生效'
      : selected.apiKey.trim()
        ? '保存后将更新密钥'
        : selected.hasKey
          ? '••••••••••••'
          : '粘贴 API Key'
    : ''

  return (
    <div className="modal-backdrop settings-backdrop" onMouseDown={() => !saving && onClose()}>
      <div className="settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <aside className="settings-nav">
          <div className="settings-brand">
            <img src={emblem} alt="" />
            <div>
              <strong>华强以太</strong>
              <span>设置</span>
            </div>
          </div>
          <div className="settings-tabs">
            {TABS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={cn('settings-tab', tab === item.id && 'active')}
                onClick={() => setTab(item.id)}
              >
                <span className="settings-tab-icon">{item.icon}</span>
                <span className="settings-tab-text">
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
                <ChevronRight size={13} className="settings-tab-arrow" />
              </button>
            ))}
          </div>
          <div className="settings-nav-foot">
            <LockKeyhole size={13} />
            模型密钥使用系统级加密保存
          </div>
        </aside>

        <div className="settings-main">
          <div className="settings-head">
            <div>
              <span className="settings-kicker">SETTINGS</span>
              <h2>{TABS.find((item) => item.id === tab)?.label}</h2>
            </div>
            <button type="button" className="modal-close" onClick={onClose} disabled={saving} aria-label="关闭">
              <X size={18} />
            </button>
          </div>

          <div className="settings-content">
            {tab === 'model' && (
            <ModelTab
              profiles={profiles}
              selected={selected}
              models={models}
              modelsLoading={modelsLoading}
              modelsError={modelsError}
              testing={testing}
              testResult={testResult}
              keyHint={profileKeyHint}
              onSwitchProfile={switchProfile}
              onAddProfile={addProfile}
              onRemoveProfile={removeProfile}
              onUpdateProfile={updateProfile}
              onResetModels={() => {
                setModels([])
                setModelsError('')
              }}
              onDiscoverModels={(silent) => void discoverModels(silent)}
              onApplyModel={applyModel}
              onTestConnection={() => void testConnection()}
            />
            )}

            {tab === 'mcp' && (
              <div className="settings-section">
                <div className="section-intro">
                  <div>
                    <h3>MCP 服务</h3>
                    <p>
                      接入 Model Context Protocol 工具。stdio 服务会在本机启动进程，HTTP 服务通过
                      URL 连接。写操作同样会请求你的确认。
                    </p>
                  </div>
                  <button type="button" className="btn secondary small" onClick={addMcp}>
                    <Plus size={14} /> 添加 MCP
                  </button>
                </div>
                <div className="mcp-editor-list">
                  {!mcpServers.length && (
                    <div className="settings-empty mcp-settings-empty">
                      <Plug size={22} />
                      <strong>还没有接入 MCP</strong>
                      <span>
                        可以添加文件系统、浏览器、数据库等 MCP 服务。例如
                        <code>npx -y @modelcontextprotocol/server-filesystem &lt;目录&gt;</code>
                      </span>
                    </div>
                  )}
                  {mcpServers.map((config) => (
                    <McpEditor
                      key={config.id}
                      config={config}
                      status={statuses.find((status) => status.id === config.id)}
                      onChange={(next) =>
                        setMcpServers((list) =>
                          list.map((server) => (server.id === next.id ? next : server))
                        )
                      }
                      onRemove={() =>
                        setMcpServers((list) => list.filter((server) => server.id !== config.id))
                      }
                    />
                  ))}
                </div>
                <div className="settings-note">
                  <ShieldCheck size={14} />
                  保存后，已启用的 MCP 服务会自动连接；连接状态可在右侧「MCP」面板查看。
                </div>
              </div>
            )}

            {tab === 'workspace' && (
              <div className="settings-section">
                <div className="settings-block">
                  <h3>工作区</h3>
                  <p>Agent 只能读写这个目录内的文件，执行命令时也以此为默认目录。</p>
                  <div className="workspace-picker">
                    <FolderOpen size={16} />
                    <span title={workspace}>{workspace}</span>
                    <button type="button" className="btn ghost small" onClick={() => void chooseWorkspace()}>
                      选择文件夹
                    </button>
                  </div>
                </div>

                <div className="settings-block">
                  <h3>Agent 权限（推荐）</h3>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={agentElevated}
                      onChange={(event) => setAgentElevated(event.target.checked)}
                    />
                    <span>以管理员权限运行 Agent，窗口保持普通权限</span>
                  </label>
                  <p>
                    文件写入、PowerShell、Python 交给独立的提权辅助进程执行（启动时弹一次 UAC）；窗口本身仍是普通权限，资源管理器拖拽、粘贴、截图全部可用。
                  </p>
                </div>

                <div className="settings-block">
                  <h3>启动权限（整个应用）</h3>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={elevateOnStart}
                      onChange={(event) => setElevateOnStart(event.target.checked)}
                    />
                    <span>启动时请求管理员权限（Agent 以最高权限运行）</span>
                  </label>
                  <p>
                    开启后每次启动应用都会弹出 Windows UAC 授权弹窗。管理员模式下 Windows
                    会阻止从资源管理器拖入文件，可改用 Ctrl+V 或「+ → 上传文件」。
                  </p>
                </div>

                <div className="settings-block">
                  <h3>断网锁</h3>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={networkLocked}
                      onChange={(event) => setNetworkLocked(event.target.checked)}
                    />
                    <span>模型 API 仍可用，但禁止模型上网</span>
                  </label>
                  <p>
                    开启后仍可正常调用模型；网页抓取、浏览器导航、联网 MCP 和联网命令会被拒绝。关闭后恢复。不会关闭网卡，不影响其他软件。
                  </p>
                </div>

                <div className="settings-block">
                  <h3>写入权限</h3>
                  <p>
                    工作区写入被拒绝时（常见于火绒 / Windows Defender 的文档保护），可请求
                    Windows UAC 以管理员身份重启。注意：管理员模式下 Windows 会阻止从资源管理器拖入文件。
                  </p>
                  <button
                    type="button"
                    className="btn secondary small"
                    disabled={elevateState === 'working'}
                    onClick={() => {
                      setElevateState('working')
                      void window.hq
                        .requestElevation()
                        .then((started) => setElevateState(started ? 'working' : 'denied'))
                        .catch(() => setElevateState('denied'))
                    }}
                  >
                    以管理员身份重启
                  </button>
                  {elevateState === 'working' && (
                    <span className="settings-hint"> 正在请求管理员权限…</span>
                  )}
                  {elevateState === 'denied' && (
                    <span className="settings-hint"> 已取消，或当前已是管理员权限。</span>
                  )}
                </div>

                <div className="settings-block">
                  <h3>权限策略</h3>
                  <p>只读工具会自动执行；写文件、执行命令、访问网络和调用 MCP 受以下策略控制。</p>
                  <div className="approval-grid">
                    <button
                      type="button"
                      className={cn('approval-card', approvalMode === 'ask' && 'selected')}
                      onClick={() => setApprovalMode('ask')}
                    >
                      <span className="approval-icon safe">
                        <ShieldCheck size={19} />
                      </span>
                      <span>
                        <strong>执行前确认</strong>
                        <small>每次遇到写操作或命令都弹出确认，最安全。</small>
                      </span>
                      <span className="approval-radio">{approvalMode === 'ask' && <Check size={12} />}</span>
                    </button>
                    <button
                      type="button"
                      className={cn('approval-card', approvalMode === 'auto' && 'selected warn')}
                      onClick={() => {
                        if (approvalMode !== 'auto') setConfirmAuto(true)
                      }}
                    >
                      <span className="approval-icon warn">
                        <ShieldAlert size={19} />
                      </span>
                      <span>
                        <strong>自动执行</strong>
                        <small>不再逐项询问，适合可信项目；风险由你承担。</small>
                      </span>
                      <span className="approval-radio">{approvalMode === 'auto' && <Check size={12} />}</span>
                    </button>
                  </div>
                </div>

                <div className="settings-block">
                  <div className="block-title-row">
                    <div>
                      <h3>单次任务工具步数</h3>
                      <p>0 表示不限制；任务会持续到完成或手动停止。</p>
                    </div>
                    <div className="steps-control">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={maxSteps}
                        onChange={(event) =>
                          setMaxSteps(Math.max(0, Math.floor(Number(event.target.value) || 0)))
                        }
                      />
                      <span>{maxSteps === 0 ? '无限制' : `${maxSteps} 步`}</span>
                    </div>
                  </div>
                </div>

                <div className="settings-block">
                  <div className="block-title-row">
                    <div>
                      <h3>Python 基础环境</h3>
                      <p>
                        内置便携 Python 运行时，随程序目录移动或拷贝到其他电脑即可使用；已预装 Excel / Word /
                        PPT / PDF、数据处理、绘图和网页处理常用库。Agent 会优先使用这个解释器。
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn secondary small"
                      onClick={() => void setupPython()}
                      disabled={pythonBusy || pythonStatus?.installing}
                    >
                      {pythonBusy || pythonStatus?.installing ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <Cpu size={14} />
                      )}
                      {pythonStatus?.installing
                        ? '安装中…'
                        : pythonStatus?.ready
                          ? '重新检测'
                          : '初始化环境'}
                    </button>
                  </div>
                  {pythonStatus ? (
                    <div className="python-env-status">
                      <div className="python-env-line">
                        <span
                          className={cn(
                            'python-env-dot',
                            pythonStatus.ready
                              ? 'ready'
                              : pythonStatus.installing
                                ? 'installing'
                                : 'missing'
                          )}
                        />
                        <strong>
                          {pythonStatus.ready
                            ? '已就绪'
                            : pythonStatus.installing
                              ? '正在安装基础库…'
                              : pythonStatus.available
                                ? '待初始化'
                                : '未找到 Python'}
                        </strong>
                        <span>
                          {pythonStatus.version ?? 'Python 3'} · 已安装{' '}
                          {pythonStatus.installed.length} /{' '}
                          {pythonStatus.installed.length + pythonStatus.missing.length} 个库
                        </span>
                      </div>
                      {pythonStatus.progress && (
                        <div className="python-env-progress">{pythonStatus.progress}</div>
                      )}
                      {pythonStatus.error && (
                        <div className="python-env-error">{pythonStatus.error}</div>
                      )}
                      {!pythonStatus.ready && !pythonStatus.installing && pythonStatus.missing.length > 0 && (
                        <div className="python-env-missing">
                          缺少：{pythonStatus.missing.join('、')}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="python-env-progress">正在检测 Python 环境…</div>
                  )}
                </div>

                <div className="settings-block">
                  <h3>附加系统提示词</h3>
                  <p>会追加到 Agent 的系统提示中，例如项目规范、回复偏好或技术栈要求。</p>
                  <textarea
                    className="extra-prompt"
                    rows={5}
                    maxLength={20000}
                    value={extra}
                    onChange={(event) => setExtra(event.target.value)}
                    placeholder="例如：本项目只使用 TypeScript；提交前必须运行 pnpm test；不要修改 docs/ 目录。"
                  />
                  <div className="char-count">{extra.length} / 20000</div>
                </div>

                <div className="settings-note">
                  {settings.encryptionAvailable ? <LockKeyhole size={14} /> : <AlertTriangle size={14} />}
                  {settings.encryptionAvailable
                    ? '模型 API Key 使用 Windows DPAPI（safeStorage）加密后保存在本机用户目录；MCP 环境变量与请求头保存在本地设置文件中，请勿填写无关密钥。'
                    : '当前系统未提供加密存储，API Key 仅做本地编码保存，请注意电脑安全。'}
                  <button type="button" className="text-link" onClick={() => void window.hq.openDataFolder().catch(() => undefined)}>
                    打开数据目录 <ExternalLink size={12} />
                  </button>
                </div>
              </div>
            )}

            {tab === 'about' && (
              <div className="settings-section about-section">
                <div className="about-brand">
                  <div className="about-logo-card">
                    <img src={logo} alt="华强职业技术学校" />
                  </div>
                  <div className="about-version">v{appVersion}</div>
                </div>
                <h2 className="about-title">华强以太</h2>
                <div className="about-sub">HQ AETHEON · 本地 AI 编程与系统助手</div>
                <blockquote className="about-motto">华而实，善则强</blockquote>
                <p className="about-desc">
                  为华强职校校园场景打造的本地 Agent 工作台：把大模型的思考能力与真实的文件系统、
                  终端、MCP 工具连接起来，让想法直接变成可运行的项目。
                </p>
                <p className="about-credits">
                  制作者：黄国华 · id：20250404 · 版本更新时间：2026-10-22
                </p>
                <div className="about-features">
                  <span><BookOpen size={14} /> 校园视觉与校训</span>
                  <span><Cpu size={14} /> 自定义模型接口</span>
                  <span><Plug size={14} /> MCP 工具扩展</span>
                  <span><ShieldCheck size={14} /> 本地权限确认</span>
                </div>
                <div className="about-meta">
                  <div><span>技术栈</span><strong>Electron · React · TypeScript · MCP</strong></div>
                  <div><span>学校</span><strong>深圳市福田区华强职业技术学校</strong></div>
                  <div>
                    <span>学校官网</span>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => void window.hq.openExternal('https://hqzx.szftedu.cn/')}
                    >
                      hqzx.szftedu.cn <ExternalLink size={12} />
                    </button>
                  </div>
                </div>
                <p className="about-disclaimer">
                  本应用为校园文化风格的个人/学习项目，并非学校官方发布软件。校徽与校训仅用于校园文化展示。
                </p>
              </div>
            )}
          </div>

          <div className="settings-footer">
            <div className="settings-footer-left">
              {error && (
                <span className="settings-error">
                  <AlertTriangle size={14} /> {error}
                </span>
              )}
              {saved && !error && (
                <span className="settings-saved">
                  <Check size={14} /> 已保存
                </span>
              )}
              {!error && !saved && <span className="settings-hint">修改后记得保存</span>}
            </div>
            <div className="settings-footer-actions">
              <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>
                取消
              </button>
              <button type="button" className="btn primary" onClick={() => void save()} disabled={saving}>
                {saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
                {saving ? '保存中…' : '保存设置'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {confirmAuto && (
        <div
          className="modal-backdrop confirm-backdrop"
          onMouseDown={(event) => {
            event.stopPropagation()
            setConfirmAuto(false)
          }}
        >
          <div className="confirm-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="confirm-dialog-icon warn">
              <ShieldAlert size={20} />
            </div>
            <h3>确认开启自动执行？</h3>
            <p>
              开启后，Agent 写文件、运行命令、访问网络和调用 MCP
              时不再逐项询问，会直接执行；删除操作仍会要求确认。适合可信项目，风险由你承担。
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn ghost" onClick={() => setConfirmAuto(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn primary warn-btn"
                onClick={() => {
                  setApprovalMode('auto')
                  setConfirmAuto(false)
                }}
              >
                确认开启
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
