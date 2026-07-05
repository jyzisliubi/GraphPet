import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, screen, desktopCapturer, globalShortcut } from 'electron'
import path from 'path'
import { spawn, type ChildProcess } from 'child_process'
import * as http from 'http'
import * as fs from 'fs'
import * as os from 'os'
import { pathToFileURL } from 'url'

app.commandLine.appendSwitch('--no-sandbox')
app.commandLine.appendSwitch('--disable-gpu-sandbox')
app.commandLine.appendSwitch('--disable-features', 'HardwareMediaKeyHandling')
try {
  const devUserData = path.resolve(process.cwd(), '.electron-data')
  if (!fs.existsSync(devUserData)) fs.mkdirSync(devUserData, { recursive: true })
  app.setPath('userData', devUserData)
} catch {}

// 单实例锁（沙箱环境下可能失败，静默忽略）
let gotTheLock = false
try {
  gotTheLock = app.requestSingleInstanceLock()
} catch {}
if (!gotTheLock && process.env.NODE_ENV !== 'development') {
  // 生产环境没拿到锁，说明已有实例在跑，直接退出避免抢占 Python 端口
  app.quit()
}

// 在已获锁的实例里监听：第二个实例启动时唤起主窗口
app.on('second-instance', () => {
  if (petWindow) {
    if (petWindow.isMinimized()) petWindow.restore()
    petWindow.show()
    petWindow.focus()
  }
})

/**
 * GraphPet Electron 主进程
 *
 * 职责：
 * 1. 创建并管理透明置顶的宠物窗口、网页面板窗口、独立聊天窗口
 * 2. 鼠标穿透轮询：根据鼠标位置动态切换 setIgnoreMouseEvents 模式
 * 3. IPC 处理器：窗口移动、设置读写、模型路径扫描、文件对话框等
 * 4. Python 后端生命周期管理：启动/健康检查/退出清理
 * 5. 系统托盘：显示/隐藏、打开面板、退出
 */

/**
 * 解析资源路径，兼容开发模式和打包后 (asar) 模式
 * 生产环境优先使用 process.resourcesPath (extraResources)，开发模式使用项目目录
 */
function resolveResourcePath(...parts: string[]): string {
  const isPackaged = app.isPackaged
  const candidates: string[] = []
  if (isPackaged) {
    try {
      if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, ...parts))
    } catch {}
    candidates.push(path.join(__dirname, '../..', ...parts))
    try {
      candidates.push(path.join(app.getAppPath(), ...parts))
    } catch {}
  } else {
    try {
      candidates.push(path.join(app.getAppPath(), ...parts))
    } catch {}
    candidates.push(path.join(__dirname, '../..', ...parts))
    try {
      if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, ...parts))
    } catch {}
  }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {}
  }
  return candidates[0] || candidates[1] || candidates[2]
}

// ======================== Python 后端配置 ========================
const PYTHON_HOST = '127.0.0.1'
const PYTHON_PORT = 8765
const PYTHON_SERVER = resolveResourcePath('python', 'server.py')
const HEALTH_CHECK_URL = `http://${PYTHON_HOST}:${PYTHON_PORT}/health`
const HEALTH_CHECK_TIMEOUT_MS = 30000

// ======================== 窗口尺寸常量 ========================
/** 宠物窗口宽度 */
const WINDOW_WIDTH = 380
/** 宠物窗口高度 */
const WINDOW_HEIGHT = 580
/** 拖拽区域宽度（覆盖整个宠物窗口） */
const DRAG_REGION_W = 380
/** 拖拽区域高度（覆盖整个宠物窗口） */
const DRAG_REGION_H = 580
/** 聊天窗口宽度 */
const CHAT_WINDOW_WIDTH = 480
/** 聊天窗口高度 */
const CHAT_WINDOW_HEIGHT = 620
/** 拖拽区域相对于窗口左上角的 X 偏移 */
const DRAG_REGION_OFFSET_X = 0
/** 拖拽区域相对于窗口左上角的 Y 偏移 */
const DRAG_REGION_OFFSET_Y = 0

// ======================== 全局状态 ========================
let pythonProcess: ChildProcess | null = null
let pythonStartedByUs = false
let webPanelWindow: BrowserWindow | null = null
let chatWindow: BrowserWindow | null = null
let petWindow: BrowserWindow | null = null
let tray: Tray | null = null

/** 鼠标穿透模式 */
type IgnoreMode = 'off' | 'ignore' | 'ignore-forward'
let currentMode: IgnoreMode = 'off'
/** 渲染进程强制交互模式（浮层显示/拖拽期间） */
let forceInteractive = false
let mousePollTimer: ReturnType<typeof setInterval> | null = null

// ======================== 资源路径 ========================
const LIVE2D_DIR = resolveResourcePath('assets', 'live2d')
const ICON_PATH = resolveResourcePath('assets', 'icon.png')

/** 状态文件路径缓存 */
let _stateFilePath: string | null = null
function getStateFilePath(): string {
  if (!_stateFilePath) {
    _stateFilePath = path.join(app.getPath('userData'), 'graphpet_state.json')
  }
  return _stateFilePath
}

// ======================== 鼠标穿透逻辑 ========================

