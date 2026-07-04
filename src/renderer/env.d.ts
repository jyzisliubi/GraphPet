/// <reference types="vite/client" />

/** LLM 服务提供方 */
export type LlmProvider = 'freellm' | 'deepseek' | 'zhipu' | 'kimi' | 'siliconflow' | 'openai' | 'openai-compatible' | 'custom' | 'ollama'

/** 应用设置 Schema（与 main 进程和 settingsStore 中的定义保持结构一致） */
export interface AppSettings {
  llmProvider: LlmProvider
  llmModel: string
  llmApiBase: string
  llmApiKey: string
  llmTemperature: number
  proactiveIntervalMin: number
  quietMode: boolean
  autoStart: boolean
  petScale: number
  /** TTS 语音播报开关 */
  ttsEnabled: boolean
  /** TTS 语音角色（edge-tts ShortName） */
  ttsVoice: string
}

export interface GraphPetAPI {
  windowMove: (x: number, y: number) => void
  setIgnoreMouseEvents: (ignore: boolean) => void
  forceInteractive: (active: boolean) => void
  onContextMenu: (callback: (params: { x: number; y: number }) => void) => () => void
  getLive2DModelPath: () => Promise<{ path: string | null; format: 'cubism2' | 'cubism4' | null }>
  getLive2DSkins: () => Promise<Array<{ name: string; path: string; format: 'cubism2' | 'cubism4' }>>
  getSettings: () => Promise<AppSettings>
  setSettings: (settings: AppSettings) => Promise<void>
  isFirstRun: () => Promise<boolean>
  checkOllama: () => Promise<{ installed: boolean; running: boolean }>
  openFileDialog: () => Promise<string[]>
  getPathForFile: (file: File) => string | undefined
  quit: () => void
  openPanel: (route?: string) => void
  openChat: () => void
  closeChat: () => void
  minimizeChat: () => void
  petClick: (data: { x: number; y: number }) => void
  onPetClicked: (callback: (data: { x: number; y: number }) => void) => () => void
  sendEmotion: (emotion: string) => void
  onEmotion: (callback: (emotion: string) => void) => () => void
  petWalkStart: () => void
  petWalkStop: () => void
}

declare global {
  interface Window {
    api: GraphPetAPI
  }
}

export {}
