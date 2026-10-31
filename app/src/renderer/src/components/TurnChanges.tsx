import { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  FilePenLine,
  FilePlus2,
  FileText,
  FileX2,
  FolderPlus,
  MoveRight
} from 'lucide-react'
import type { FileChange } from '../lib/turn-changes'
import { changeLabel, turnChangeTotals } from '../lib/turn-changes'

function ChangeIcon({ kind }: { kind: FileChange['kind'] }): React.JSX.Element {
  if (kind === 'created') return <FilePlus2 size={14} />
  if (kind === 'deleted') return <FileX2 size={14} />
  if (kind === 'directory') return <FolderPlus size={14} />
  if (kind === 'moved') return <MoveRight size={14} />
  if (kind === 'edited') return <FilePenLine size={14} />
  return <FileText size={14} />
}

function Stats({ change }: { change: FileChange }): React.JSX.Element {
  if (!change.additions && !change.deletions) {
    return <span className="turn-change-kind">{changeLabel(change)}</span>
  }
  return (
    <span className="turn-change-stats">
      {change.additions > 0 && <span className="add">+{change.additions}</span>}
      {change.deletions > 0 && <span className="del">-{change.deletions}</span>}
    </span>
  )
}

export default function TurnChanges({
  changes,
  onOpenFile
}: {
  changes: FileChange[]
  onOpenFile?: (path: string) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const totals = turnChangeTotals(changes)
  const visible = expanded ? changes : changes.slice(0, 5)

  return (
    <section className="turn-changes" aria-label="本轮修改的文件">
      <div className="turn-changes-head">
        <span className="turn-changes-icon">
          <FileText size={15} />
        </span>
        <span className="turn-changes-heading">
          <strong>已编辑 {changes.length} 个文件</strong>
          <span className="turn-change-stats total">
            {totals.additions > 0 && <span className="add">+{totals.additions.toLocaleString()}</span>}
            {totals.deletions > 0 && <span className="del">-{totals.deletions.toLocaleString()}</span>}
          </span>
        </span>
      </div>
      <div className="turn-changes-list">
        {visible.map((change) => (
          <button
            type="button"
            key={`${change.kind}:${change.path}:${change.target ?? ''}`}
            className="turn-change-row"
            onClick={() => onOpenFile?.(change.path)}
            title={change.target ? `${change.path} → ${change.target}` : change.path}
          >
            <span className={`turn-change-icon ${change.kind}`}>
              <ChangeIcon kind={change.kind} />
            </span>
            <span className="turn-change-main">
              <span className="turn-change-path">{change.path}</span>
              {change.target && <span className="turn-change-target">→ {change.target}</span>}
            </span>
            <Stats change={change} />
          </button>
        ))}
      </div>
      {changes.length > 5 && (
        <button
          type="button"
          className="turn-changes-expand"
          onClick={() => {
            setExpanded((value) => !value)
            window.requestAnimationFrame(() => {
              document.querySelector('.chat-end')?.scrollIntoView({ block: 'end' })
            })
          }}
        >
          {expanded ? (
            <>
              收起 <ChevronUp size={13} />
            </>
          ) : (
            <>
              全部 {changes.length} 个文件 <ChevronDown size={13} />
            </>
          )}
        </button>
      )}
    </section>
  )
}