/**
 * 设置宠物窗口的鼠标事件忽略模式
 * - 'off': 正常接收鼠标事件（不忽略）
 * - 'ignore': 完全忽略鼠标事件（点击穿透到下方窗口）
 * - 'ignore-forward': 忽略鼠标事件但转发鼠标移动消息（用于 hover 检测）
 */
function setIgnoreMode(mode: IgnoreMode): void {
  if (!petWindow || petWindow.isDestroyed()) return
  if (currentMode === mode) return
  currentMode = mode
  try {
    if (mode === 'off') {
      petWindow.setIgnoreMouseEvents(true)
      petWindow.setIgnoreMouseEvents(false)
    } else if (mode === 'ignore-forward') {
      petWindow.setIgnoreMouseEvents(true, { forward: true })
    } else {
      petWindow.setIgnoreMouseEvents(true)
    }
  } catch (e) {
    console.error('[GraphPet] setIgnoreMouseEvents error:', e)
  }
}

/**
 * 根据当前鼠标位置和 forceInteractive 状态计算应该使用的穿透模式
 * - 鼠标在拖拽区域内：'off'（可交互/拖拽）
 * - 鼠标在窗口内但在拖拽区域外：'ignore-forward'（可 hover 穿透）
 * - 鼠标在窗口外：'ignore'（完全穿透）
 */
function computeMouseMode(): IgnoreMode {
  if (forceInteractive) return 'off'
  if (!petWindow || petWindow.isDestroyed()) return 'ignore'
  const cursor = screen.getCursorScreenPoint()
  const bounds = petWindow.getBounds()
  const inWindow =
    cursor.x >= bounds.x &&
    cursor.x < bounds.x + bounds.width &&
    cursor.y >= bounds.y &&
    cursor.y < bounds.y + bounds.height
  if (!inWindow) return 'ignore'
  const relX = cursor.x - bounds.x
  const relY = cursor.y - bounds.y
  const inDragRegion =
    relX >= DRAG_REGION_OFFSET_X &&
    relX < DRAG_REGION_OFFSET_X + DRAG_REGION_W &&
    relY >= DRAG_REGION_OFFSET_Y &&
    relY < DRAG_REGION_OFFSET_Y + DRAG_REGION_H
  return inDragRegion ? 'off' : 'ignore-forward'
}

/** 启动鼠标位置轮询（60ms 间隔，约 16fps） */
function startMousePolling(): void {
  if (mousePollTimer) return
  currentMode = 'off'
  setIgnoreMode('ignore')
  mousePollTimer = setInterval(() => {
    const nextMode = computeMouseMode()
    if (nextMode !== currentMode) {
      setIgnoreMode(nextMode)
    }
  }, 60)
}

/** 停止鼠标位置轮询 */
function stopMousePolling(): void {
  if (mousePollTimer) {
    clearInterval(mousePollTimer)
    mousePollTimer = null
  }
}

// ======================== Python 后端管理 ========================

/** 检测 Python 后端是否已经在运行（健康检查） */
function checkPythonRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_CHECK_URL, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

/** 将 LLM 配置同步到 Python 后端（POST /config/llm） */
function syncLlmConfigToBackend(settings: AppSettings): void {
  const llmProvider = settings.llmProvider || 'freellm'
  let llmApiBase = settings.llmApiBase
  let llmModel = settings.llmModel
  const llmApiKey = settings.llmApiKey || ''

  if (llmProvider === 'freellm') {
    llmApiBase = ''
    llmModel = 'auto'
  } else if (llmProvider === 'ollama') {
    llmApiBase = llmApiBase || 'http://localhost:11434'
    llmModel = llmModel || 'qwen2.5:7b'
  } else {
    llmApiBase = llmApiBase || ''
    llmModel = llmModel || 'auto'
  }

  const postData = JSON.stringify({
    llm_provider: llmProvider,
    llm_api_base: llmApiBase,
    llm_model: llmModel,
    llm_api_key: llmApiKey,
    ollama_host: llmApiBase
  })
  const postReq = http.request(
    {
      hostname: PYTHON_HOST,
      port: PYTHON_PORT,
      path: '/config/llm',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    },
    (res) => {
      res.resume()
      if (res.statusCode === 200) {
        console.log('[GraphPet] LLM 配置已同步到后端:', {
          provider: llmProvider,
          model: llmModel,
          apiBase: llmApiBase || '(built-in)',
          hasApiKey: llmApiKey.length > 0
        })
      }
    }
  )
  postReq.on('error', (err) => {
    console.error('[GraphPet] 同步 LLM 配置到后端失败:', err.message)
  })
  postReq.write(postData)
  postReq.end()
}

/** 启动 Python 后端子进程。
 *
 * 优先级：
 * 1. 内嵌 Python（resources/python-runtime/python.exe，PyInstaller 打包的独立运行时）
 * 2. 系统 Python（python / python3）
 * 内嵌模式无需用户安装 Python，开箱即用。
 */
