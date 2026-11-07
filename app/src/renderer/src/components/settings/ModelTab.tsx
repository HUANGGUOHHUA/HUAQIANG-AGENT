import { AlertTriangle, Check, KeyRound, LoaderCircle, Plus, RefreshCw, Trash2, Zap } from 'lucide-react'
import type { ModelInfo } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { formatTokens, type DraftProfile } from '../../lib/settings-form'

export interface ModelTabProps {
  profiles: DraftProfile[]
  selected: DraftProfile
  models: ModelInfo[]
  modelsLoading: boolean
  modelsError: string
  testing: boolean
  testResult: { ok: boolean; message: string } | null
  keyHint: string
  onSwitchProfile: (id: string) => void
  onAddProfile: () => void
  onRemoveProfile: () => void
  onUpdateProfile: (patch: Partial<DraftProfile>) => void
  onResetModels: () => void
  onDiscoverModels: (silent?: boolean) => void
  onApplyModel: (model: ModelInfo) => void
  onTestConnection: () => void
}

/** 设置 · 模型接入页：多套配置切换、模型发现和连接测试。 */
export default function ModelTab({
  profiles,
  selected,
  models,
  modelsLoading,
  modelsError,
  testing,
  testResult,
  keyHint,
  onSwitchProfile,
  onAddProfile,
  onRemoveProfile,
  onUpdateProfile,
  onResetModels,
  onDiscoverModels,
  onApplyModel,
  onTestConnection
}: ModelTabProps): React.JSX.Element {
  return (
              <div className="settings-section model-section">
                <div className="profile-switcher">
                  <div className="profile-switcher-list">
                    {profiles.map((profile) => (
                      <button
                        type="button"
                        key={profile.id}
                        className={cn('profile-tab', profile.id === selected.id && 'active')}
                        onClick={() => onSwitchProfile(profile.id)}
                        title={profile.baseUrl || '尚未填写 Base URL'}
                      >
                        {profile.name.trim() || '未命名配置'}
                      </button>
                    ))}
                  </div>
                  <div className="profile-switcher-actions">
                    <button type="button" className="icon-btn tiny" onClick={onAddProfile} title="新增配置">
                      <Plus size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn tiny danger"
                      onClick={onRemoveProfile}
                      disabled={profiles.length <= 1}
                      title="删除当前配置"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="profile-form generic-profile-form">
                  <div className="profile-form-head">
                    <div>
                      <h3>模型配置</h3>
                      <span>可以保存多套接口配置；当前标签页的配置会作为默认模型。</span>
                    </div>
                  </div>

                  <div className="form-row two">
                    <label className="field">
                      <span>配置名称</span>
                      <input
                        value={selected.name}
                        onChange={(event) => onUpdateProfile({ name: event.target.value })}
                        placeholder="通用接口"
                      />
                    </label>
                    <label className="field">
                      <span>接口协议</span>
                      <select
                        value={selected.provider}
                        onChange={(event) => {
                          onUpdateProfile({
                            provider: event.target.value as 'openai' | 'anthropic'
                          })
                          onResetModels()
                        }}
                      >
                        <option value="openai">OpenAI 兼容 · /chat/completions</option>
                        <option value="anthropic">Anthropic · /v1/messages</option>
                      </select>
                    </label>
                  </div>

                  <label className="field">
                    <span>Base URL</span>
                    <input
                      value={selected.baseUrl}
                      onChange={(event) => {
                        onUpdateProfile({ baseUrl: event.target.value })
                        onResetModels()
                      }}
                      onBlur={() => {
                        if (
                          selected.apiKey.trim() ||
                          selected.hasKey ||
                          /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(selected.baseUrl)
                        ) {
                          void onDiscoverModels(true)
                        }
                      }}
                      placeholder="https://api.example.com/v1"
                      spellCheck={false}
                    />
                    <small>填写到 /v1 即可；程序会自动读取 /models 并使用你的 API Key。</small>
                  </label>

                  <label className="field key-field">
                    <span>API Key</span>
                    <div className="key-input-wrap">
                      <KeyRound size={14} />
                      <input
                        type="password"
                        value={selected.apiKey}
                        onChange={(event) =>
                          onUpdateProfile({ apiKey: event.target.value, clearKey: false })
                        }
                        onBlur={() => {
                          if (selected.baseUrl.trim() && selected.apiKey.trim()) {
                            void onDiscoverModels(true)
                          }
                        }}
                        placeholder={keyHint}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                    {selected.hasKey && !selected.clearKey && (
                      <button
                        type="button"
                        className="clear-key"
                        onClick={() => onUpdateProfile({ clearKey: true, hasKey: false })}
                      >
                        清除已保存密钥
                      </button>
                    )}
                    {selected.hasKey && !selected.apiKey && !selected.clearKey && (
                      <small>已安全保存，留空保持不变</small>
                    )}
                    {selected.clearKey && <small className="warn-text">保存后将清除密钥</small>}
                  </label>

                  <div className="field model-field">
                    <div className="field-label-row">
                      <span>Model ID</span>
                      <button
                        type="button"
                        className="text-link model-fetch"
                        onClick={() => void onDiscoverModels()}
                        disabled={modelsLoading}
                      >
                        {modelsLoading ? (
                          <LoaderCircle size={12} className="spin" />
                        ) : (
                          <RefreshCw size={12} />
                        )}
                        {modelsLoading ? '读取中…' : '读取模型'}
                      </button>
                    </div>
                    <input
                      value={selected.model}
                      onChange={(event) => onUpdateProfile({ model: event.target.value })}
                      placeholder="读取后从列表选择，或手动填写 Model ID"
                      spellCheck={false}
                    />
                    {modelsLoading && (
                      <div className="model-loading">
                        <span />
                        <span />
                        <span />
                        正在读取模型信息…
                      </div>
                    )}
                    {!modelsLoading && models.length > 0 && (
                      <div className="model-results">
                        <div className="model-results-head">
                          可用模型 · {models.length}
                          <small>上下文与最大输出会随模型自动填入</small>
                        </div>
                        {models.map((model) => (
                          <button
                            type="button"
                            key={model.id}
                            className={cn(
                              'model-row',
                              selected.model === model.id && 'selected'
                            )}
                            onClick={() => onApplyModel(model)}
                          >
                            <span className="model-row-main">
                              <strong>{model.name || model.id}</strong>
                              {model.name && <small>{model.id}</small>}
                            </span>
                            <span className="model-row-meta">
                              {model.vision && <span className="vision-badge">视觉</span>}
                              <span>上下文 {formatTokens(model.contextWindow)}</span>
                              <span>最大输出 {formatTokens(model.maxOutputTokens)}</span>
                            </span>
                            {selected.model === model.id && <Check size={13} />}
                          </button>
                        ))}
                      </div>
                    )}
                    <small className={modelsError ? 'warn-text' : undefined}>
                      {modelsError ||
                        (models.length
                          ? '点选模型会自动填入上下文窗口和最大输出；也可以手动修改。'
                          : '填写 Base URL 后点「读取模型」；接口不返回元数据时可手动填写。')}
                    </small>
                  </div>

                  <div className="form-row two">
                    <label className="field">
                      <span>上下文窗口 Tokens</span>
                      <input
                        type="number"
                        min={4000}
                        max={2000000}
                        step={1000}
                        value={selected.contextWindow}
                        onChange={(event) =>
                          onUpdateProfile({ contextWindow: Number(event.target.value) || 128000 })
                        }
                      />
                      <small>用于判断何时压缩较早的对话；从模型列表自动填入。</small>
                    </label>
                    <label className="field">
                      <span>单次最大输出 Tokens</span>
                      <input
                        type="number"
                        min={256}
                        max={200000}
                        step={256}
                        value={selected.maxTokens}
                        onChange={(event) =>
                          onUpdateProfile({ maxTokens: Number(event.target.value) || 8192 })
                        }
                      />
                      <small>模型列表提供上限时会自动填入，可手动调低。</small>
                    </label>
                  </div>

                  <label className="field">
                    <span>Temperature · {selected.temperature.toFixed(1)}</span>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={selected.temperature}
                      onChange={(event) =>
                        onUpdateProfile({ temperature: Number(event.target.value) })
                      }
                    />
                    <small>越低越稳定，编程任务建议 0.2 – 0.5。</small>
                  </label>

                  <div className="test-row">
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => void onTestConnection()}
                      disabled={testing}
                    >
                      {testing ? <LoaderCircle size={14} className="spin" /> : <Zap size={14} />}
                      测试连接
                    </button>
                    <span className="test-hint">会发送一次极小的真实请求</span>
                  </div>
                  {testResult && (
                    <div className={cn('test-result', testResult.ok ? 'ok' : 'error')}>
                      {testResult.ok ? <Check size={14} /> : <AlertTriangle size={14} />}
                      {testResult.message}
                    </div>
                  )}
                </div>
              </div>
  )
}
