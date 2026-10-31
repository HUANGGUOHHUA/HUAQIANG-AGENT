import {
  FolderOpen,
  MessageSquare,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import type { SessionMeta, UiSettings } from '../../../shared/types'
import { cn, formatRelative, shortPath, baseName } from '../lib/utils'

interface SidebarProps {
  sessions: SessionMeta[]
  activeSessionId: string | null
  settings: UiSettings
  running: boolean
  appVersion: string
  onNewChat: () => void
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onOpenSettings: () => void
  onChooseWorkspace: () => void
}

export default function Sidebar({
  sessions,
  activeSessionId,
  settings,
  running,
  appVersion,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onOpenSettings,
  onChooseWorkspace
}: SidebarProps): React.JSX.Element {
  const activeProfile =
    settings.profiles.find((profile) => profile.id === settings.activeProfileId) ?? settings.profiles[0]

  const groups = new Map<string, SessionMeta[]>()
  for (const item of sessions) {
    const workspace = item.workspace || settings.workspace || ''
    const list = groups.get(workspace) ?? []
    list.push(item)
    groups.set(workspace, list)
  }
  const workspaceGroups = [...groups.entries()]
    .map(([workspace, items]) => ({
      workspace,
      items: items.sort((a, b) => b.updatedAt - a.updatedAt)
    }))
    .sort((a, b) => {
      if (a.workspace === settings.workspace) return -1
      if (b.workspace === settings.workspace) return 1
      const aTime = a.items[0]?.updatedAt ?? 0
      const bTime = b.items[0]?.updatedAt ?? 0
      return bTime - aTime
    })

  const renderSession = (session: SessionMeta): React.JSX.Element => (
    <div
      className={cn('session-item', session.id === activeSessionId && 'active')}
      key={session.id}
    >
      <button
        type="button"
        className="session-main"
        onClick={() => onSelectSession(session.id)}
        title={session.title}
      >
        <MessageSquare size={14} strokeWidth={1.7} className="session-icon" />
        <span className="session-title">{session.title}</span>
        <span className="session-time">{formatRelative(session.updatedAt)}</span>
      </button>
      <button
        type="button"
        className="session-delete"
        aria-label="删除会话"
        title="删除会话"
        onClick={(event) => {
          event.stopPropagation()
          onDeleteSession(session.id)
        }}
      >
        <Trash2 size={13} strokeWidth={1.8} />
      </button>
    </div>
  )

  return (
    <aside className="sidebar">
      <div className="sidebar-pattern" />
      <div className="brand-block">
        <h1 className="brand-title">华强以太</h1>
        <div className="brand-subtitle">HQ AETHEON</div>
      </div>

      <button
        type="button"
        className={cn('new-chat-btn', running && 'disabled')}
        onClick={onNewChat}
        disabled={running}
        title={running ? '请先停止当前任务' : '新建对话'}
      >
        <Plus size={17} strokeWidth={2} />
        <span>新建对话</span>
        <span className="new-chat-key">N</span>
      </button>

      <div className="session-section">
        <div className="section-label">
          <span>任务</span>
          <span className="section-count">{sessions.length}</span>
        </div>
        <div className="session-list">
          {!sessions.length && (
            <div className="session-empty">
              还没有任务
              <br />
              从一个想法开始吧
            </div>
          )}
          {workspaceGroups.map((group) => (
            <div className="workspace-group" key={group.workspace || 'unassigned'}>
              <div className="workspace-group-head" title={group.workspace || '未指定工作区'}>
                <FolderOpen size={13} strokeWidth={1.8} />
                <span className="workspace-group-name">
                  {group.workspace ? baseName(group.workspace) : '未指定工作区'}
                </span>
                <span className="workspace-group-count">{group.items.length}</span>
              </div>
              {group.items.map(renderSession)}
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-bottom">
        <button type="button" className="workspace-card" onClick={onChooseWorkspace} title="切换工作区">
          <span className="workspace-icon">
            <FolderOpen size={16} strokeWidth={1.8} />
          </span>
          <span className="workspace-text">
            <span className="workspace-label">当前工作区</span>
            <span className="workspace-path">{shortPath(settings.workspace, 30)}</span>
          </span>
          <span className="workspace-change">切换</span>
        </button>

        <div className="sidebar-meta">
          <button
            type="button"
            className="meta-btn"
            onClick={onOpenSettings}
            data-testid="open-settings"
          >
            <Settings2 size={15} strokeWidth={1.8} />
            设置
          </button>
          <span className="meta-sep" />
          <span className="meta-model" title={activeProfile?.name}>
            {activeProfile?.name ?? '未配置模型'}
          </span>
        </div>

        <div className="sidebar-footer">
          <span className="footer-shield">
            <ShieldCheck size={13} strokeWidth={1.8} />
            数据与密钥仅保存在本机
          </span>
          <span className="footer-version">v{appVersion}</span>
        </div>
      </div>
    </aside>
  )
}
