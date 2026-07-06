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

/**
 * 立绘物理动画状态：拖拽松手后惯性滑行 + 边缘弹性反弹。
 * isPhysicsAnimating=true 时拒绝新的拖拽/物理请求，避免动画堆叠。
 */
let isPhysicsAnimating = false
let physicsTimer: ReturnType<typeof setInterval> | null = null

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

// ======================== 屏幕感知：全屏应用检测 ========================

/**
 * 已知全屏应用进程名/窗口名前缀（小写匹配）。
 * 来源：调研 Open-LLM-VTuber / Shimeji-ee 的全屏检测列表 + 主流游戏/视频播放器。
 * desktopCapturer.getSources({types:['window']}) 返回的 source.name 在 Windows 上是窗口标题，
 * 通常包含游戏名/应用名（如 "Dota 2" / "原神" / "VLC media player"）。
 */
const FULLSCREEN_APP_PREFIXES = [
  // 游戏（仅匹配游戏本体名，避免 Steam 客户端/Battle.net 启动器误判）
  'dota 2', 'counter-strike', 'valorant', 'league of legends', 'overwatch',
  'minecraft', 'genshin impact', '原神', 'yuanshen', 'skyrim',
  'witcher', 'cyberpunk', 'elden ring', 'baldur', 'red dead', 'gta v',
  'fortnite', 'apex legends', 'pubg', 'hearthstone', 'starcraft', 'warcraft',
  'diablo', 'final fantasy', 'world of warcraft',
  // 视频播放器（全屏专用，非浏览器）
  'vlc media player', 'mpv player', 'mpc-hc', 'mpc-be', 'potplayer',
  'kodi', 'plex ', 'jellyfin', 'emby', 'iina', 'quicktime player',
  // 直播推流（用户主动开 OBS 直播时不应被打扰）
  'obs studio', 'streamlabs', 'xsplit',
  // 办公全屏演示
  'powerpoint', 'wps 演示', 'keynote'
  // 注意：不包含 'steam' / 'bilibili' / 'youtube' / 'netflix' 等通用词
  // 这些应用窗口名常驻但用户不一定在全屏使用，匹配会导致宠物被误隐藏
]

/**
 * 全屏检测上次检测到的前台窗口名缓存（避免每次都触发 desktopCapturer）。
 * desktopCapturer.getSources 是相对昂贵操作（生成 thumbnail），所以用 thumbnailSize:1x1。
 */
let lastForegroundAppName: string = ''
/** 全屏检测轮询句柄 */
let fullscreenTimer: ReturnType<typeof setInterval> | null = null
/** 用户主动隐藏状态（避免全屏检测把宠物自动显示回来） */
let userHiddenByFullscreen = false

/**
 * 检测前台窗口是否是全屏应用（游戏/视频播放器）。
 *
 * 三层检测策略：
 * 1. BrowserWindow.getAllWindows() 自家窗口全屏判定（精确，但只能看 GraphPet 创建的窗口）
 * 2. desktopCapturer.getSources({types:['window']}) 枚举所有系统窗口，
 *    检查窗口名是否匹配 FULLSCREEN_APP_PREFIXES 前缀（覆盖 Steam 游戏 / 视频播放器）
 * 3. 检查鼠标所在显示器上是否有整屏覆盖的非 GraphPet 窗口（间接判断）
 */
function startFullscreenDetection(): void {
  if (fullscreenTimer) return
  // P2 优化：动态频率，未检测到全屏时 5s 一次，检测到后 10s 一次（减少 CPU 占用）
  const scheduleNext = (intervalMs: number): void => {
    if (fullscreenTimer) clearTimeout(fullscreenTimer)
    fullscreenTimer = setTimeout(() => {
      if (!petWindow || petWindow.isDestroyed()) return
      void detectFullscreen().then((found) => {
        // 检测到全屏应用后降频（10s），未检测到保持 5s
        scheduleNext(found ? 10000 : 5000)
      }).catch(() => {
        scheduleNext(5000)
      })
    }, intervalMs) as unknown as ReturnType<typeof setTimeout>
  }
  scheduleNext(5000)
}