function startPythonBackend(): void {
  const pythonDir = resolveResourcePath('python')
  console.log(`[GraphPet] 启动 Python 后端...`)

  // 1. 检测内嵌 Python 运行时（PyInstaller 打包）
  const embeddedPythonExe = process.platform === 'win32'
    ? path.join(process.resourcesPath || '', 'python-runtime', 'python.exe')
    : path.join(process.resourcesPath || '', 'python-runtime', 'bin', 'python3')
  const hasEmbeddedPython = process.env.NODE_ENV === 'production'
    && fs.existsSync(embeddedPythonExe)

  // 2. 决定 pythonBin 和启动参数
  let pythonBin: string
  let serverArgs: string[]
  if (hasEmbeddedPython) {
    console.log(`[GraphPet] 使用内嵌 Python: ${embeddedPythonExe}`)
    pythonBin = embeddedPythonExe
    serverArgs = [PYTHON_SERVER]
  } else {
    pythonBin = process.platform === 'win32' ? 'python' : 'python3'
    console.log(`[GraphPet] 使用系统 Python: ${pythonBin} ${PYTHON_SERVER}`)
    serverArgs = [PYTHON_SERVER]
  }
  pythonStartedByUs = true

  const graphpetIndexDir = path.join(app.getPath('userData'), 'graphpet_index')
  const graphpetDataPath = path.join(app.getPath('userData'), 'graphpet_kg_data.txt')
  const vendorDir = path.join(pythonDir, 'vendor')
  const pythonPathParts = [pythonDir]
  if (fs.existsSync(vendorDir)) {
    pythonPathParts.push(vendorDir)
    console.log(`[GraphPet] 检测到 vendor 依赖目录: ${vendorDir}`)
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GRAPHPET_STATE_FILE: getStateFilePath(),
    PYTHONPATH: pythonPathParts.join(process.platform === 'win32' ? ';' : ':'),
    POCKET_INDEX_DIR: graphpetIndexDir,
    POCKET_DATA_PATH: graphpetDataPath,
    // 内嵌 Python 模式下禁用自动 pip 安装（运行时已包含依赖）
    GRAPHPET_EMBEDDED_PYTHON: hasEmbeddedPython ? '1' : '0'
  }

  pythonProcess = spawn(pythonBin, serverArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: pythonDir,
    env
  })

  pythonProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[python] ${data.toString().trimEnd()}`)
  })
  pythonProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[python:err] ${data.toString().trimEnd()}`)
  })
  pythonProcess.on('exit', (code, signal) => {
    console.log(`[GraphPet] Python 后端退出 code=${code} signal=${signal}`)
    pythonProcess = null
    pythonStartedByUs = false
  })
}

/** 等待 Python 后端健康检查通过（轮询 /health，每 500ms 一次） */
function waitForPythonReady(): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const checkOnce = () => {
      const req = http.get(HEALTH_CHECK_URL, (res) => {
        res.resume()
        if (res.statusCode === 200) {
          resolve()
        } else if (Date.now() - start >= HEALTH_CHECK_TIMEOUT_MS) {
          reject(new Error(`健康检查超时（状态码 ${res.statusCode})`))
        } else {
          setTimeout(checkOnce, 500)
        }
      })
      req.on('error', () => {
        if (Date.now() - start >= HEALTH_CHECK_TIMEOUT_MS) {
          reject(new Error('健康检查超时：无法连接 Python 后端'))
        } else {
          setTimeout(checkOnce, 500)
        }
      })
    }
    checkOnce()
  })
}

// ======================== 系统托盘 ========================

/** 创建系统托盘图标和菜单 */
function createTray(): void {
  let icon: Electron.NativeImage
  try {
    if (fs.existsSync(ICON_PATH)) {
      icon = nativeImage.createFromPath(ICON_PATH)
    } else {
      icon = nativeImage.createEmpty()
    }
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('GraphPet - 知识图谱桌宠')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏宠物',
      click: () => {
        if (petWindow && !petWindow.isDestroyed()) {
          if (petWindow.isVisible()) {
            petWindow.hide()
          } else {
            petWindow.show()
          }
        }
      }
    },
    {
      label: '打开网页面板',
      click: () => {
        if (webPanelWindow && !webPanelWindow.isDestroyed()) {
          webPanelWindow.focus()
        } else {
          createWebPanelWindow()
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      }
    }
  ])
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      if (petWindow.isVisible()) {
        petWindow.hide()
      } else {
        petWindow.show()
      }
    }
  })
}

// ======================== 设置读写 ========================

/** 应用设置类型（与 preload/index.ts 中的 AppSettings 保持一致） */
interface AppSettings {
  llmProvider: 'freellm' | 'deepseek' | 'zhipu' | 'kimi' | 'siliconflow' | 'openai' | 'openai-compatible' | 'custom' | 'ollama'
  llmModel: string
  llmApiBase: string
  llmApiKey: string
  llmTemperature: number
  proactiveIntervalMin: number
  quietMode: boolean
  autoStart: boolean
  petScale: number
  /** TTS 语音播报开关（开启后 Nito 回答会用 edge-tts 朗读） */
  ttsEnabled: boolean
  /** TTS 语音角色（edge-tts ShortName，如 zh-CN-XiaoyiNeural） */
  ttsVoice: string
  /** VAD 语音打断开关（开启后用户说话时自动停止 TTS） */
  vadEnabled: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  llmProvider: 'freellm',
  llmModel: 'auto',
  llmApiBase: '',
  llmApiKey: '',
  llmTemperature: 0.7,
  proactiveIntervalMin: 10,
  quietMode: false,
  autoStart: false,
  petScale: 1,
  ttsEnabled: false,
  ttsVoice: 'zh-CN-XiaoyiNeural',
  vadEnabled: false
}

