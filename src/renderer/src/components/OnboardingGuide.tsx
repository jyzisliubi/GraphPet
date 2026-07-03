import { useEffect, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import type { AppSettings } from '../../env'

export interface OnboardingGuideProps {
  visible: boolean
  onComplete: (settings: Partial<AppSettings>) => void
}

type OllamaStatus = 'idle' | 'checking' | 'ok' | 'no_model' | 'fail'
type PullState = 'idle' | 'pulling' | 'done' | 'fail'
type Mode = 'freellm' | 'cloud' | 'local' | null

interface CloudPreset {
  label: string
  base: string
  model: string
  noKey?: boolean
  signupUrl?: string
  hint?: string
  provider?: string
}

const CLOUD_PRESETS: Record<string, CloudPreset> = {
  pollinations: {
    label: 'Pollinations（免注册）',
    base: 'https://text.pollinations.ai/openai',
    model: 'openai-fast',
    noKey: true,
    hint: '完全免费，无需注册，无需API Key'
  },
  siliconflow: {
    label: '硅基流动（免费Qwen）',
    base: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    signupUrl: 'https://cloud.siliconflow.cn',
    hint: '注册即送2000万Token，Qwen2.5-7B永久免费'
  },
  aliyun: {
    label: '阿里通义（免费额度）',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-turbo',
    signupUrl: 'https://dashscope.console.aliyun.com',
    hint: '新用户送100万Token，qwen-turbo有免费额度'
  },
  deepseek: {
    label: 'DeepSeek',
    base: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    signupUrl: 'https://platform.deepseek.com',
    hint: '新用户送500万Token，推理能力强'
  },
  zhipu: {
    label: '智谱AI（GLM-4-Flash免费）',
    base: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    signupUrl: 'https://open.bigmodel.cn',
    hint: 'GLM-4-Flash永久免费'
  },
  moonshot: {
    label: 'Kimi（月之暗面）',
    base: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    signupUrl: 'https://platform.moonshot.cn',
    hint: '新用户送15元额度'
  },
  openai: {
    label: 'OpenAI',
    base: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '需要海外网络和API Key'
  },
  freellmapi: {
    label: 'FreeLLMAPI（本地代理）',
    base: 'http://localhost:3001/v1',
    model: 'auto',
    noKey: true,
    hint: '如果你在本地运行了FreeLLMAPI代理'
  },
  custom: { label: '自定义', base: '', model: '' }
}

const PROVIDER_MAP: Record<string, string> = {
  pollinations: 'pollinations',
  siliconflow: 'siliconflow',
  aliyun: 'aliyun',
  deepseek: 'deepseek',
  zhipu: 'zhipu',
  moonshot: 'moonshot',
  openai: 'openai',
  freellmapi: 'freellmapi',
  custom: 'openai-compatible'
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.7)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
  pointerEvents: 'auto'
}

const cardStyle: CSSProperties = {
  width: 440,
  maxHeight: '92vh',
  overflowY: 'auto',
  boxSizing: 'border-box',
  padding: 28,
  background: '#18181b',
  border: '1px solid #27272a',
  borderRadius: 18,
  boxShadow: '0 24px 70px rgba(0, 0, 0, 0.6)',
  color: '#e4e4e7',
  userSelect: 'none'
}

const titleStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: '#e4e4e7',
  margin: 0,
  textAlign: 'center'
}

const subtitleStyle: CSSProperties = {
  fontSize: 13,
  color: '#a1a1aa',
  marginTop: 6,
  marginBottom: 20,
  textAlign: 'center'
}

const modeCardBase: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '14px 18px',
  borderRadius: 14,
  border: '2px solid #3f3f46',
  background: '#27272a',
  cursor: 'pointer',
  transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
  marginBottom: 10,
  position: 'relative'
}

const modeIconStyle: CSSProperties = {
  fontSize: 28,
  lineHeight: 1,
  flexShrink: 0
}

const modeTitleStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: '#e4e4e7',
  margin: 0
}

const modeDescStyle: CSSProperties = {
  fontSize: 12,
  color: '#a1a1aa',
  marginTop: 3
}

const recommendBadge: CSSProperties = {
  position: 'absolute',
  top: -8,
  right: 12,
  background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
  color: '#fff',
  fontSize: 10,
  fontWeight: 700,
  padding: '2px 8px',
  borderRadius: 8,
  letterSpacing: 0.5
}

