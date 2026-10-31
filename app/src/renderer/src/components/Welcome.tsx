import { ArrowUpRight, KeyRound } from 'lucide-react'
import type { ApiProfile } from '../../../shared/types'
import emblem from '../assets/emblem.png'

interface WelcomeProps {
  activeProfile?: ApiProfile
  onOpenSettings: () => void
}

export default function Welcome({
  activeProfile,
  onOpenSettings
}: WelcomeProps): React.JSX.Element {
  const isLocal =
    !!activeProfile &&
    /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?/i.test(activeProfile.baseUrl)
  const needsKey = !activeProfile?.hasKey && !isLocal

  return (
    <section className="welcome">
      <div className="welcome-emblem-wrap">
        <div className="welcome-emblem-ring" />
        <img src={emblem} alt="华强职校校徽" className="welcome-emblem" />
      </div>
      <div className="welcome-hero-hud">
        <span className="hud-tag">WHAT WILL YOU BUILD</span>
      </div>
      <h1 className="welcome-title" data-text="你意欲从何种根据出发，构筑何种存在秩序？">
        <span className="welcome-title-main">
          你意欲从何种根据出发
          <br />
          构筑何种存在秩序？
        </span>
      </h1>

      {needsKey ? (
        <button type="button" className="connect-card" onClick={onOpenSettings}>
          <span className="connect-icon">
            <KeyRound size={18} strokeWidth={1.8} />
          </span>
          <span className="connect-text">
            <strong>先连接一个模型 API</strong>
            <span>
              还没有配置接口。填写 Base URL 与 API Key 后，会自动读取该地址下的可用模型。
            </span>
          </span>
          <span className="connect-action">
            去配置 <ArrowUpRight size={15} />
          </span>
        </button>
      ) : null}

    </section>
  )
}