/** 异步检测全屏应用 */
async function detectFullscreen(): Promise<boolean> {
  if (!petWindow || petWindow.isDestroyed()) return false
  let foundFullscreen = false

  // 第一层：自家窗口全屏判定（精确，覆盖 Electron 创建的全屏窗口）
  try {
    const allWindows = BrowserWindow.getAllWindows()
    for (const win of allWindows) {
      if (win.isDestroyed()) continue
      if (win === petWindow || win === chatWindow || win === webPanelWindow) continue
      try {
        if (win.isFullScreen() && win.isVisible() && win.isFocused()) {
          foundFullscreen = true
          break
        }
      } catch {
        /* 忽略单个窗口查询失败 */
      }
    }
  } catch {
    /* ignore */
  }

  // 第二层：系统级窗口名匹配（关键改进，能看到所有应用窗口）
  // 注意：desktopCapturer.getSources 在 Windows 上会触发 WGC 错误日志
  // ("Source is not capturable")，这是 Electron 31 的已知问题，不影响功能。
  // thumbnailSize 设为 0x0 避免生成 thumbnail 减少 WGC 调用。
  if (!foundFullscreen) {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 0, height: 0 }, // 不生成 thumbnail，减少 WGC 错误
        fetchWindowIcons: false
      })
      for (const source of sources) {
        const name = (source.name || '').toLowerCase()
        if (!name) continue
        // 跳过 GraphPet 自己的窗口
        if (name.includes('graphpet') || name.includes('nito')) continue
        // 匹配已知全屏应用前缀
        for (const prefix of FULLSCREEN_APP_PREFIXES) {
          if (name.includes(prefix)) {
            if (name !== lastForegroundAppName) {
              lastForegroundAppName = name
              console.log(`[GraphPet] 检测到全屏应用窗口: ${source.name}`)
            }
            foundFullscreen = true
            break
          }
        }
        if (foundFullscreen) break
      }
      if (!foundFullscreen && lastForegroundAppName) {
        lastForegroundAppName = ''
      }
    } catch {
      /* desktopCapturer 失败静默 */
    }
  }

  // 状态变更：进入/退出全屏
  try {
    if (foundFullscreen && !userHiddenByFullscreen && petWindow.isVisible()) {
      // 进入全屏：隐藏宠物
      petWindow.hide()
      userHiddenByFullscreen = true
      console.log('[GraphPet] 检测到全屏应用，自动隐藏宠物')
    } else if (!foundFullscreen && userHiddenByFullscreen && !petWindow.isVisible()) {
      // 退出全屏：自动恢复宠物
      petWindow.show()
      userHiddenByFullscreen = false
      console.log('[GraphPet] 全屏应用退出，恢复宠物显示')
    }
  } catch {
    /* 状态变更失败静默 */
  }
  return foundFullscreen
}