/** 从 graphpet_state.json 读取设置，缺失则返回默认值 */
function readSettings(): AppSettings {
  try {
    const sf = getStateFilePath()
    if (!fs.existsSync(sf)) {
      return { ...DEFAULT_SETTINGS }
    }
    const raw = fs.readFileSync(sf, 'utf-8')
    const data = JSON.parse(raw) as { settings?: Partial<AppSettings> }
    return { ...DEFAULT_SETTINGS, ...(data.settings || {}) }
  } catch (err) {
    console.error('[GraphPet] 读取设置失败，使用默认值:', err)
    return { ...DEFAULT_SETTINGS }
  }
}

/** 写入设置到 graphpet_state.json */
function writeSettings(settings: AppSettings): void {
  try {
    const sf = getStateFilePath()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: Record<string, any> = {}
    if (fs.existsSync(sf)) {
      const raw = fs.readFileSync(sf, 'utf-8')
      data = JSON.parse(raw)
    }
    data.settings = settings
    fs.writeFileSync(sf, JSON.stringify(data, null, 2), 'utf-8')
  } catch (err) {
    console.error('[GraphPet] 写入设置失败:', err)
  }
}

// ======================== IPC 处理器注册 ========================

/** 扫描 Live2D 模型目录，返回模型文件信息 */
interface ModelCandidate {
  dir: string
  file: string
  format: 'cubism2' | 'cubism4'
}

