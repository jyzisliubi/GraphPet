import { useEffect, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { Eye, EyeOff, X } from 'lucide-react'
import { DEFAULT_SETTINGS } from '../stores/settingsStore'
import type { AppSettings, LlmProvider } from '../stores/settingsStore'
import { getLocale, setLocale, useT, type Locale } from '../i18n'
import { useSettings } from '../stores/settingsStore'

export interface SettingsPanelProps {
  visible: boolean
  onClose: () => void
  onSave: (settings: AppSettings) => void
}

const SETTINGS_PANEL_CSS = `
.graphpet-settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  pointer-events: auto;
  animation: graphpet-settings-fade-in 0.15s ease-out;
}
@keyframes graphpet-settings-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.graphpet-settings-card {
  width: 100%;
  max-width: 480px;
  max-height: 80vh;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 24px;
  background: #18181b;
  border: 1px solid #27272a;
  border-radius: 16px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
  color: #e4e4e7;
  user-select: none;
  animation: graphpet-settings-slide-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes graphpet-settings-slide-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.graphpet-settings-card::-webkit-scrollbar {
  width: 6px;
}
.graphpet-settings-card::-webkit-scrollbar-thumb {
  background: #3f3f46;
  border-radius: 3px;
}
.graphpet-settings-card::-webkit-scrollbar-track {
  background: transparent;
}
.graphpet-settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.graphpet-settings-title {
  font-size: 20px;
  font-weight: 600;
  color: #fafafa;
  margin: 0;
}
.graphpet-settings-close-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #71717a;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  flex-shrink: 0;
}
.graphpet-settings-close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #e4e4e7;
}
.graphpet-settings-group-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #a1a1aa;
  margin: 20px 0 10px;
}
.graphpet-settings-group-title:first-child {
  margin-top: 0;
}
.graphpet-settings-field {
  margin-bottom: 14px;
}
.graphpet-settings-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #e4e4e7;
  margin-bottom: 6px;
}
.graphpet-settings-desc {
  font-size: 12px;
  color: #71717a;
  margin-top: 4px;
}
.graphpet-settings-input-wrap {
  position: relative;
}
.graphpet-settings-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 14px;
  font-size: 14px;
  color: #e4e4e7;
  background: #27272a;
  border: 1px solid #3f3f46;
  border-radius: 10px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  font-family: inherit;
}
.graphpet-settings-input::placeholder {
  color: #71717a;
}
.graphpet-settings-input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
}
.graphpet-settings-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.graphpet-settings-input-with-icon {
  padding-right: 44px;
}
.graphpet-settings-input-icon-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #71717a;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.graphpet-settings-input-icon-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #e4e4e7;
}
.graphpet-settings-select {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 14px;
  font-size: 14px;
  color: var(--gp-text);
  background: var(--gp-bg-subtle);
  border: 1px solid var(--gp-border);
  border-radius: 10px;
  outline: none;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  font-family: inherit;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 36px;
}
.graphpet-settings-select:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
}
.graphpet-settings-select option {
  background: var(--gp-bg-card);
  color: var(--gp-text);
}
.graphpet-settings-slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.graphpet-settings-slider {
  flex: 1;
  height: 20px;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
}
.graphpet-settings-slider::-webkit-slider-runnable-track {
  width: 100%;
  height: 6px;
  background: #3f3f46;
  border-radius: 3px;
}
.graphpet-settings-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  background: #6366f1;
  border-radius: 50%;
  margin-top: -6px;
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
.graphpet-settings-slider::-webkit-slider-thumb:hover {
  background: #818cf8;
  transform: scale(1.1);
}
.graphpet-settings-slider::-moz-range-track {
  width: 100%;
  height: 6px;
  background: #3f3f46;
  border-radius: 3px;
}
.graphpet-settings-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  background: #6366f1;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
.graphpet-settings-slider::-moz-range-thumb:hover {
  background: #818cf8;
  transform: scale(1.1);
}
.graphpet-settings-slider-value {
  min-width: 56px;
  text-align: right;
  font-size: 13px;
  color: #a1a1aa;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}
.graphpet-settings-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
}
.graphpet-settings-toggle-label {
  font-size: 14px;
  font-weight: 500;
  color: #e4e4e7;
}
.graphpet-settings-toggle {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 12px;
  background: #3f3f46;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}
.graphpet-settings-toggle--checked {
  background: #6366f1;
}
.graphpet-settings-toggle--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.graphpet-settings-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: left 0.2s;
}
.graphpet-settings-toggle--checked .graphpet-settings-toggle-knob {
  left: 22px;
}
.graphpet-settings-divider {
  height: 1px;
  background: #27272a;
  border: none;
  margin: 16px 0;
}
.graphpet-settings-footer {
  display: flex;
  gap: 10px;
  margin-top: 24px;
}
.graphpet-settings-btn {
  flex: 1;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.graphpet-settings-btn-cancel {
  background: transparent;
  border: 1px solid #3f3f46;
  color: #a1a1aa;
}
.graphpet-settings-btn-cancel:hover {
  border-color: #52525b;
  color: #e4e4e7;
  background: rgba(255, 255, 255, 0.05);
}
.graphpet-settings-btn-import,
.graphpet-settings-btn-export {
  background: transparent;
  border: 1px solid #3f3f46;
  color: #a1a1aa;
  padding: 0 12px;
  font-size: 12px;
}
.graphpet-settings-btn-import:hover {
  border-color: #6366f1;
  color: #c7d2fe;
  background: rgba(99, 102, 241, 0.08);
}
.graphpet-settings-btn-export:hover {
  border-color: #10b981;
  color: #86efac;
  background: rgba(16, 185, 129, 0.08);
}
.graphpet-settings-btn-save {
  background: #6366f1;
  border: none;
  color: #ffffff;
}
.graphpet-settings-btn-save:hover {
  background: #818cf8;
}
.graphpet-settings-btn-save:active {
  background: #4f46e5;
}
.graphpet-settings-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
`

function Toggle({
  checked,
  onChange,
  disabled
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <div
      className={`graphpet-settings-toggle ${checked ? 'graphpet-settings-toggle--checked' : ''} ${disabled ? 'graphpet-settings-toggle--disabled' : ''}`}
      onClick={() => {
        if (!disabled) onChange(!checked)
      }}
      role="switch"
      aria-checked={checked}
    >
      <div className="graphpet-settings-toggle-knob" />
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  rightIcon
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'password'
  disabled?: boolean
  rightIcon?: ReactNode
}): JSX.Element {
  return (
    <div className="graphpet-settings-field">
      <label className="graphpet-settings-label">{label}</label>
      <div className="graphpet-settings-input-wrap">
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          className={`graphpet-settings-input ${rightIcon ? 'graphpet-settings-input-with-icon' : ''}`}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        />
        {rightIcon}
      </div>
    </div>
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format: (v: number) => string
}): JSX.Element {
  return (
    <div className="graphpet-settings-field">
      <label className="graphpet-settings-label">{label}</label>
      <div className="graphpet-settings-slider-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          className="graphpet-settings-slider"
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
        />
        <span className="graphpet-settings-slider-value">{format(value)}</span>
      </div>
    </div>
  )
}

function ToggleField({
  label,
  checked,
  onChange,
  disabled
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <div className="graphpet-settings-toggle-row">
      <span className="graphpet-settings-toggle-label">{label}</span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  )
}

function GroupTitle({ children }: { children: ReactNode }): JSX.Element {
  return <div className="graphpet-settings-group-title">{children}</div>
}

function Divider(): JSX.Element {
  return <hr className="graphpet-settings-divider" />
}

let styleInjected = false

function injectStyles(): void {
  if (styleInjected) return
  const style = document.createElement('style')
  style.textContent = SETTINGS_PANEL_CSS
  document.head.appendChild(style)
  styleInjected = true
}

export default function SettingsPanel({
  visible,
  onClose,
  onSave
}: SettingsPanelProps): JSX.Element | null {
  const [draft, setDraft] = useState<AppSettings>(DEFAULT_SETTINGS)
  /** 打开时加载的初始设置快照，用于检测是否有未保存改动（P3-6） */
  const [initialSettings, setInitialSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState<boolean>(false)
  const [showApiKey, setShowApiKey] = useState<boolean>(false)
  const [currentLocale, setCurrentLocale] = useState<Locale>(getLocale())
  const t = useT()
  const { updateSettings } = useSettings()

  useEffect(() => {
    injectStyles()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setLoading(true)
    window.api
      .getSettings()
      .then((s) => {
        if (!cancelled) {
          setDraft(s)
          setInitialSettings(s)
        }
      })
      .catch((err) => {
        console.error('[SettingsPanel] 读取设置失败:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [visible])

  /** 是否有未保存改动（draft 与初始快照不一致） */
  const isDirty = JSON.stringify(draft) !== JSON.stringify(initialSettings)

  /**
   * 关闭面板：若有未保存改动，弹原生确认对话框避免误丢。
   * 覆盖 ESC / 遮罩 click / X 按钮 / 取消按钮 四个关闭入口。
   */
  const handleClose = (): void => {
    if (isDirty) {
      const ok = window.confirm('当前设置尚未保存，确定要放弃改动并关闭吗？')
      if (!ok) return
    }
    onClose()
  }

  useEffect(() => {
    if (!visible) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // handleClose 依赖 draft/initialSettings/isDirty，需要重新订阅
  }, [visible, isDirty])

  if (!visible) return null

  const patch = (p: Partial<AppSettings>): void => setDraft((d) => ({ ...d, ...p }))

  const providerPresets: Record<string, { model: string; apiBase: string }> = {
    freellm: { model: 'auto', apiBase: '' },
    pollinations: { model: 'openai-fast', apiBase: 'https://text.pollinations.ai/openai' },
    siliconflow: { model: 'Qwen/Qwen2.5-7B-Instruct', apiBase: 'https://api.siliconflow.cn/v1' },
    ollama: { model: 'qwen2.5:7b', apiBase: 'http://localhost:11434' },
    aliyun: { model: 'qwen-plus', apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    deepseek: { model: 'deepseek-chat', apiBase: 'https://api.deepseek.com/v1' },
    zhipu: { model: 'glm-4-flash', apiBase: 'https://open.bigmodel.cn/api/paas/v4' },
    moonshot: { model: 'moonshot-v1-8k', apiBase: 'https://api.moonshot.cn/v1' },
    openai: { model: 'gpt-4o-mini', apiBase: 'https://api.openai.com/v1' },
    freellmapi: { model: 'auto', apiBase: 'http://localhost:3001/v1' },
  }

  const handleProviderChange = (provider: string): void => {
    setShowApiKey(false)
    const preset = providerPresets[provider]
    if (preset) {
      setDraft((d) => ({ ...d, llmProvider: provider as LlmProvider, llmModel: preset.model, llmApiBase: preset.apiBase }))
    } else {
      patch({ llmProvider: provider as LlmProvider })
    }
  }

  const handleSave = (): void => {
    onSave(draft)
    // 同步 initialSettings，避免保存后 isDirty 仍为 true（用户再点关闭会误弹确认）
    setInitialSettings(draft)
    onClose()
  }

  // 配置导入：读取本地 JSON 文件覆盖 draft
  const handleExportSettings = async (): Promise<void> => {
    try {
      const json = JSON.stringify({ settings: draft, exportedAt: new Date().toISOString(), version: '0.3.6' }, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `graphpet-settings-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[SettingsPanel] 导出失败:', err)
      alert('导出失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  // 配置导入：弹出文件选择，读取 JSON 并覆盖 draft
  const handleImportSettings = async (): Promise<void> => {
    try {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json,.json'
      input.onchange = async (): Promise<void> => {
        const file = input.files?.[0]
        if (!file) return
        try {
          const text = await file.text()
          const parsed = JSON.parse(text) as { settings?: Partial<AppSettings> }
          if (!parsed.settings || typeof parsed.settings !== 'object') {
            alert('文件格式不正确：缺少 settings 字段')
            return
          }
          setDraft((d) => ({ ...d, ...parsed.settings }) as AppSettings)
          alert('已加载配置，请检查后点击保存生效')
        } catch (parseErr) {
          alert('解析失败: ' + (parseErr instanceof Error ? parseErr.message : String(parseErr)))
        }
      }
      input.click()
    } catch (err) {
      console.error('[SettingsPanel] 导入失败:', err)
      alert('导入失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const noKeyProviders = ['ollama', 'pollinations', 'freellmapi', 'freellm']
  const hideApiKey = noKeyProviders.includes(draft.llmProvider)
  const hideApiBase = draft.llmProvider === 'freellm'
  const hideModel = draft.llmProvider === 'freellm'

  return (
    <div className="graphpet-settings-overlay" onClick={handleClose}>
      <div
        className="graphpet-settings-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="graphpet-settings-header">
          <h2 className="graphpet-settings-title">GraphPet 设置</h2>
          <button
            className="graphpet-settings-close-btn"
            onClick={handleClose}
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>

        <GroupTitle>模型配置</GroupTitle>
        <div className="graphpet-settings-field">
          <label className="graphpet-settings-label">服务商</label>
          <select
            value={draft.llmProvider}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              handleProviderChange(e.target.value)
            }
          >
            <option value="freellm">🚀 国内免费（推荐·零配置）</option>
            <option value="pollinations">Pollinations（免注册·免费）</option>
            <option value="siliconflow">硅基流动（免费 Qwen2.5-7B）</option>
            <option value="ollama">Ollama（本地）</option>
            <option value="aliyun">阿里通义（免费额度）</option>
            <option value="deepseek">DeepSeek（深度求索）</option>
            <option value="zhipu">智谱 GLM</option>
            <option value="moonshot">月之暗面 Kimi</option>
            <option value="openai">OpenAI</option>
            <option value="freellmapi">FreeLLMAPI（本地代理）</option>
            <option value="openai-compatible">OpenAI 兼容（其他云端）</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        {draft.llmProvider === 'freellm' && (
          <div style={{ padding: '10px 12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, fontSize: 12, color: '#fbbf24', lineHeight: 1.6, marginBottom: 8 }}>
            ✨ 国内免费模式：内置免费大模型聚合，自动故障转移，无需配置，开箱即用！
          </div>
        )}
        {!hideModel && (
          <TextField
            label="模型名称"
            value={draft.llmModel}
            placeholder="qwen2:7b / gpt-4o-mini"
            onChange={(v) => patch({ llmModel: v })}
          />
        )}
        {!hideApiBase && (
          <TextField
            label="API Base URL"
            value={draft.llmApiBase}
            placeholder="http://localhost:11434/v1"
            onChange={(v) => patch({ llmApiBase: v })}
          />
        )}
        {!hideApiKey && (
          <TextField
            label="API Key"
            value={draft.llmApiKey}
            type={showApiKey ? 'text' : 'password'}
            placeholder="sk-..."
            onChange={(v) => patch({ llmApiKey: v })}
            rightIcon={
              <button
                type="button"
                className="graphpet-settings-input-icon-btn"
                onClick={() => setShowApiKey(!showApiKey)}
                aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
              >
                {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            }
          />
        )}
        <SliderField
          label="Temperature"
          value={draft.llmTemperature}
          min={0}
          max={2}
          step={0.1}
          onChange={(v) => patch({ llmTemperature: v })}
          format={(v) => v.toFixed(1)}
        />

        <Divider />

        <GroupTitle>对话配置</GroupTitle>
        <SliderField
          label="主动对话频率"
          value={draft.proactiveIntervalMin}
          min={5}
          max={120}
          step={1}
          onChange={(v) => patch({ proactiveIntervalMin: v })}
          format={(v) => `${v} 分钟`}
        />
        <ToggleField
          label="安静模式（不主动说话）"
          checked={draft.quietMode}
          onChange={(v) => patch({ quietMode: v })}
        />

        <Divider />

        <GroupTitle>系统配置</GroupTitle>
        <ToggleField
          label="开机自启"
          checked={draft.autoStart}
          onChange={(v) => patch({ autoStart: v })}
        />
        <SliderField
          label="缩放系数"
          value={draft.petScale}
          min={0.5}
          max={2}
          step={0.1}
          onChange={(v) => patch({ petScale: v })}
          format={(v) => `${v.toFixed(1)}×`}
        />

        <Divider />

        <GroupTitle>语音配置</GroupTitle>
        <ToggleField
          label="语音播报（Nito 回答时朗读）"
          checked={draft.ttsEnabled}
          onChange={(v) => patch({ ttsEnabled: v })}
        />
        <div className="graphpet-settings-field">
          <label className="graphpet-settings-label">TTS 引擎</label>
          <select
            className="graphpet-settings-select"
            value={draft.ttsProvider}
            onChange={(e) => {
              const provider = e.target.value as 'edge' | 'piper'
              patch({ ttsProvider: provider })
              // 切换 provider 时同步默认 voice
              if (provider === 'piper' && draft.ttsVoice.startsWith('zh-CN')) {
                patch({ ttsVoice: 'zh_CN-huayan-medium' })
              } else if (provider === 'edge' && !draft.ttsVoice.startsWith('zh-CN')) {
                patch({ ttsVoice: 'zh-CN-XiaoyiNeural' })
              }
            }}
          >
            <option value="edge">🌐 Edge TTS（在线，免费，多音色）</option>
            <option value="piper">🔒 Piper TTS（离线，隐私，首启下载模型）</option>
          </select>
        </div>
        <ToggleField
          label="语音打断（你说话时停止朗读，需麦克风）"
          checked={draft.vadEnabled}
          onChange={(v) => patch({ vadEnabled: v })}
        />

        <Divider />

        <GroupTitle>外观</GroupTitle>
        <div className="graphpet-settings-field">
          <label className="graphpet-settings-label">主题模式</label>
          <select
            className="graphpet-settings-select"
            value={draft.theme}
            onChange={(e) => patch({ theme: e.target.value as 'dark' | 'light' | 'auto' })}
          >
            <option value="dark">🌙 暗色（默认）</option>
            <option value="light">☀️ 亮色</option>
            <option value="auto">🖥 跟随系统</option>
          </select>
        </div>
        <div className="graphpet-settings-field">
          <label className="graphpet-settings-label">界面语言 / Language</label>
          <select
            className="graphpet-settings-select"
            value={currentLocale}
            onChange={(e) => {
              const locale = e.target.value as 'zh' | 'en'
              setLocale(locale)
              setCurrentLocale(locale)
              // 同步到 settings store，让主进程（tray 菜单）也能感知 locale 切换
              void updateSettings({ locale })
            }}
          >
            <option value="zh">🇨🇳 简体中文（默认）</option>
            <option value="en">🇺🇸 English</option>
          </select>
        </div>

        <div className="graphpet-settings-footer">
          <button
            className="graphpet-settings-btn graphpet-settings-btn-import"
            onClick={handleImportSettings}
            title="从 JSON 文件导入配置"
          >
            📥 导入
          </button>
          <button
            className="graphpet-settings-btn graphpet-settings-btn-export"
            onClick={handleExportSettings}
            title="导出当前配置为 JSON 文件"
          >
            📤 导出
          </button>
          <button
            className="graphpet-settings-btn graphpet-settings-btn-cancel"
            onClick={handleClose}
          >
            取消
          </button>
          <button
            className="graphpet-settings-btn graphpet-settings-btn-save"
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? '加载中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