/** 停止全屏检测 */
function stopFullscreenDetection(): void {
  if (fullscreenTimer) {
    clearInterval(fullscreenTimer)
    fullscreenTimer = null
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
    // P1-D 修复：显式传入知识图谱目录，避免 macOS/Linux 上 bridge 用硬编码 Windows 路径
    // （原默认值 r"d:\GraphPet\graphpet_kg" 在 Unix 下是带反斜杠的相对路径，图谱数据丢失）
    GRAPHPET_KG_DIR: path.join(app.getPath('userData'), 'graphpet_kg'),
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

/** 主进程 i18n 字典（仅托盘菜单 + 对话框需要的 key） */
const TRAY_I18N_ZH: Record<string, string> = {
  'tray.show_hide': '显示/隐藏宠物\tCtrl+Shift+G',
  'tray.open_chat': '打开聊天窗口',
  'tray.open_panel': '打开管理面板',
  'tray.start_walk': '开始走动',
  'tray.stop_walk': '停止走动',
  'tray.quiet_mode': '安静模式',
  'tray.about': '关于 GraphPet',
  'tray.quit': '退出',
  'tray.about_detail': '你的 AI 知识桌宠\n喂文件、学知识、陪你聊天\n\nMade with ❤️ by Jay Z',
  'tray.about_btn': '好的'
}
const TRAY_I18N_EN: Record<string, string> = {
  'tray.show_hide': 'Show/Hide Pet\tCtrl+Shift+G',
  'tray.open_chat': 'Open Chat Window',
  'tray.open_panel': 'Open Panel',
  'tray.start_walk': 'Start Walking',
  'tray.stop_walk': 'Stop Walking',
  'tray.quiet_mode': 'Quiet Mode',
  'tray.about': 'About GraphPet',
  'tray.quit': 'Quit',
  'tray.about_detail': 'Your AI knowledge desktop pet\nFeed files, learn knowledge, chat with you\n\nMade with ❤️ by Jay Z',
  'tray.about_btn': 'OK'
}

/** 主进程 i18n 翻译函数（按 settings.locale 选择字典） */
function tMain(key: string): string {
  const locale = readSettings().locale || 'zh'
  const dict = locale === 'en' ? TRAY_I18N_EN : TRAY_I18N_ZH
  return dict[key] ?? TRAY_I18N_ZH[key] ?? key
}

/** 构建系统托盘右键菜单（动态，依据当前走动/安静状态显示勾选） */
function buildTrayMenu(): Electron.Menu {
  const isWalking = walkTimer !== null
  const settings = readSettings()
  return Menu.buildFromTemplate([
    {
      label: tMain('tray.show_hide'),
      click: () => {
        if (petWindow && !petWindow.isDestroyed()) {
          if (petWindow.isVisible() && !petWindow.isMinimized()) {
            petWindow.hide()
          } else {
            petWindow.show()
            petWindow.focus()
          }
        }
      }
    },
    {
      label: tMain('tray.open_chat'),
      click: () => {
        if (chatWindow && !chatWindow.isDestroyed()) {
          if (chatWindow.isMinimized()) chatWindow.restore()
          chatWindow.show()
          chatWindow.focus()
        } else {
          createChatWindow()
        }
      }
    },
    {
      label: tMain('tray.open_panel'),
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
      label: isWalking ? tMain('tray.stop_walk') : tMain('tray.start_walk'),
      click: () => {
        if (isWalking) {
          stopPetWalk()
        } else {
          startPetWalk()
        }
        // 立即刷新菜单勾选状态
        if (tray) tray.setContextMenu(buildTrayMenu())
      }
    },
    {
      label: tMain('tray.quiet_mode'),
      type: 'checkbox',
      checked: settings.quietMode,
      click: (menuItem) => {
        const next = menuItem.checked
        const cur = readSettings()
        const updated = { ...cur, quietMode: next }
        writeSettings(updated)
        // 广播到所有窗口
        const windows = [petWindow, chatWindow, webPanelWindow]
        for (const w of windows) {
          if (w && !w.isDestroyed()) {
            try { w.webContents.send('settings:changed', updated) } catch { /* ignore */ }
          }
        }
        if (tray) tray.setContextMenu(buildTrayMenu())
      }
    },
    { type: 'separator' },
    {
      label: tMain('tray.about'),
      click: () => {
        const version = app.getVersion()
        dialog.showMessageBox({
          type: 'info',
          title: 'GraphPet',
          message: `GraphPet v${version}`,
          detail: tMain('tray.about_detail'),
          buttons: [tMain('tray.about_btn')]
        }).catch(() => { /* ignore */ })
      }
    },
    {
      label: tMain('tray.quit'),
      click: () => {
        app.quit()
      }
    }
  ])
}

/** 创建系统托盘图标和菜单 */
function createTray(): void {
  let icon: Electron.NativeImage
  try {
    if (fs.existsSync(ICON_PATH)) {
      icon = nativeImage.createFromPath(ICON_PATH)
      // 托盘图标缩小到 16x16（Windows 任务栏标准尺寸）
      icon = icon.resize({ width: 16, height: 16 })
    } else {
      icon = nativeImage.createEmpty()
    }
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('GraphPet - 知识图谱桌宠')
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      if (petWindow.isVisible() && !petWindow.isMinimized()) {
        petWindow.hide()
      } else {
        petWindow.show()
        petWindow.focus()
      }
    }
  })
}

// ======================== 设置读写 ========================