function registerIpcHandlers(): void {
  // 窗口移动：渲染进程发送屏幕坐标，主进程 setPosition（移动发送消息的窗口本身）
  ipcMain.on('window:move', (event, x: number, y: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      win.setPosition(Math.round(x), Math.round(y))
    }
  })

  // 强制交互模式：浮层显示/拖拽期间关闭鼠标穿透
  ipcMain.on('window:force-interactive', (_event, state: string) => {
    const next = state === 'force-on'
    if (forceInteractive === next) return
    forceInteractive = next
    setIgnoreMode(computeMouseMode())
  })

  // 获取 Live2D 默认模型路径（优先 nito.model3.json / nito.model.json）
  ipcMain.handle('live2d:get-model-path', () => {
    try {
      const isModelFile = (
        f: string
      ): { isModel: boolean; format: 'cubism2' | 'cubism4' | null } => {
        const lower = f.toLowerCase()
        if (lower.endsWith('.model3.json')) return { isModel: true, format: 'cubism4' }
        if (lower.endsWith('.model.json')) return { isModel: true, format: 'cubism2' }
        return { isModel: false, format: null }
      }

      if (!fs.existsSync(LIVE2D_DIR)) {
        console.log('[GraphPet] Live2D 模型根目录不存在:', LIVE2D_DIR)
        return { path: null, format: null }
      }

      const candidates: ModelCandidate[] = []
      const scanDirs = [LIVE2D_DIR]
      for (const dirName of fs.readdirSync(LIVE2D_DIR)) {
        const dirPath = path.join(LIVE2D_DIR, dirName)
        if (fs.statSync(dirPath).isDirectory()) scanDirs.push(dirPath)
      }

      for (const dirPath of scanDirs) {
        const files = fs.readdirSync(dirPath)
        for (const f of files.sort()) {
          const res = isModelFile(f)
          if (res.isModel && res.format) {
            candidates.push({ dir: dirPath, file: f, format: res.format })
          }
        }
      }

      if (candidates.length === 0) {
        console.log('[GraphPet] 未找到模型文件 (.model.json/.model3.json):', LIVE2D_DIR)
        return { path: null, format: null }
      }

      const picked =
        candidates.find((c) => c.file.toLowerCase() === 'nito.model3.json') ??
        candidates.find((c) => c.file.toLowerCase() === 'nito.model.json') ??
        candidates.sort((a, b) =>
          path.join(a.dir, a.file).localeCompare(path.join(b.dir, b.file))
        )[0]

      const fullPath = path.join(picked.dir, picked.file)
      const fileUrl = pathToFileURL(fullPath).href
      console.log('[GraphPet] 已定位模型:', fileUrl, '格式:', picked.format)
      return { path: fileUrl, format: picked.format }
    } catch (err) {
      console.error('[GraphPet] 查找模型失败:', err)
      return { path: null, format: null }
    }
  })

  // 获取所有可用皮肤列表（Nito 家族）
  ipcMain.handle('live2d:get-skins', () => {
    const skins: Array<{ name: string; path: string; format: 'cubism2' | 'cubism4' }> = []
    const NITO_FAMILY_NAMES: Record<string, string> = {
      nito: 'Nito（尼托）',
      'ni-j': 'Ni-J（妮J）',
      nico: 'Nico（妮可）',
      nietzsche: 'Nietzsche（妮采）',
      nipsilon: 'Nipsilon（妮普西伦）'
    }
    try {
      if (!fs.existsSync(LIVE2D_DIR)) {
        console.log('[GraphPet] Live2D 模型根目录不存在:', LIVE2D_DIR)
        return skins
      }
      for (const dirName of fs.readdirSync(LIVE2D_DIR)) {
        const dirPath = path.join(LIVE2D_DIR, dirName)
        if (!fs.statSync(dirPath).isDirectory()) continue
        const files = fs.readdirSync(dirPath)
        const modelFiles = files
          .filter(
            (f) =>
              f.toLowerCase().endsWith('.model.json') ||
              f.toLowerCase().endsWith('.model3.json')
          )
          .sort()
        for (const modelFile of modelFiles) {
          const baseName = modelFile.replace(/\.(model3?)\.json$/i, '')
          const lowerName = baseName.toLowerCase()
          if (!(lowerName in NITO_FAMILY_NAMES)) continue
          const fullPath = path.join(dirPath, modelFile)
          const isCubism2 =
            modelFile.toLowerCase().endsWith('.model.json') &&
            !modelFile.toLowerCase().endsWith('.model3.json')
          const format = isCubism2 ? 'cubism2' : 'cubism4'
          const name = NITO_FAMILY_NAMES[lowerName]
          skins.push({
            name,
            path: pathToFileURL(fullPath).href,
            format
          })
        }
      }
      console.log(`[GraphPet] 扫描到 ${skins.length} 个 Nito 家族皮肤`)
      return skins
    } catch (err) {
      console.error('[GraphPet] 扫描皮肤列表失败:', err)
      return skins
    }
  })

  // 设置读取
  ipcMain.handle('settings:get', () => {
    return readSettings()
  })

  // 设置保存（同步开机自启 + 同步 LLM 配置到后端）
  ipcMain.handle('settings:set', (_event, settings: AppSettings) => {
    writeSettings(settings)
    try {
      app.setLoginItemSettings({ openAtLogin: !!settings.autoStart })
    } catch (err) {
      console.error('[GraphPet] 设置开机自启失败:', err)
    }
    syncLlmConfigToBackend(settings)
  })

  // ============= 自定义 Live2D 模型导入 =============
  // 已导入模型目录：app.getPath('userData')/imported-models/<name>/
  function getImportedModelsDir(): string {
    const dir = path.join(app.getPath('userData'), 'imported-models')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  // 递归复制目录
  function copyDirRecursive(src: string, dest: string): void {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)
      if (entry.isDirectory()) {
        copyDirRecursive(srcPath, destPath)
      } else if (entry.isFile()) {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }

  // 导入自定义 Live2D 模型：弹出文件夹选择对话框，复制到 imported-models
  ipcMain.handle('live2d:import-model', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择 Live2D 模型目录',
        properties: ['openDirectory'],
        message: '请选择包含 .model3.json 或 .model.json 的模型目录'
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '已取消选择' }
      }
      const selectedDir = result.filePaths[0]
      const dirName = path.basename(selectedDir)
      // 找模型文件
      const files = fs.readdirSync(selectedDir)
      const modelFile = files.find((f) => f.toLowerCase().endsWith('.model3.json')) ?? files.find((f) => f.toLowerCase().endsWith('.model.json'))
      if (!modelFile) {
        return { success: false, error: '所选目录中未找到 .model3.json 或 .model.json 文件' }
      }
      const isCubism4 = modelFile.toLowerCase().endsWith('.model3.json')
      const format = isCubism4 ? 'cubism4' as const : 'cubism2' as const
      // 复制到 imported-models/<dirName>/
      const importedRoot = getImportedModelsDir()
      const destDir = path.join(importedRoot, dirName)
      // 若已存在同名模型，覆盖
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true })
      }
      copyDirRecursive(selectedDir, destDir)
      const modelPath = path.join(destDir, modelFile)
      const fileUrl = pathToFileURL(modelPath).href
      console.log(`[GraphPet] 已导入 Live2D 模型: ${dirName}/${modelFile} (${format})`)
      return { success: true, name: dirName, path: fileUrl, format }
    } catch (err) {
      console.error('[GraphPet] 导入 Live2D 模型失败:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 列出已导入的自定义模型
  ipcMain.handle('live2d:list-imported', () => {
    const result: Array<{ name: string; path: string; format: 'cubism2' | 'cubism4' }> = []
    try {
      const importedRoot = getImportedModelsDir()
      for (const dirName of fs.readdirSync(importedRoot)) {
        const dirPath = path.join(importedRoot, dirName)
        if (!fs.statSync(dirPath).isDirectory()) continue
        const files = fs.readdirSync(dirPath)
        const modelFile = files.find((f) => f.toLowerCase().endsWith('.model3.json')) ?? files.find((f) => f.toLowerCase().endsWith('.model.json'))
        if (!modelFile) continue
        const isCubism4 = modelFile.toLowerCase().endsWith('.model3.json')
        const format = isCubism4 ? 'cubism4' as const : 'cubism2' as const
        result.push({
          name: dirName,
          path: pathToFileURL(path.join(dirPath, modelFile)).href,
          format
        })
      }
    } catch (err) {
      console.error('[GraphPet] 列出已导入模型失败:', err)
    }
    return result
  })

  // 删除已导入的自定义模型
  ipcMain.handle('live2d:delete-imported', (_event, name: string) => {
    try {
      const importedRoot = getImportedModelsDir()
      const targetDir = path.join(importedRoot, name)
      // 路径校验，防止路径穿越
      if (!targetDir.startsWith(importedRoot)) {
        return { success: false, error: '非法路径' }
      }
      if (!fs.existsSync(targetDir)) {
        return { success: false, error: '模型不存在' }
      }
      fs.rmSync(targetDir, { recursive: true, force: true })
      console.log(`[GraphPet] 已删除导入模型: ${name}`)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 打开文件选择对话框（支持多选）
  ipcMain.handle('feed:file-dialog', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择喂食文件',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '文档', extensions: ['txt', 'md', 'markdown', 'pdf', 'docx', 'doc'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (result.canceled || result.filePaths.length === 0) {
        return []
      }
      return result.filePaths
    } catch (err) {
      console.error('[GraphPet] 打开文件对话框失败:', err)
      return []
    }
  })

  // 截屏喂食：截取主屏幕，保存为临时 PNG 文件返回路径
  // 前端拿到路径后调用 feedFile(filePath) 走现有喂食管道
  // 后端 _parse_image_with_ollama 会用 Ollama vision 模型描述图片
  ipcMain.handle('screenshot:capture', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
        fetchWindowIcons: false
      })
      if (sources.length === 0) {
        return { success: false, error: '没有可用的屏幕源' }
      }
      const source = sources[0]
      const thumbnail = source.thumbnail
      const pngBuffer = thumbnail.toPNG()
      // 保存到系统临时目录
      const tmpDir = os.tmpdir()
      const fileName = `graphpet-screenshot-${Date.now()}.png`
      const filePath = path.join(tmpDir, fileName)
      fs.writeFileSync(filePath, pngBuffer)
      console.log(`[GraphPet] 截屏已保存: ${filePath} (${pngBuffer.length} bytes)`)
      return { success: true, filePath, fileSize: pngBuffer.length }
    } catch (err) {
      console.error('[GraphPet] 截屏失败:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 退出应用
  ipcMain.on('app:quit', () => {
    app.quit()
  })

  // 打开/聚焦网页面板，可指定初始路由
  ipcMain.on('panel:open', (_event, route?: string) => {
    if (webPanelWindow && !webPanelWindow.isDestroyed()) {
      if (webPanelWindow.isMinimized()) {
        webPanelWindow.restore()
      }
      if (route) {
        webPanelWindow.webContents
          .executeJavaScript(`window.location.hash = '#/panel/${route}';`)
          .catch(() => {
            /* 忽略执行错误 */
          })
      }
      webPanelWindow.focus()
      return
    }
    createWebPanelWindow(route)
  })

  // 打开独立聊天小窗口
  ipcMain.on('chat:open', () => {
    createChatWindow()
  })

  // 关闭聊天窗口
  ipcMain.on('chat:close', () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.close()
    }
  })

  // 最小化聊天窗口
  ipcMain.on('chat:minimize', () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.minimize()
    }
  })

  // 表情变化事件：从聊天窗口转发到宠物窗口
  ipcMain.on('pet:emotion', (_event, emotion: string) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:emotion', emotion)
    }
  })

  // 首次启动检测：状态文件不存在视为首次启动
  ipcMain.handle('app:is-first-run', () => {
    return !fs.existsSync(getStateFilePath())
  })

  // 检测 Ollama 服务是否可用
  ipcMain.handle('system:check-ollama', async () => {
    return new Promise<{ installed: boolean; running: boolean }>((resolve) => {
      const req = http.get('http://127.0.0.1:11434/api/tags', (res) => {
        res.resume()
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ installed: true, running: true })
        } else {
          resolve({ installed: false, running: false })
        }
      })
      req.on('error', () => {
        resolve({ installed: false, running: false })
      })
      req.setTimeout(3000, () => {
        req.destroy()
        resolve({ installed: false, running: false })
      })
    })
  })

  // 宠物点击事件：主进程转发给渲染进程
  ipcMain.on('pet:click', (_event, data: { x: number; y: number }) => {
    console.log('[GraphPet] 宠物被点击:', data)
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet-clicked', data)
    }
  })

  // ======================== 桌宠自由走动 ========================
  ipcMain.on('pet:walk-start', () => {
    startPetWalk()
  })
  ipcMain.on('pet:walk-stop', () => {
    stopPetWalk()
  })
  ipcMain.on('pet:walk-to', (_event, targetX: number, targetY: number) => {
    walkToTarget(targetX, targetY)
  })
}

