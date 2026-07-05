import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'

// 预加载脚本：通过 contextBridge 暴露安全 API 给渲染进程
// 对应 Task 4：窗口拖拽 / 鼠标穿透 / 右键菜单占位
// 对应 Task 9：设置读写（settings:get / settings:set）

// 应用设置 Schema（与渲染进程 settingsStore.ts 中的 AppSettings 保持结构一致）
// 此处单独定义是因为 preload 与 renderer 分属不同 tsconfig 工程，无法跨工程导入类型
export interface AppSettings {
  llmProvider: 'freellm' | 'deepseek' | 'zhipu' | 'kimi' | 'siliconflow' | 'openai' | 'openai-compatible' | 'custom' | 'ollama'
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
  /** VAD 语音打断开关 */
  vadEnabled: boolean
}

// IPC 通道名常量（与主进程保持一致）
const IPC_CHANNELS = {
  WINDOW_MOVE: 'window:move',
  FORCE_INTERACTIVE: 'window:force-interactive',
  CONTEXT_MENU: 'context-menu',
  LIVE2D_GET_MODEL_PATH: 'live2d:get-model-path',
  LIVE2D_GET_SKINS: 'live2d:get-skins',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  APP_IS_FIRST_RUN: 'app:is-first-run',
  SYSTEM_CHECK_OLLAMA: 'system:check-ollama',
  FEED_FILE_DIALOG: 'feed:file-dialog',
  APP_QUIT: 'app:quit',
  SCREENSHOT_CAPTURE: 'screenshot:capture',
  PANEL_OPEN: 'panel:open',
  CHAT_OPEN: 'chat:open',
  CHAT_CLOSE: 'chat:close',
  CHAT_MINIMIZE: 'chat:minimize',
  PET_CLICK: 'pet:click',
  PET_CLICKED: 'pet-clicked',
  PET_EMOTION: 'pet:emotion',
  PET_WALK_START: 'pet:walk-start',
  PET_WALK_STOP: 'pet:walk-stop',
  PET_WALK_TO: 'pet:walk-to',
  LIVE2D_IMPORT_MODEL: 'live2d:import-model',
  LIVE2D_LIST_IMPORTED: 'live2d:list-imported',
  LIVE2D_DELETE_IMPORTED: 'live2d:delete-imported'
} as const

