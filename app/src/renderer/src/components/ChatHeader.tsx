import { FolderOpen, PanelRightClose, PanelRightOpen, Settings2 } from 'lucide-react'
import type { UiSettings } from '../../../shared/types'
import { cn, shortPath } from '../lib/utils'

interface ChatHeaderProps {
  title: string
  settings: UiSettings
  running: boolean
  rightOpen: boolean
  onToggleRight: () => void
  onOpenSettings: () => void
  onChooseWorkspace: () => void
}

export default function ChatHeader({
  title,
  settings,
  running,
  rightOpen,
  onToggleRight,
  onOpenSettings,
  onChooseWorkspace
}: ChatHeaderProps): React.JSX.Element {
  return (
    <header className="main-header">
      <div className="main-title-wrap">
        <div className="main-eyebrow">
          <span>华强以太</span>
          <span className="eyebrow-sep">/</span>
          <span>LOCAL AGENT</span>
          {running && (
            <span className="header-running">
              <i /> 运行中
            </span>
          )}
        </div>
        <h2 className="main-title">{title}</h2>
      </div>

      <div className="header-actions">
        <button
          type="button"
          className="header-workspace"
          onClick={onChooseWorkspace}
          title={`切换工作区：${settings.workspace}`}
        >
          <FolderOpen size={14} strokeWidth={1.8} />
          <span>{shortPath(settings.workspace, 36)}</span>
        </button>
        <span className="header-divider" />
        <button
          type="button"
          className={cn('icon-btn', rightOpen && 'active')}
          onClick={onToggleRight}
          title={rightOpen ? '收起侧栏' : '展开侧栏'}
          aria-label="切换右侧栏"
        >
          {rightOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onOpenSettings}
          title="设置"
          aria-label="设置"
        >
          <Settings2 size={17} />
        </button>
      </div>
    </header>
  )
}