// —— 走动状态机（节流避免高频调用 setPosition）——
let walkTimer: NodeJS.Timeout | null = null
let walkTargetX = 0
let walkTargetY = 0
let walkStepX = 0
let walkStepY = 0
let walkStepCount = 0
let walkTotalSteps = 0
let walkStepInterval: NodeJS.Timeout | null = null

/**
 * 启动桌宠自由游走：每隔随机 8~20 秒选一个屏幕内随机目标点，
 * 用 60ms 步长逐步移动过去（带加速度曲线，避免突兀瞬移）。
 */
function startPetWalk(): void {
  if (walkTimer) return
  if (!petWindow || petWindow.isDestroyed()) return

  const scheduleNextWalk = (): void => {
    const delay = 8000 + Math.floor(Math.random() * 12000) // 8~20s
    walkTimer = setTimeout(() => {
      if (!petWindow || petWindow.isDestroyed()) {
        walkTimer = null
        return
      }
      const { workArea } = screen.getPrimaryDisplay()
      const bounds = petWindow.getBounds()
      // 在屏幕工作区内随机选一个点（保留 50px 边距）
      const margin = 50
      const minX = workArea.x + margin
      const maxX = workArea.x + workArea.width - WINDOW_WIDTH - margin
      const minY = workArea.y + margin
      const maxY = workArea.y + workArea.height - WINDOW_HEIGHT - margin
      const tx = Math.max(minX, Math.min(maxX, Math.floor(minX + Math.random() * (maxX - minX))))
      const ty = Math.max(minY, Math.min(maxY, Math.floor(minY + Math.random() * (maxY - minY))))
      walkToTarget(tx, ty)
      scheduleNextWalk()
    }, delay)
  }
  scheduleNextWalk()
}

