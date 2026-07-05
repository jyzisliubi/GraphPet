import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useRef
} from 'react'
import type { ReactNode, Dispatch } from 'react'

// 设置状态管理（Task 9）
//
// package.json 未引入 zustand，故采用 useReducer + Context 方案。
// 该 Store 作为渲染进程的全局设置缓存：首次挂载时通过 IPC 从主进程
// 加载 graphpet_state.json 中的 settings 字段，并提供 saveSettings /
// updateSettings 写回主进程。SettingsPanel 等组件可读取全局设置，
// 也可在保存时调用 saveSettings 持久化。

/** LLM 服务提供方 */
export type LlmProvider =
  | 'freellm'
  | 'freellmapi'
  | 'pollinations'
  | 'siliconflow'
  | 'ollama'
  | 'aliyun'
  | 'deepseek'
  | 'zhipu'
  | 'moonshot'
  | 'openai'
  | 'openai-compatible'
  | 'custom'

/** 应用设置 Schema（与 preload/main 中的定义保持结构一致） */
export interface AppSettings {
  // —— 模型配置 ——
  llmProvider: LlmProvider
  llmModel: string
  llmApiBase: string
  llmApiKey: string
  llmTemperature: number
  // —— 对话配置 ——
  /** 主动对话间隔（分钟） */
  proactiveIntervalMin: number
  /** 安静模式：开启后不主动说话 */
  quietMode: boolean
  // —— 系统配置 ——
  /** 开机自启 */
  autoStart: boolean
  /** 宠物缩放系数 */
  petScale: number
  // —— 语音配置 ——
  /** TTS 语音播报开关（开启后 Nito 回答会用 TTS 朗读） */
  ttsEnabled: boolean
  /** TTS provider：edge（微软免费在线）/ piper（本地离线） */
  ttsProvider: 'edge' | 'piper'
  /** TTS 语音角色（edge: ShortName 如 zh-CN-XiaoyiNeural；piper: 模型名如 zh_CN-huayan-medium） */
  ttsVoice: string
  /** VAD 语音打断开关（开启后用户说话时自动停止 TTS） */
  vadEnabled: boolean
  // —— 外观配置 ——
  /** 主题模式：dark / light / auto（跟随系统） */
  theme: 'dark' | 'light' | 'auto'
}

/** 默认设置（与主进程 main/index.ts 中的 DEFAULT_SETTINGS 保持一致） */
export const DEFAULT_SETTINGS: AppSettings = {
  llmProvider: 'freellm',
  llmModel: 'auto',
  llmApiBase: '',
  llmApiKey: '',
  llmTemperature: 0.7,
  proactiveIntervalMin: 10,
  quietMode: false,
  autoStart: false,
  petScale: 1.0,
  ttsEnabled: false,
  ttsProvider: 'edge',
  ttsVoice: 'zh-CN-XiaoyiNeural',
  vadEnabled: false,
  theme: 'dark'
}

/** Reducer Action 类型 */
type SettingsAction =
  | { type: 'set'; settings: AppSettings } // 整体替换（加载 / 保存回写）
  | { type: 'patch'; patch: Partial<AppSettings> } // 局部更新

function settingsReducer(state: AppSettings, action: SettingsAction): AppSettings {
  switch (action.type) {
    case 'set':
      return action.settings
    case 'patch':
      return { ...state, ...action.patch }
    default:
      return state
  }
}

/** Context 暴露给消费方的值 */
interface SettingsContextValue {
  /** 当前设置（全局缓存） */
  settings: AppSettings
  /** 直接派发 action（不持久化，仅本地视图更新） */
  dispatch: Dispatch<SettingsAction>
  /** 从主进程加载设置到缓存 */
  loadSettings: () => Promise<void>
  /** 整体保存设置：写回主进程并更新缓存 */
  saveSettings: (next: AppSettings) => Promise<void>
  /** 局部更新并持久化：合并 patch 后写回主进程 */
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

/**
 * 设置 Provider：应在应用根部（App.tsx）包裹。
 * 首次挂载自动从主进程加载设置。
 */
export function SettingsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [settings, dispatch] = useReducer(settingsReducer, DEFAULT_SETTINGS)

  /**
   * P3-8 修复：用 ref 镜像最新 settings，避免 updateSettings 闭包捕获旧 settings
   * 导致并发调用 race（quietMode + autoStart 同时触发时后者覆盖前者）。
   * ref 在 dispatch 前立即更新，确保下一次 updateSettings 读到最新值。
   */
  const settingsRef = useRef<AppSettings>(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const loadSettings = useCallback(async (): Promise<void> => {
    try {
      const loaded = await window.api.getSettings()
      settingsRef.current = loaded
      dispatch({ type: 'set', settings: loaded })
    } catch (err) {
      console.error('[settingsStore] 加载设置失败:', err)
    }
  }, [])

  const saveSettings = useCallback(async (next: AppSettings): Promise<void> => {
    try {
      settingsRef.current = next
      await window.api.setSettings(next)
      dispatch({ type: 'set', settings: next })
    } catch (err) {
      console.error('[settingsStore] 保存设置失败:', err)
    }
  }, [])

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>): Promise<void> => {
      // 基于 ref 最新值合并，避免并发调用基于同一份旧 settings 计算导致互相覆盖
      const next = { ...settingsRef.current, ...patch }
      settingsRef.current = next
      await window.api.setSettings(next)
      dispatch({ type: 'set', settings: next })
    },
    []
  )

  // 监听跨窗口 settings:changed 事件时也同步 ref
  useEffect(() => {
    if (!window.api?.onSettingsChanged) return
    const unsubscribe = window.api.onSettingsChanged((next) => {
      settingsRef.current = next
      dispatch({ type: 'set', settings: next })
    })
    return unsubscribe
  }, [dispatch])

  // 首次挂载加载设置
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  // 主题切换：把 theme 写到 <html data-theme="..."> 触发 CSS 变量覆盖
  useEffect(() => {
    const t = settings.theme || 'dark'
    document.documentElement.setAttribute('data-theme', t)
  }, [settings.theme])

  const value: SettingsContextValue = {
    settings,
    dispatch,
    loadSettings,
    saveSettings,
    updateSettings
  }

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

/** 消费设置 Context 的 Hook */
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) {
    throw new Error('useSettings 必须在 SettingsProvider 内部使用')
  }
  return ctx
}