/** 应用设置类型（与 preload/index.ts 中的 AppSettings 保持一致） */
interface AppSettings {
  llmProvider: 'freellm' | 'freellmapi' | 'pollinations' | 'siliconflow' | 'ollama' | 'aliyun' | 'deepseek' | 'zhipu' | 'moonshot' | 'openai' | 'openai-compatible' | 'custom'
  llmModel: string
  llmApiBase: string
  llmApiKey: string
  llmTemperature: number
  proactiveIntervalMin: number
  quietMode: boolean
  autoStart: boolean
  petScale: number
  /** TTS 语音播报开关（开启后 Nito 回答会用 TTS 朗读） */
  ttsEnabled: boolean
  /** TTS provider：edge（微软免费在线）/ piper（本地离线） */
  ttsProvider: 'edge' | 'piper'
  /** TTS 语音角色（edge: ShortName；piper: 模型名） */
  ttsVoice: string
  /** VAD 语音打断开关（开启后用户说话时自动停止 TTS） */
  vadEnabled: boolean
  /** 主题模式：dark / light / auto（跟随系统） */
  theme: 'dark' | 'light' | 'auto'
  /** UI 语言（i18n）：zh / en */
  locale: 'zh' | 'en'
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
  ttsProvider: 'edge',
  ttsVoice: 'zh-CN-XiaoyiNeural',
  vadEnabled: false,
  theme: 'dark',
  locale: 'zh'
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
      // 物理动画进行中时拒绝手动移动（避免动画与拖拽冲突）
      if (isPhysicsAnimating) return
      win.setPosition(Math.round(x), Math.round(y))
    }
  })

  // 立绘物理动画：渲染进程拖拽松手时传初速度 (vx, vy)，主进程做 RAF 物理 + 边缘反弹
  // 参考 Shimeji-ee 的窗口物理：松手后惯性滑行，碰到屏幕边缘弹性反弹，速度阻尼衰减
  ipcMain.on('window:apply-physics', (event, vx: number, vy: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    if (isPhysicsAnimating) return
    // 速度阈值：太小的速度不启动动画（避免抖动）
    const speed = Math.sqrt(vx * vx + vy * vy)
    if (speed < 5) return

    isPhysicsAnimating = true
    // 保持非穿透，避免动画中鼠标穿透丢失事件
    forceInteractive = true
    setIgnoreMode(computeMouseMode())

    let curVx = vx
    let curVy = vy
    const damping = 0.92  // 阻尼系数（每帧速度衰减）
    const bounce = 0.7    // 弹性碰撞反弹系数
    const minSpeed = 0.5  // 停止阈值
    const intervalMs = 16 // ~60fps

    if (physicsTimer) clearInterval(physicsTimer)
    physicsTimer = setInterval(() => {
      if (!win || win.isDestroyed()) {
        if (physicsTimer) clearInterval(physicsTimer)
        physicsTimer = null
        isPhysicsAnimating = false
        return
      }
      try {
        const bounds = win.getBounds()
        let newX = bounds.x + curVx
        let newY = bounds.y + curVy

        // 取当前所在显示器（窗口中心点所在 display）做边缘检测
        const cx = newX + bounds.width / 2
        const cy = newY + bounds.height / 2
        const display = screen.getDisplayMatching({ x: Math.round(cx), y: Math.round(cy), width: bounds.width, height: bounds.height })
        const wa = display.workArea

        // X 方向边缘反弹
        if (newX < wa.x) {
          newX = wa.x
          curVx = -curVx * bounce
        } else if (newX + bounds.width > wa.x + wa.width) {
          newX = wa.x + wa.width - bounds.width
          curVx = -curVx * bounce
        }

        // Y 方向边缘反弹（顶部不反弹，让窗口贴顶；底部反弹强）
        if (newY < wa.y) {
          newY = wa.y
          curVy = Math.abs(curVy) * bounce
        } else if (newY + bounds.height > wa.y + wa.height) {
          newY = wa.y + wa.height - bounds.height
          curVy = -curVy * bounce
        }

        win.setPosition(Math.round(newX), Math.round(newY))

        // 阻尼衰减
        curVx *= damping
        curVy *= damping

        // 停止条件：速度小于阈值
        const curSpeed = Math.sqrt(curVx * curVx + curVy * curVy)
        if (curSpeed < minSpeed) {
          if (physicsTimer) clearInterval(physicsTimer)
          physicsTimer = null
          isPhysicsAnimating = false
          // 恢复穿透检测
          forceInteractive = false
          setIgnoreMode(computeMouseMode())
        }
      } catch {
        if (physicsTimer) clearInterval(physicsTimer)
        physicsTimer = null
        isPhysicsAnimating = false
        forceInteractive = false
        setIgnoreMode(computeMouseMode())
      }
    }, intervalMs)
  })

  // 强制交互模式：浮层显示/拖拽期间关闭鼠标穿透
  ipcMain.on('window:force-interactive', (_event, state: string) => {
    const next = state === 'force-on'
    if (forceInteractive === next) return
    // 立绘物理动画进行中时拒绝关闭穿透（避免拖拽 onDragEnd 100ms 后覆盖物理动画的 forceInteractive(true)）
    if (!next && isPhysicsAnimating) return
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
    // 刷新托盘菜单（安静模式等勾选状态需要同步）
    if (tray) tray.setContextMenu(buildTrayMenu())
    // 广播到所有窗口实现跨窗口同步（pet/chat/panel 共享同一份设置）
    const windows = [petWindow, chatWindow, webPanelWindow]
    for (const w of windows) {
      if (w && !w.isDestroyed()) {
        try {
          w.webContents.send('settings:changed', settings)
        } catch (e) {
          console.error('[GraphPet] 广播 settings:changed 失败:', e)
        }
      }
    }
  })

  // ============= 自定义 Live2D 模型导入 =============
  // 已导入模型目录：app.getPath('userData')/imported-models/<name>/
  function getImportedModelsDir(): string {
    const dir = path.join(app.getPath('userData'), 'imported-models')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  // 递归复制目录（异步，避免同步 IO 阻塞主进程 UI）
  async function copyDirRecursiveAsync(src: string, dest: string): Promise<void> {
    const fsp = fs.promises
    await fsp.mkdir(dest, { recursive: true })
    const entries = await fsp.readdir(src, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)
      if (entry.isDirectory()) {
        await copyDirRecursiveAsync(srcPath, destPath)
      } else if (entry.isFile()) {
        await fsp.copyFile(srcPath, destPath)
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
      // 路径穿越防护：规范化后必须仍指向原始 selectedDir 或其子目录
      const normalizedSelected = path.resolve(selectedDir)
      const dirName = path.basename(normalizedSelected)
      if (!dirName || dirName === '.' || dirName === '..') {
        return { success: false, error: '无效的目录名' }
      }
      // 找模型文件（异步 readdir）
      const files = await fs.promises.readdir(selectedDir)
      const modelFile = files.find((f) => f.toLowerCase().endsWith('.model3.json')) ?? files.find((f) => f.toLowerCase().endsWith('.model.json'))
      if (!modelFile) {
        return { success: false, error: '所选目录中未找到 .model3.json 或 .model.json 文件' }
      }
      const isCubism4 = modelFile.toLowerCase().endsWith('.model3.json')
      const format = isCubism4 ? 'cubism4' as const : 'cubism2' as const
      // 复制到 imported-models/<dirName>/
      const importedRoot = getImportedModelsDir()
      const destDir = path.join(importedRoot, dirName)
      // 路径穿越防护：destDir 必须在 importedRoot 下
      const normalizedDest = path.resolve(destDir)
      if (!normalizedDest.startsWith(path.resolve(importedRoot))) {
        return { success: false, error: '目标路径越界' }
      }
      // 若已存在同名模型，覆盖（异步 rm）
      if (fs.existsSync(destDir)) {
        await fs.promises.rm(destDir, { recursive: true, force: true })
      }
      // 异步复制避免阻塞主进程（Live2D 模型可能 50-200MB）
      await copyDirRecursiveAsync(selectedDir, destDir)
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
  // P1-K 修复：严格路径校验，原 startsWith 检查可被兄弟目录前缀绕过
  // （如 importedRoot=D:\a\imported，name=..\imported-evil\x => targetDir=D:\a\imported-evil\x，startsWith 仍为 true）
  ipcMain.handle('live2d:delete-imported', (_event, name: string) => {
    try {
      if (!name || typeof name !== 'string' || /[\\/]|\.\.|:/.test(name)) {
        return { success: false, error: '非法模型名' }
      }
      const importedRoot = path.resolve(getImportedModelsDir())
      const targetDir = path.resolve(importedRoot, name)
      // 严格边界：必须直接位于 importedRoot 之下（带路径分隔符）
      if (targetDir !== importedRoot && !targetDir.startsWith(importedRoot + path.sep)) {
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

  // 截屏喂食：截取宠物所在屏幕，保存为临时 PNG 文件返回路径
  // 前端拿到路径后调用 feedFile(filePath) 走现有喂食管道
  // 后端 _parse_image_with_ollama 会用 Ollama vision 模型描述图片
  // P1-L 修复：多显示器场景下原代码取 sources[0]（主屏），宠物在副屏时截错屏
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
      // 找宠物窗口当前所在显示器，匹配 source.name（多显示器支持）
      let source = sources[0]
      if (petWindow && !petWindow.isDestroyed()) {
        try {
          const petBounds = petWindow.getBounds()
          const display = screen.getDisplayMatching(petBounds)
          const matched = sources.find(s => {
            // source.name 在 Windows 上类似 "Screen 1 (DELL U2720Q)"，无法直接对齐 display.id
            // 但 desktopCapturer sources 顺序通常按 display id 升序，与 screen.getAllDisplays() 一致
            const allDisplays = screen.getAllDisplays()
            const idx = allDisplays.findIndex(d =>
              d.bounds.x === display.bounds.x && d.bounds.y === display.bounds.y
            )
            return idx >= 0 && s.name.includes(`Screen ${idx + 1}`)
          })
          if (matched) source = matched
        } catch {
          /* 取不到显示器就退回 sources[0] */
        }
      }
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
  // P1-J 修复：route 参数白名单校验，避免 executeJavaScript 注入
  // （原代码直接拼接 route 到 JS 字符串，渲染进程被 XSS 攻陷后可执行任意 JS）
  const PANEL_ROUTES = ['chat', 'memory', 'timeline', 'files', 'profile'] as const
  type PanelRoute = typeof PANEL_ROUTES[number]
  ipcMain.on('panel:open', (_event, route?: string) => {
    if (webPanelWindow && !webPanelWindow.isDestroyed()) {
      if (webPanelWindow.isMinimized()) {
        webPanelWindow.restore()
      }
      if (route && (PANEL_ROUTES as readonly string[]).includes(route)) {
        const safeRoute = route as PanelRoute
        webPanelWindow.webContents
          .executeJavaScript(`window.location.hash = '#/panel/${safeRoute}';`)
          .catch(() => {
            /* 忽略执行错误 */
          })
      }
      webPanelWindow.focus()
      return
    }
    createWebPanelWindow(route && (PANEL_ROUTES as readonly string[]).includes(route) ? route : undefined)
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
      const bounds = petWindow.getBounds()
      // 用宠物当前所在显示器的工作区（多显示器支持）
      const display = screen.getDisplayMatching(bounds)
      const { workArea } = display
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
  const primary = screen.getPrimaryDisplay()
  const defaultX = primary.workArea.x + primary.workArea.width - WINDOW_WIDTH - 20
  const defaultY = primary.workArea.y + primary.workArea.height - WINDOW_HEIGHT - 20

  // 尝试恢复上次窗口位置（多显示器场景：验证位置仍在某个有效显示器内）
  let restoreX = defaultX
  let restoreY = defaultY
  try {
    const sf = getStateFilePath()
    if (fs.existsSync(sf)) {
      const raw = fs.readFileSync(sf, 'utf-8')
      const data = JSON.parse(raw) as { petPos?: { x: number; y: number } }
      if (data.petPos && typeof data.petPos.x === 'number' && typeof data.petPos.y === 'number') {
        const probe = screen.getDisplayMatching({
          x: data.petPos.x,
          y: data.petPos.y,
          width: WINDOW_WIDTH,
          height: WINDOW_HEIGHT
        })
        // 确保位置在某个显示器的工作区内（留 20px 容差）
        const wa = probe.workArea
        if (
          data.petPos.x >= wa.x - 20 &&
          data.petPos.x <= wa.x + wa.width - WINDOW_WIDTH + 20 &&
          data.petPos.y >= wa.y - 20 &&
          data.petPos.y <= wa.y + wa.height - WINDOW_HEIGHT + 20
        ) {
          restoreX = data.petPos.x
          restoreY = data.petPos.y
        }
      }
    }
  } catch { /* 静默：读取失败用默认位置 */ }

  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: restoreX,
    y: restoreY,
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

  // 移动后保存位置（节流 500ms，避免高频写盘）
  let moveSaveTimer: NodeJS.Timeout | null = null
  win.on('move', () => {
    if (moveSaveTimer) clearTimeout(moveSaveTimer)
    moveSaveTimer = setTimeout(() => {
      try {
        if (win.isDestroyed()) return
        const b = win.getBounds()
        const sf = getStateFilePath()
        let data: Record<string, unknown> = {}
        if (fs.existsSync(sf)) {
          data = JSON.parse(fs.readFileSync(sf, 'utf-8'))
        }
        data.petPos = { x: b.x, y: b.y }
        fs.writeFileSync(sf, JSON.stringify(data, null, 2), 'utf-8')
      } catch { /* 静默：保存失败不影响使用 */ }
    }, 500)
  })

  win.on('closed', () => {
    if (petWindow === win) petWindow = null
    stopMousePolling()
    // P2 修复：清理立绘物理动画定时器，避免窗口销毁后 setInterval 继续跑
    if (physicsTimer) {
      clearInterval(physicsTimer)
      physicsTimer = null
      isPhysicsAnimating = false
      forceInteractive = false
    }
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

  // P2-M 修复：restorePetTop 防抖，避免 chatWindow + webPanel 同时 blur 时
  // 触发两次 setAlwaysOnTop 竞态（短时间内重复调用可能闪烁）
  let restorePetTopTimer: ReturnType<typeof setTimeout> | null = null
  const restorePetTop = () => {
    if (restorePetTopTimer) clearTimeout(restorePetTopTimer)
    restorePetTopTimer = setTimeout(() => {
      restorePetTopTimer = null
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.setAlwaysOnTop(true, 'screen-saver')
      }
    }, 50)
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

  // P2-M 修复：restorePetTop 防抖，避免 chatWindow + webPanel 同时 blur 时竞态
  let restorePetTopTimer: ReturnType<typeof setTimeout> | null = null
  const restorePetTop = () => {
    if (restorePetTopTimer) clearTimeout(restorePetTopTimer)
    restorePetTopTimer = setTimeout(() => {
      restorePetTopTimer = null
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.setAlwaysOnTop(true, 'screen-saver')
      }
    }, 50)
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

// P2-J 修复：移除重复的 second-instance 监听器（顶部行 29 已注册一次）
// 原代码在 gotTheLock 块内再次注册，导致回调执行两次（窗口 restore/show/focus 重复调用）

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

  // 屏幕感知：检测前台全屏应用，自动隐藏宠物避免遮挡
  // 参考 Open-LLM-VTuber 的 screen-aware 实现
  startFullscreenDetection()
})

// 应用退出时注销所有全局热键 + 停止轮询
app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll()
  } catch {
    /* ignore */
  }
  stopMousePolling()
  stopFullscreenDetection()
  // 清理立绘物理动画定时器，避免进程退出时 setInterval 泄漏
  if (physicsTimer) {
    clearInterval(physicsTimer)
    physicsTimer = null
    isPhysicsAnimating = false
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
    try {
      // SIGTERM 优雅退出，给 Python 一点时间 flush LightRAG 写入
      pythonProcess.kill()
      // Windows 上 SIGTERM 等同 SIGKILL，但保留 fallback 兜底
      // 若 2s 后仍存活则强制 kill（防止僵尸进程导致 kv_store 损坏）
      setTimeout(() => {
        if (pythonProcess && !pythonProcess.killed) {
          try {
            pythonProcess.kill('SIGKILL')
          } catch { /* ignore */ }
        }
      }, 2000)
    } catch (e) {
      console.error('[GraphPet] kill Python 失败:', e)
    }
    pythonProcess = null
  }
  if (tray) {
    tray.destroy()
    tray = null
  }
})