/**
 * 主动停止走动定时器。
 */
function stopPetWalk(): void {
  if (walkTimer) {
    clearTimeout(walkTimer)
    walkTimer = null
  }
  if (walkStepInterval) {
    clearInterval(walkStepInterval)
    walkStepInterval = null
  }
}

/**
 * 让桌宠走到指定坐标（带动画过渡，60ms 一步，每步 4px）。
 * 走动期间临时关闭 alwaysOnTop 防遮挡其他窗口操作（可选保留）。
 */
function walkToTarget(targetX: number, targetY: number): void {
  if (!petWindow || petWindow.isDestroyed()) return
  // 清理上一次未完成的步进 interval，避免多个 interval 并发驱动 setPosition 抖动
  if (walkStepInterval) {
    clearInterval(walkStepInterval)
    walkStepInterval = null
  }
  const bounds = petWindow.getBounds()
  const dx = targetX - bounds.x
  const dy = targetY - bounds.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  if (distance < 4) return
  // 总步数：按距离 4px/步
  walkTotalSteps = Math.max(8, Math.floor(distance / 4))
  walkStepCount = 0
  walkStepX = dx / walkTotalSteps
  walkStepY = dy / walkTotalSteps
  walkTargetX = targetX
  walkTargetY = targetY

  walkStepInterval = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) {
      if (walkStepInterval) {
        clearInterval(walkStepInterval)
        walkStepInterval = null
      }
      return
    }
    if (walkStepCount >= walkTotalSteps) {
      if (walkStepInterval) {
        clearInterval(walkStepInterval)
        walkStepInterval = null
      }
      return
    }
    // 检查用户是否正在拖动窗口（如果在拖动，停止走动避免冲突）
    // 简化处理：直接 setPosition
    try {
      const cur = petWindow.getBounds()
      petWindow.setPosition(Math.round(cur.x + walkStepX), Math.round(cur.y + walkStepY))
      walkStepCount++
    } catch {
      if (walkStepInterval) {
        clearInterval(walkStepInterval)
        walkStepInterval = null
      }
    }
  }, 60)
}

// ======================== 窗口创建 ========================

/** 创建透明置顶的宠物主窗口 */
function createPetWindow(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()
  const x = workArea.x + workArea.width - WINDOW_WIDTH - 20
  const y = workArea.y + workArea.height - WINDOW_HEIGHT - 20

  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: process.env.NODE_ENV === 'production'
    }
  })

  petWindow = win

  win.on('closed', () => {
    if (petWindow === win) petWindow = null
    stopMousePolling()
  })

  win.once('ready-to-show', () => {
    win.show()
    win.setAlwaysOnTop(true, 'screen-saver')
    startMousePolling()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // 右键菜单：阻止默认菜单，转发坐标给渲染进程
  win.webContents.on('context-menu', (event, params) => {
    event.preventDefault()
    win.webContents.send('context-menu', { x: params.x, y: params.y })
  })

  // 阻止页面导航（安全限制）
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  // 渲染进程控制台日志转发到主进程
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer:console] L${level} ${sourceId}:${line} ${message}`)
  })

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[GraphPet] 渲染进程崩溃:', details)
  })

  win.webContents.on('did-fail-load', (_e, code, desc, url2) => {
    console.error(`[GraphPet] 加载失败 code=${code} desc=${desc} url=${url2}`)
  })

  win.webContents.on('did-finish-load', () => {
    console.log('[GraphPet] 渲染进程加载完成')
  })

  return win
}

/** 创建网页面板窗口（用于记忆图谱、时间线等功能） */
function createWebPanelWindow(initialRoute?: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 560,
    transparent: false,
    frame: true,
    alwaysOnTop: false,
    hasShadow: true,
    resizable: true,
    skipTaskbar: false,
    backgroundColor: '#0a0a0a',
    show: false,
    title: 'GraphPet',
    autoHideMenuBar: true,
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: process.env.NODE_ENV === 'production'
    }
  })

  webPanelWindow = win

  // 面板获得焦点时临时取消宠物置顶
  win.on('focus', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setAlwaysOnTop(false)
      petWindow.setVisibleOnAllWorkspaces(false)
    }
  })

  const restorePetTop = () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setAlwaysOnTop(true, 'screen-saver')
    }
  }

  win.on('blur', restorePetTop)
  win.on('closed', () => {
    webPanelWindow = null
    restorePetTop()
  })
  win.on('minimize', restorePetTop)

  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })

  const route = initialRoute || 'chat'
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/panel/${route}`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: `/panel/${route}`
    })
  }

  return win
}