const expandAreaStyle: CSSProperties = {
  padding: '4px 4px 10px',
  marginBottom: 10
}

const fieldStyle: CSSProperties = {
  marginBottom: 10
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#a1a1aa',
  marginBottom: 5
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  fontSize: 13,
  color: '#e4e4e7',
  background: '#27272a',
  border: '1px solid #3f3f46',
  borderRadius: 8,
  outline: 'none',
  transition: 'border-color 0.15s, box-shadow 0.15s'
}

const selectStyle: CSSProperties = {
  ...inputStyle,
  appearance: 'auto',
  cursor: 'pointer'
}

const primaryButtonBase: CSSProperties = {
  width: '100%',
  padding: '11px 0',
  fontSize: 14,
  fontWeight: 600,
  color: '#ffffff',
  border: 'none',
  borderRadius: 10,
  cursor: 'pointer',
  transition: 'filter 0.15s'
}

const freeGradient: CSSProperties = {
  ...primaryButtonBase,
  background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
  boxShadow: '0 4px 14px rgba(245, 158, 11, 0.4)'
}

const localGradient: CSSProperties = {
  ...primaryButtonBase,
  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
  boxShadow: '0 4px 12px rgba(34, 197, 94, 0.35)'
}

const cloudGradient: CSSProperties = {
  ...primaryButtonBase,
  background: '#6366f1',
  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)'
}

const secondaryButtonStyle: CSSProperties = {
  width: '100%',
  padding: '9px 0',
  fontSize: 13,
  fontWeight: 500,
  color: '#a1a1aa',
  background: '#27272a',
  border: '1px solid #3f3f46',
  borderRadius: 10,
  cursor: 'pointer',
  transition: 'background 0.15s'
}

const statusOkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: '#22c55e',
  fontWeight: 500,
  marginBottom: 10
}

const statusFailStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: '#fca5a5',
  fontWeight: 500,
  marginBottom: 6
}

const hintStyle: CSSProperties = {
  fontSize: 12,
  color: '#a1a1aa',
  marginBottom: 10,
  lineHeight: 1.5
}

const linkStyle: CSSProperties = {
  color: '#818cf8',
  textDecoration: 'underline',
  cursor: 'pointer'
}

const checkingStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: '#a1a1aa',
  marginBottom: 10
}

const footerTextStyle: CSSProperties = {
  marginTop: 14,
  fontSize: 11,
  color: '#71717a',
  textAlign: 'center'
}

const pullTrackStyle: CSSProperties = {
  width: '100%',
  height: 8,
  background: '#27272a',
  borderRadius: 4,
  marginTop: 10,
  overflow: 'hidden'
}

const pullMessageStyle: CSSProperties = {
  fontSize: 12,
  color: '#a1a1aa',
  marginTop: 6,
  textAlign: 'center'
}

const freeHighlightStyle: CSSProperties = {
  padding: '12px 14px',
  background: 'rgba(245, 158, 11, 0.08)',
  border: '1px solid rgba(245, 158, 11, 0.25)',
  borderRadius: 10,
  marginBottom: 12,
  fontSize: 12,
  color: '#fbbf24',
  lineHeight: 1.6
}