const api = {
  // 移动窗口到指定坐标（屏幕坐标）
  windowMove: (x: number, y: number): void => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_MOVE, x, y)
  },
  // 通知主进程强制交互模式（浮层显示/拖拽时），主进程鼠标轮询会关闭穿透
  forceInteractive: (active: boolean): void => {
    ipcRenderer.send(IPC_CHANNELS.FORCE_INTERACTIVE, active ? 'force-on' : 'force-off')
  },
  // 监听右键菜单事件（Task 6）：主进程把右键坐标 {x, y} 发给渲染进程，
  // 回调接收该坐标，由 ContextMenu 组件据此定位
  onContextMenu: (callback: (params: { x: number; y: number }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, params: { x: number; y: number }): void => {
      callback(params)
    }
    ipcRenderer.on(IPC_CHANNELS.CONTEXT_MENU, listener)
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.CONTEXT_MENU, listener) }
  },
  // 获取 Live2D 模型路径
  // 主进程扫描 assets/live2d/nito/，优先返回 nito.model.json（Cubism 2）
  // 返回 { path: fileURL, format: 'cubism2'|'cubism4' } 或 { path: null, format: null }
  getLive2DModelPath: (): Promise<{ path: string | null; format: 'cubism2' | 'cubism4' | null }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.LIVE2D_GET_MODEL_PATH)
  },
  // 获取所有可用皮肤列表（换皮肤功能）
  // 主进程扫描 assets/live2d/nito/ 下的 .model.json 和 .model3.json
  // 返回 [{ name, path, format }] 数组；模型未就绪时返回空数组
  getLive2DSkins: (): Promise<Array<{ name: string; path: string; format: 'cubism2' | 'cubism4' }>> => {
    return ipcRenderer.invoke(IPC_CHANNELS.LIVE2D_GET_SKINS)
  },
  // 读取设置（Task 9）：从 graphpet_state.json 的 settings 字段读取，缺失则返回默认值
  getSettings: (): Promise<AppSettings> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET)
  },
  // 保存设置（Task 9）：写入 graphpet_state.json 的 settings 字段，
  // 并按 autoStart 同步系统开机自启项
  setSettings: (settings: AppSettings): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, settings)
  },
  // 首次启动检测（Task 10）：graphpet_state.json 不存在视为首次启动
  isFirstRun: (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.APP_IS_FIRST_RUN)
  },
  // 检测 Ollama 是否安装并运行（Task 10）
  // 主进程请求 http://127.0.0.1:11434/api/tags，能连上视为已安装并运行
  checkOllama: (): Promise<{ installed: boolean; running: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_CHECK_OLLAMA)
  },
  // 打开文件多选对话框（Task 14 占位 / Task 15 右键批量喂食用）
  // 主进程用 dialog.showOpenDialog 弹出系统文件选择框，返回用户选中的文件绝对路径数组；
  // 用户取消时返回空数组
  openFileDialog: (): Promise<string[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.FEED_FILE_DIALOG)
  },
  // 获取拖拽文件的本地绝对路径（Electron 31+ 推荐用 webUtils.getPathForFile，
  // 旧的 file.path 在打包版本可能失效，导致喂东西为不了）
  getPathForFile: (file: File): string | undefined => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      // 兜底：兼容旧版 Electron / 异常情况
      return (file as File & { path?: string }).path
    }
  },
  // 退出应用（Task 6 右键菜单"退出"项）
  quit: (): void => {
    ipcRenderer.send(IPC_CHANNELS.APP_QUIT)
  },
  // 截屏喂食：截取主屏幕，保存为临时 PNG 文件返回路径
  // 前端拿到路径后调用 feedFile(filePath) 走现有喂食管道
  captureScreenshot: (): Promise<{ success: boolean; filePath?: string; fileSize?: number; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SCREENSHOT_CAPTURE)
  },
  // 打开网页面板（Task 23）：通知主进程创建/聚焦独立 BrowserWindow，
  // route 可选，指定初始路由（'chat' | 'memory' | 'timeline' | 'files' | 'profile'）
  openPanel: (route?: string): void => {
    ipcRenderer.send(IPC_CHANNELS.PANEL_OPEN, route)
  },
  // 打开独立聊天小窗口
  openChat: (): void => {
    ipcRenderer.send(IPC_CHANNELS.CHAT_OPEN)
  },
  // 关闭聊天窗口
  closeChat: (): void => {
    ipcRenderer.send(IPC_CHANNELS.CHAT_CLOSE)
  },
  // 最小化聊天窗口
  minimizeChat: (): void => {
    ipcRenderer.send(IPC_CHANNELS.CHAT_MINIMIZE)
  },
  // 点击宠物（通知主进程转发点击事件）
  petClick: (data: { x: number; y: number }): void => {
    ipcRenderer.send(IPC_CHANNELS.PET_CLICK, data)
  },
  // 监听宠物被点击事件
  onPetClicked: (callback: (data: { x: number; y: number }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { x: number; y: number }): void => {
      callback(data)
    }
    ipcRenderer.on(IPC_CHANNELS.PET_CLICKED, listener)
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.PET_CLICKED, listener) }
  },
  // 发送表情变化事件（聊天窗口→宠物窗口，通过主进程中转）
  sendEmotion: (emotion: string): void => {
    ipcRenderer.send(IPC_CHANNELS.PET_EMOTION, emotion)
  },
  // 监听表情变化事件（宠物窗口接收，来自聊天窗口或主进程转发）
  onEmotion: (callback: (emotion: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, emotion: string): void => {
      callback(emotion)
    }
    ipcRenderer.on(IPC_CHANNELS.PET_EMOTION, listener)
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.PET_EMOTION, listener) }
  },
  // 启动桌宠自由走动（每隔 8~20s 自动选屏幕内随机目标点行走）
  petWalkStart: (): void => {
    ipcRenderer.send(IPC_CHANNELS.PET_WALK_START)
  },
  // 停止桌宠走动
  petWalkStop: (): void => {
    ipcRenderer.send(IPC_CHANNELS.PET_WALK_STOP)
  },
  // 让桌宠走到指定坐标（带动画过渡）
  petWalkTo: (x: number, y: number): void => {
    ipcRenderer.send(IPC_CHANNELS.PET_WALK_TO, x, y)
  },
  // 导入自定义 Live2D 模型（弹出文件选择，复制到 userData/imported-models）
  importLive2DModel: (): Promise<{ success: boolean; name?: string; path?: string; format?: 'cubism2' | 'cubism4'; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.LIVE2D_IMPORT_MODEL)
  },
  // 列出已导入的自定义模型
  listImportedLive2DModels: (): Promise<Array<{ name: string; path: string; format: 'cubism2' | 'cubism4' }>> => {
    return ipcRenderer.invoke(IPC_CHANNELS.LIVE2D_LIST_IMPORTED)
  },
  // 删除已导入的自定义模型（按 name）
  deleteImportedLive2DModel: (name: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.LIVE2D_DELETE_IMPORTED, name)
  }
}

export type GraphPetAPI = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('preload 暴露 api 失败:', error)
  }
} else {
  // @ts-ignore 全局挂载兜底
  window.api = api
}