/** 计算聊天窗口的合适位置 */
function calculateChatWindowPosition(): { x: number | undefined; y: number | undefined } {
  let x: number | undefined
  let y: number | undefined
  if (petWindow && !petWindow.isDestroyed()) {
    const petBounds = petWindow.getBounds()
    const chatW = CHAT_WINDOW_WIDTH
    const chatH = CHAT_WINDOW_HEIGHT
    const gap = 4

    const display = screen.getDisplayMatching(petBounds)
    const wa = display.workArea
    const waRight = wa.x + wa.width
    const waBottom = wa.y + wa.height

    // 计算左右两侧可用空间
    const rightSpace = waRight - (petBounds.x + petBounds.width) - gap
    const leftSpace = petBounds.x - wa.x - gap

    let tryX: number
    if (rightSpace >= chatW) {
      // 右侧放得下，紧贴宠物右边
      tryX = petBounds.x + petBounds.width + gap
    } else if (leftSpace >= chatW) {
      // 左侧放得下，紧贴宠物左边
      tryX = petBounds.x - chatW - gap
    } else if (rightSpace >= leftSpace) {
      // 两侧都放不下但右侧空间更大，贴屏幕右边缘
      tryX = waRight - chatW - gap
    } else {
      // 左侧空间更大，贴屏幕左边缘
      tryX = wa.x + gap
    }
    x = tryX

    // Y轴：与宠物顶部对齐，但不超出屏幕
    y = petBounds.y
    if (y + chatH > waBottom) y = waBottom - chatH - gap
    if (y < wa.y) y = wa.y + gap

    console.log('[ChatWindow] petBounds:', petBounds, 'chatPos:', { x, y }, 'wa:', wa)
  }
  return { x, y }
}

/** 创建独立聊天小窗口 */
function createChatWindow(): BrowserWindow {
  // 如果已存在则重新定位并聚焦
  if (chatWindow && !chatWindow.isDestroyed()) {
    const pos = calculateChatWindowPosition()
    if (pos.x !== undefined && pos.y !== undefined) {
      chatWindow.setPosition(Math.round(pos.x), Math.round(pos.y))
    }
    chatWindow.focus()
    return chatWindow
  }

  const { x, y } = calculateChatWindowPosition()

  const win = new BrowserWindow({
    width: CHAT_WINDOW_WIDTH,
    height: CHAT_WINDOW_HEIGHT,
    minWidth: 480,
    minHeight: 520,
    x,
    y,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    hasShadow: true,
    resizable: true,
    skipTaskbar: true,
    backgroundColor: '#0a0a0a',
    show: false,
    title: '和 Nito 聊天',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: process.env.NODE_ENV === 'production'
    }
  })

  chatWindow = win

  // 聊天窗口获得焦点时临时取消宠物置顶
  win.on('focus', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setAlwaysOnTop(false)
    }
  })

  const restorePetTop = () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setAlwaysOnTop(true, 'screen-saver')
    }
  }

  win.on('blur', restorePetTop)
  win.on('closed', () => {
    chatWindow = null
    restorePetTop()
  })

  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/chat-window`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: '/chat-window'
    })
  }

  return win
}

// ======================== 应用生命周期 ========================

if (gotTheLock) {
  app.on('second-instance', () => {
    if (petWindow) {
      if (petWindow.isMinimized()) petWindow.restore()
      petWindow.focus()
      petWindow.show()
    }
  })
}

app.whenReady().then(async () => {
  // 设置应用图标
  if (fs.existsSync(ICON_PATH)) {
    try {
      const appIcon = nativeImage.createFromPath(ICON_PATH)
      if (process.platform === 'darwin') {
        app.dock.setIcon(appIcon)
      }
    } catch {
      /* 忽略 */
    }
  }

  createTray()
  registerIpcHandlers()

  // 启动/检测 Python 后端
  const alreadyRunning = await checkPythonRunning()
  if (alreadyRunning) {
    console.log('[GraphPet] 检测到 Python 后端已在运行，跳过启动')
  } else {
    startPythonBackend()
    try {
      await waitForPythonReady()
      console.log('[GraphPet] Python 后端就绪')
      syncLlmConfigToBackend(readSettings())
    } catch (err) {
      console.error('[GraphPet] Python 后端启动失败:', err)
    }
  }

  createPetWindow()

  // 注册全局热键：Ctrl+Shift+G 显示/隐藏宠物窗口
  try {
    const ret = globalShortcut.register('CommandOrControl+Shift+G', () => {
      if (!petWindow || petWindow.isDestroyed()) return
      if (petWindow.isVisible() && !petWindow.isMinimized()) {
        petWindow.hide()
      } else {
        petWindow.show()
        petWindow.focus()
      }
    })
    if (!ret) {
      console.warn('[GraphPet] 全局热键 Ctrl+Shift+G 注册失败（可能已被其他应用占用）')
    }
  } catch (err) {
    console.warn('[GraphPet] 全局热键注册异常:', err)
  }
})

// 应用退出时注销所有全局热键
app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll()
  } catch {
    /* ignore */
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createPetWindow()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!tray) {
      app.quit()
    }
  }
})

app.on('before-quit', () => {
  if (pythonProcess && pythonStartedByUs) {
    console.log('[GraphPet] 终止 Python 后端子进程')
    pythonProcess.kill()
    pythonProcess = null
  }
  if (tray) {
    tray.destroy()
    tray = null
  }
})