export default function OnboardingGuide({
  visible,
  onComplete
}: OnboardingGuideProps): JSX.Element | null {
  const [selectedMode, setSelectedMode] = useState<Mode>('freellm')
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>('idle')
  const [requiredModel, setRequiredModel] = useState<string>('qwen2.5:7b')
  const [pullState, setPullState] = useState<PullState>('idle')
  const [pullProgress, setPullProgress] = useState<number>(0)
  const [pullMessage, setPullMessage] = useState<string>('')

  const [cloudProvider, setCloudProvider] = useState<string>('pollinations')
  const [cloudBase, setCloudBase] = useState<string>(CLOUD_PRESETS.pollinations.base)
  const [cloudKey, setCloudKey] = useState<string>('')
  const [cloudModel, setCloudModel] = useState<string>(CLOUD_PRESETS.pollinations.model)

  const checkOllama = async (): Promise<void> => {
    setOllamaStatus('checking')
    try {
      const res = await fetch('http://127.0.0.1:8765/ollama/status')
      if (!res.ok) {
        setOllamaStatus('fail')
        return
      }
      const data = (await res.json()) as {
        running: boolean
        models: string[]
        has_required_model: boolean
        required_model: string
      }
      setRequiredModel(data.required_model || 'qwen2.5:7b')
      if (!data.running) {
        setOllamaStatus('fail')
      } else if (data.has_required_model) {
        setOllamaStatus('ok')
      } else {
        setOllamaStatus('no_model')
      }
    } catch (err) {
      console.error('[OnboardingGuide] 检测 Ollama 失败:', err)
      setOllamaStatus('fail')
    }
  }

  const handlePullModel = async (): Promise<void> => {
    if (pullState === 'pulling') return
    setPullState('pulling')
    setPullProgress(0)
    setPullMessage('开始拉取...')
    try {
      const res = await fetch('http://127.0.0.1:8765/ollama/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: requiredModel })
      })
      if (!res.ok || !res.body) {
        setPullState('fail')
        setPullMessage(`请求失败: HTTP ${res.status}`)
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      let success = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let sepIdx: number
        while ((sepIdx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, sepIdx)
          buffer = buffer.slice(sepIdx + 2)
          let event = 'stage'
          const dataLines: string[] = []
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
          }
          if (dataLines.length === 0) continue
          try {
            const d = JSON.parse(dataLines.join('\n')) as {
              status: string
              progress: number
              message: string
            }
            if (event === 'done') {
              success = true
              setPullProgress(100)
              setPullMessage(d.message || '拉取完成')
              setPullState('done')
              setTimeout(() => void checkOllama(), 500)
            } else if (event === 'error') {
              setPullState('fail')
              setPullMessage(d.message || '拉取失败')
            } else {
              setPullProgress(d.progress)
              setPullMessage(d.message)
            }
          } catch {
          }
        }
      }
      if (!success && pullState !== 'fail') {
        setPullState('fail')
        setPullMessage('连接中断')
      }
    } catch (err) {
      setPullState('fail')
      setPullMessage(
        `拉取失败: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  useEffect(() => {
    if (selectedMode === 'local' && ollamaStatus === 'idle') {
      void checkOllama()
    }
  }, [selectedMode])

  if (!visible) return null

  const handleProviderChange = (key: string): void => {
    setCloudProvider(key)
    const preset = CLOUD_PRESETS[key]
    if (preset) {
      setCloudBase(preset.base)
      if (key !== 'custom') setCloudModel(preset.model)
    }
  }

  const handleConfirmFreeLLM = (): void => {
    onComplete({
      llmProvider: 'freellm',
      llmModel: 'auto',
      llmApiBase: '',
      llmApiKey: ''
    })
  }

  const handleConfirmLocal = (): void => {
    onComplete({
      llmProvider: 'ollama',
      llmModel: 'qwen2.5:7b',
      llmApiBase: 'http://localhost:11434',
      llmApiKey: ''
    })
  }

  const handleConfirmCloud = (): void => {
    const provider = PROVIDER_MAP[cloudProvider] || 'openai-compatible'
    onComplete({
      llmProvider: provider as AppSettings['llmProvider'],
      llmModel: cloudModel.trim() || 'auto',
      llmApiBase: cloudBase.trim(),
      llmApiKey: cloudKey.trim()
    })
  }

  const cloudReady = cloudBase.trim().length > 0 &&
    (CLOUD_PRESETS[cloudProvider]?.noKey || cloudKey.trim().length > 0)

  const getCardStyle = (mode: Mode, activeColor: string): CSSProperties => ({
    ...modeCardBase,
    ...(selectedMode === mode
      ? {
          borderColor: activeColor,
          background: activeColor === '#f59e0b'
            ? 'rgba(245, 158, 11, 0.1)'
            : activeColor === '#22c55e'
            ? 'rgba(34, 197, 94, 0.1)'
            : 'rgba(99, 102, 241, 0.1)',
          boxShadow: `0 4px 12px ${activeColor}33`
        }
      : {})
  })

  return (
    <div style={overlayStyle}>
      <div style={cardStyle} role="dialog" aria-modal="true">
        <h2 style={titleStyle}>欢迎使用 GraphPet 🐾</h2>
        <p style={subtitleStyle}>选择你的 AI 大脑配置方式，开始养宠</p>

        {/* 🚀 国内免费零配置 —— 推荐首选 */}
        <div
          style={getCardStyle('freellm', '#f59e0b')}
          onClick={() => setSelectedMode('freellm')}
          onMouseEnter={(e) => {
            if (selectedMode !== 'freellm') {
              ;(e.currentTarget as HTMLDivElement).style.borderColor = '#f59e0b'
            }
          }}
          onMouseLeave={(e) => {
            if (selectedMode !== 'freellm') {
              ;(e.currentTarget as HTMLDivElement).style.borderColor = '#3f3f46'
            }
          }}
        >
          <div style={recommendBadge}>推荐</div>
          <span style={modeIconStyle}>🚀</span>
          <div>
            <p style={modeTitleStyle}>国内免费（零配置·开箱即用）</p>
            <p style={modeDescStyle}>内置免费API聚合，自动选择最优服务，无需注册不用下载</p>
          </div>
        </div>

        {selectedMode === 'freellm' && (
          <div style={expandAreaStyle}>
            <div style={freeHighlightStyle}>
              ✨ 一键开始，无需任何配置！<br/>
              内置国内免费大模型聚合服务，自动故障转移，开箱即用。<br/>
              需要更稳定/更强模型？可随时在设置中切换。
            </div>
            <button
              style={freeGradient}
              onClick={handleConfirmFreeLLM}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.1)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.filter = 'none'
              }}
            >
              🎉 一键开始使用
            </button>
          </div>
        )}

        {/* ☁️ 云端API —— 有Key的用户 */}
        <div
          style={getCardStyle('cloud', '#6366f1')}
          onClick={() => setSelectedMode('cloud')}
          onMouseEnter={(e) => {
            if (selectedMode !== 'cloud') {
              ;(e.currentTarget as HTMLDivElement).style.borderColor = '#6366f1'
            }
          }}
          onMouseLeave={(e) => {
            if (selectedMode !== 'cloud') {
              ;(e.currentTarget as HTMLDivElement).style.borderColor = '#3f3f46'
            }
          }}
        >
          <span style={modeIconStyle}>☁️</span>
          <div>
            <p style={modeTitleStyle}>云端 API（自己有Key）</p>
            <p style={modeDescStyle}>硅基流动/通义/DeepSeek/智谱/Kimi/OpenAI等</p>
          </div>
        </div>

        {selectedMode === 'cloud' && (
          <div style={expandAreaStyle}>
            <div style={fieldStyle}>
              <label style={labelStyle}>服务商</label>
              <select
                style={selectStyle}
                value={cloudProvider}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  handleProviderChange(e.target.value)
                }
              >
                <option value="pollinations">Pollinations（免注册·免费）</option>
                <option value="siliconflow">硅基流动（免费Qwen2.5-7B）</option>
                <option value="zhipu">智谱AI（GLM-4-Flash免费）</option>
                <option value="aliyun">阿里通义（免费额度）</option>
                <option value="deepseek">DeepSeek（推理强）</option>
                <option value="moonshot">Kimi月之暗面</option>
                <option value="openai">OpenAI</option>
                <option value="freellmapi">FreeLLMAPI本地代理</option>
                <option value="custom">自定义</option>
              </select>
            </div>
            {CLOUD_PRESETS[cloudProvider]?.hint && (
              <p style={hintStyle}>
                {CLOUD_PRESETS[cloudProvider].hint}
                {CLOUD_PRESETS[cloudProvider].signupUrl && (
                  <span
                    style={linkStyle}
                    onClick={() => {
                      window.open(CLOUD_PRESETS[cloudProvider].signupUrl!, '_blank')
                    }}
                  >
                    {' '}前往注册 →
                  </span>
                )}
              </p>
            )}
            <div style={fieldStyle}>
              <label style={labelStyle}>API Base URL</label>
              <input
                type="text"
                style={inputStyle}
                value={cloudBase}
                placeholder="https://api.example.com/v1"
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCloudBase(e.target.value)}
              />
            </div>
            {!CLOUD_PRESETS[cloudProvider]?.noKey && (
              <div style={fieldStyle}>
                <label style={labelStyle}>API Key</label>
                <input
                  type="password"
                  style={inputStyle}
                  value={cloudKey}
                  placeholder="sk-..."
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCloudKey(e.target.value)}
                />
              </div>
            )}
            <div style={fieldStyle}>
              <label style={labelStyle}>模型名称</label>
              <input
                type="text"
                style={inputStyle}
                value={cloudModel}
                placeholder="auto"
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCloudModel(e.target.value)}
              />
            </div>
            <button
              style={{
                ...cloudGradient,
                ...(cloudReady ? {} : { opacity: 0.5, cursor: 'not-allowed', boxShadow: 'none' })
              }}
              disabled={!cloudReady}
              onClick={handleConfirmCloud}
              onMouseEnter={(e) => {
                if (cloudReady) {
                  ;(e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.1)'
                }
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.filter = 'none'
              }}
            >
              使用此配置
            </button>
          </div>
        )}

        {/* 🏠 本地模式 —— Ollama完全离线 */}
        <div
          style={getCardStyle('local', '#22c55e')}
          onClick={() => setSelectedMode('local')}
          onMouseEnter={(e) => {
            if (selectedMode !== 'local') {
              ;(e.currentTarget as HTMLDivElement).style.borderColor = '#22c55e'
            }
          }}
          onMouseLeave={(e) => {
            if (selectedMode !== 'local') {
              ;(e.currentTarget as HTMLDivElement).style.borderColor = '#3f3f46'
            }
          }}
        >
          <span style={modeIconStyle}>🏠</span>
          <div>
            <p style={modeTitleStyle}>本地模式（Ollama）</p>
            <p style={modeDescStyle}>完全离线，数据不出本机，需安装 Ollama + 下载4.7GB模型</p>
          </div>
        </div>

        {selectedMode === 'local' && (
          <div style={expandAreaStyle}>
            {ollamaStatus === 'checking' && (
              <div style={checkingStyle}>
                <span>⏳</span>
                <span>正在检测 Ollama 状态…</span>
              </div>
            )}
            {ollamaStatus === 'ok' && (
              <div style={statusOkStyle}>
                <span>✓</span>
                <span>Ollama 就绪，模型 {requiredModel} 已就位</span>
              </div>
            )}
            {ollamaStatus === 'no_model' && (
              <>
                <div style={statusFailStyle}>
                  <span>⚠️</span>
                  <span>Ollama 已运行，但缺少模型 {requiredModel}</span>
                </div>
                <p style={hintStyle}>需要拉取模型（约4.7GB，首次较慢）</p>
              </>
            )}
            {ollamaStatus === 'fail' && (
              <>
                <div style={statusFailStyle}>
                  <span>✗</span>
                  <span>未检测到 Ollama 服务</span>
                </div>
                <p style={hintStyle}>
                  请先安装并启动 Ollama：
                  <span
                    style={linkStyle}
                    onClick={() => {
                      window.open('https://ollama.com', '_blank')
                    }}
                  >
                    https://ollama.com
                  </span>
                </p>
              </>
            )}

            {(pullState === 'pulling' || pullState === 'done' || pullState === 'fail') && (
              <div style={{ marginBottom: 12 }}>
                <div style={pullTrackStyle}>
                  <div
                    style={{
                      height: '100%',
                      width: `${pullProgress}%`,
                      background:
                        pullState === 'fail'
                          ? '#ef4444'
                          : pullState === 'done'
                          ? '#22c55e'
                          : '#6366f1',
                      borderRadius: 4,
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>
                <div style={pullMessageStyle}>
                  {pullState === 'pulling' && `${pullProgress}% - ${pullMessage}`}
                  {pullState === 'done' && `✓ ${pullMessage}`}
                  {pullState === 'fail' && `✗ ${pullMessage}`}
                </div>
              </div>
            )}

            {ollamaStatus === 'ok' && (
              <button
                style={localGradient}
                onClick={handleConfirmLocal}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.1)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.filter = 'none'
                }}
              >
                使用本地模式
              </button>
            )}
            {ollamaStatus === 'no_model' && pullState !== 'pulling' && pullState !== 'done' && (
              <button
                style={localGradient}
                onClick={() => void handlePullModel()}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.1)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.filter = 'none'
                }}
              >
                ⬇ 一键拉取模型 {requiredModel}
              </button>
            )}
            {ollamaStatus === 'ok' && pullState === 'done' && (
              <button
                style={localGradient}
                onClick={handleConfirmLocal}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.1)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.filter = 'none'
                }}
              >
                使用本地模式
              </button>
            )}
            {ollamaStatus === 'fail' && (
              <button
                style={secondaryButtonStyle}
                onClick={() => void checkOllama()}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background = '#3f3f46'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background = '#27272a'
                }}
              >
                我已安装，重新检测
              </button>
            )}
          </div>
        )}

        <p style={footerTextStyle}>所有设置可在设置面板中随时修改 · FreeLLM API CN 内置聚合</p>
      </div>
    </div>
  )
}
