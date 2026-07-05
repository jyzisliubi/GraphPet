import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react'
import { Application, Ticker } from 'pixi.js'
import type { Live2DModel as Live2DModelType } from 'pixi-live2d-display'
import { setMouthCallback } from '../services/ttsService'
import { useLive2DAutoMotion } from '../hooks/useLive2DAutoMotion'
import type { PetMood } from '../hooks/usePetState'

/**
 * Live2D 画布组件
 *
 * 使用 PIXI.js + pixi-live2d-display 渲染 Live2D 模型。
 * 支持 Cubism 2 和 Cubism 4 两种格式，动态加载对应模块。
 *
 * 功能：
 * 1. 模型加载与淡入动画
 * 2. 自动缩放适配：contain 模式，模型完整显示在视口内
 * 3. 底部对齐、水平居中定位
 * 4. 闲置动作随机播放（8-12 秒间隔）
 * 5. 命令式 API：triggerMotion / setExpression / focus
 */

// ======================== 视口尺寸常量 ========================
/** 画布视图宽度（与宠物窗口一致） */
const VIEW_WIDTH = 380
/** 画布视图高度（与宠物窗口一致） */
const VIEW_HEIGHT = 580
/** 模型四周内边距，确保不贴边 */
const MODEL_PADDING = 50
/** 底部额外留白，确保脚完全可见 */
const BOTTOM_PADDING = 10

// ======================== 样式常量 ========================
const canvasContainerStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  background: 'transparent',
  pointerEvents: 'none',
  overflow: 'hidden'
}

const overlayStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#ffffff',
  fontSize: 14,
  textAlign: 'center',
  textShadow: '0 1px 2px rgba(0,0,0,0.6)',
  pointerEvents: 'none',
  userSelect: 'none',
  whiteSpace: 'pre-line'
}

// ======================== 动作/表情映射 ========================

/**
 * 表情编号到动作组的映射（Cubism 2 模型没有独立表情系统，
 * 通过表情编号映射到对应动作来实现表情切换）
 */
const EXPRESSION_TO_MOTION_MAP: Record<string, string> = {
  '0': 'idle',
  '1': 'tap_head',
  '2': 'thinking',
  '3': 'sad',
  '4': 'flick',
  '5': 'tap_body',
  '6': 'eat',
  '7': 'tap_head',
  default: 'idle',
  happy: 'tap_body',
  angry: 'shake',
  sad: 'sad',
  surprise: 'flick',
  love: 'tap_head',
  thinking: 'thinking',
  eat: 'eat',
  sleep: 'sleep',
  bye: 'bye'
}

/**
 * 动作组别名：不同模型的动作组命名不一致，
 * 通过别名列表按优先级查找可用动作组
 */
const MOTION_GROUP_ALIASES: Record<string, string[]> = {
  idle: ['idle', 'Idle'],
  tap_head: ['tap_head', 'tapBody', 'flickHead', 'FlickUp', 'Tap'],
  tap_body: ['tap_body', 'tapBody', 'Tap', 'FlickDown'],
  thinking: ['thinking', 'tap_body', 'tapBody', 'Tap', 'idle', 'Idle'],
  eat: ['eat', 'tap_body', 'tapBody', 'Tap', 'FlickDown'],
  sad: ['sad', 'shake', 'Shake'],
  flick: ['flick', 'flickHead', 'FlickUp'],
  shake: ['shake', 'Shake'],
  sleep: ['sleep', 'idle', 'Idle', 'Sleep'],
  bye: ['bye', 'shake', 'Shake', 'FlickUp']
}

/** 闲置时随机选择的动作组优先级列表（默认 neutral） */
const IDLE_MOTION_GROUPS_DEFAULT = [
  'idle',
  'Idle',
  'tap_head',
  'tapBody',
  'flickHead',
  'FlickUp',
  'sigh',
  'sleep',
  'Sleep'
]

/** 按 mood 调整闲置动作组优先级（前面的优先被选中） */
const MOOD_IDLE_PRIORITY: Record<PetMood, string[]> = {
  happy: ['tap_body', 'tapBody', 'tap_head', 'flickHead', 'idle', 'Idle'],
  excited: ['flick', 'flickHead', 'FlickUp', 'tap_head', 'tap_body', 'idle', 'Idle'],
  curious: ['thinking', 'tap_body', 'tapBody', 'tap_head', 'idle', 'Idle'],
  bored: ['sigh', 'sleep', 'Sleep', 'idle', 'Idle'],
  sleepy: ['sleep', 'Sleep', 'sigh', 'idle', 'Idle'],
  sad: ['sad', 'shake', 'Shake', 'sigh', 'idle', 'Idle'],
  neutral: IDLE_MOTION_GROUPS_DEFAULT
}

/** 根据 mood 获取闲置动作组优先级列表 */
function getIdleMotionGroupsByMood(mood: PetMood): string[] {
  return MOOD_IDLE_PRIORITY[mood] ?? IDLE_MOTION_GROUPS_DEFAULT
}

/** 闲置动作播放间隔：基础 8 秒 + 0~4 秒随机 */
const IDLE_INTERVAL_MS = 8000

// ======================== 模块缓存 ========================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cubism2Module: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cubism4Module: any = null

/**
 * 动态加载对应 Cubism 版本的 Live2D 模块（Vite 代码分割）
 * 首次调用时 import，后续复用缓存的模块
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLive2DModule(format: 'cubism2' | 'cubism4'): Promise<any> {
  if (format === 'cubism2') {
    if (!cubism2Module) {
      cubism2Module = await import('pixi-live2d-display/cubism2')
    }
    return cubism2Module
  } else {
    if (!cubism4Module) {
      cubism4Module = await import('pixi-live2d-display/cubism4')
    }
    return cubism4Module
  }
}

// ======================== 工具函数 ========================

/** 从数组中随机选取一个元素 */
function randomFromArray<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ======================== 组件 Props & API ========================

/** Live2DCanvas 命令式 API，通过 onModelReady 回调暴露给父组件 */
export interface Live2DCanvasAPI {
  /** 切换表情（Cubism 4 直接切换；Cubism 2 通过映射动作实现） */
  setExpression: (name: number | string) => void
  /** 触发指定动作组 */
  triggerMotion: (group: string, index?: number) => void
  /** 触发模型视线跟随（如有） */
  focus: () => void
}

/** 模型位置信息，用于 Bubble 等组件动态定位 */
export interface ModelPosition {
  /** 模型可见边界顶部 Y 坐标（画布坐标系） */
  headY: number
}

interface Live2DCanvasProps {
  /** 模型文件 URL（file:// 协议，主进程返回） */
  modelPath: string
  /** 模型格式：cubism2 或 cubism4 */
  modelFormat: 'cubism2' | 'cubism4'
  /** 模型加载就绪回调，传入命令式 API + 位置信息 */
  onModelReady?: (api: Live2DCanvasAPI, position: ModelPosition) => void
  /** 模型加载失败回调 */
  onError?: (error: string) => void
  /** 当前心情（来自 usePetState），影响闲置动作选择优先级 */
  mood?: PetMood
}

// ======================== 组件实现 ========================

export default function Live2DCanvas({
  modelPath,
  modelFormat,
  onModelReady,
  onError,
  mood = 'neutral'
}: Live2DCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelRef = useRef<any>(null)
  const formatRef = useRef<'cubism2' | 'cubism4'>(modelFormat)
  const onModelReadyRef = useRef(onModelReady)
  const onErrorRef = useRef(onError)
  // mood 用 ref 持有最新值，避免 mood 变化触发模型重新加载
  const moodRef = useRef<PetMood>(mood)
  moodRef.current = mood

  // 始终保持 ref 为最新回调，避免 effect 依赖陈旧闭包
  onModelReadyRef.current = onModelReady
  onErrorRef.current = onError

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [fadeIn, setFadeIn] = useState<boolean>(false)

  // 自动生命感：auto blink + auto look at + idle eye movement
  useLive2DAutoMotion(modelRef, { enabled: !loading && !error })

  /**
   * 内部触发动作实现
   * 查找目标动作组（支持别名回退），随机选择动作索引
   */
  const triggerMotionInternal = useCallback((group: string, index?: number): void => {
    const m = modelRef.current
    if (!m) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const motionManager = (m.internalModel as any).motionManager
      const definitions = motionManager.definitions as Record<string, unknown[]>
      const availableGroups = Object.keys(definitions || {})
      if (availableGroups.length === 0) return

      let targetGroup = group
      if (targetGroup && MOTION_GROUP_ALIASES[targetGroup]) {
        targetGroup =
          MOTION_GROUP_ALIASES[targetGroup].find((g) => availableGroups.includes(g)) ||
          targetGroup
      }
      if (!targetGroup || !availableGroups.includes(targetGroup)) {
        const priority = ['tap_body', 'tapBody', 'tap_head', 'flickHead', 'flick', 'idle']
        targetGroup =
          priority.find((g) => availableGroups.includes(g)) || availableGroups[0]
      }

      const motions = definitions[targetGroup] as unknown[] | undefined
      const motionIndex =
        index ?? (motions && motions.length > 0 ? Math.floor(Math.random() * motions.length) : 0)
      void m.motion(targetGroup, motionIndex)
    } catch (e) {
      console.warn('[Live2DCanvas] 触发动作失败:', e)
    }
  }, [])

  /**
   * 调度下一次闲置动作
   * 递归调用自身实现循环，8~12 秒随机间隔
   * v0.3.4：根据 moodRef 选择对应心情的优先动作组
   */
  const scheduleIdleMotion = useCallback((): void => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
    }
    idleTimerRef.current = setTimeout(() => {
      const m = modelRef.current
      if (!m) return
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const motionManager = (m.internalModel as any).motionManager
        const definitions = motionManager.definitions as Record<string, unknown[]>
        const availableGroups = Object.keys(definitions || {})
        // v0.3.4：按当前 mood 选择优先动作组列表
        const idleGroups = getIdleMotionGroupsByMood(moodRef.current)
        const pickableGroups = idleGroups.filter((g) => availableGroups.includes(g))
        if (pickableGroups.length > 0 && !motionManager.playing) {
          const group = randomFromArray(pickableGroups)
          const motions = definitions[group] as unknown[] | undefined
          if (motions && motions.length > 0) {
            const idx = Math.floor(Math.random() * motions.length)
            void m.motion(group, idx)
          }
        }
      } catch {
        /* 忽略闲置动作错误 */
      }
      scheduleIdleMotion()
    }, IDLE_INTERVAL_MS + Math.random() * 4000)
  }, [])

  /**
   * 内部切换表情实现
   * Cubism 4 优先调用 model.expression()；失败或 Cubism 2 回退到动作映射
   */
  const setExpressionInternal = useCallback(
    (name: number | string): void => {
      const m = modelRef.current
      if (!m) return
      const key = String(name).toLowerCase()
      const motionGroup = EXPRESSION_TO_MOTION_MAP[key] || EXPRESSION_TO_MOTION_MAP['default']
      if (formatRef.current === 'cubism2') {
        triggerMotionInternal(motionGroup)
      } else {
        try {
          void m.expression(name)
        } catch (e) {
          console.warn('[Live2DCanvas] 切换表情失败，尝试动作:', e)
          triggerMotionInternal(motionGroup)
        }
      }
    },
    [triggerMotionInternal]
  )

  /** 触发视线跟随（如模型支持） */
  const focusInternal = useCallback((): void => {
    const m = modelRef.current
    if (!m) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(m as any).focus?.()
    } catch {
      /* 忽略 */
    }
  }, [])

  // 模型加载/卸载 effect：modelPath 变化时重新加载
  useEffect(() => {
    const container = containerRef.current
    if (!container || !modelPath) return

    let destroyed = false
    formatRef.current = modelFormat
    setLoading(true)
    setError(null)

    // 创建 PIXI 应用
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app: any = new Application({
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1
    })
    appRef.current = app
    container.appendChild(app.view)

    // 暴露 PIXI 到全局（部分 Live2D 运行时依赖全局 PIXI）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).PIXI = Application

    const initModel = async (): Promise<void> => {
      try {
        const mod = await getLive2DModule(modelFormat)
        const { Live2DModel } = mod as {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          Live2DModel: any
        }

        Live2DModel.registerTicker(Ticker)
        const model = (await Live2DModel.from(modelPath)) as Live2DModelType

        // 组件已卸载则销毁模型，避免内存泄漏
        if (destroyed) {
          model.destroy()
          return
        }

        modelRef.current = model
        app.stage.addChild(model)

        const modelW = model.width as number
        const modelH = model.height as number
        console.log('[Live2DCanvas] 模型原始尺寸:', modelW, modelH, '格式:', modelFormat)

        if (modelW <= 0 || modelH <= 0) {
          throw new Error('模型尺寸异常（width/height <= 0）')
        }

        // ========== 使用 getBounds() 获取实际可见边界 ==========
        let boundsX = 0
        let boundsY = 0
        let boundsW = modelW
        let boundsH = modelH

        try {
          const bounds = model.getBounds()
          if (bounds && bounds.width > 0 && bounds.height > 0) {
            boundsX = bounds.x
            boundsY = bounds.y
            boundsW = bounds.width
            boundsH = bounds.height
            console.log('[Live2DCanvas] getBounds() 返回:', {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height
            })
          } else {
            console.warn('[Live2DCanvas] getBounds() 返回无效值，使用模型原始尺寸')
          }
        } catch (e) {
          console.warn('[Live2DCanvas] getBounds() 调用失败，使用模型原始尺寸:', e)
        }

        // ========== 关键：contain 缩放 + 底部对齐 + 水平居中（使用可见边界） ==========
        const availableW = VIEW_WIDTH - MODEL_PADDING * 2
        const availableH = VIEW_HEIGHT - MODEL_PADDING * 2 - BOTTOM_PADDING
        const containScale = Math.min(availableW / boundsW, availableH / boundsH)
        model.scale.set(containScale)

        const scaledBoundsW = boundsW * containScale
        const scaledBoundsH = boundsH * containScale

        // 水平居中：基于可见边界居中
        model.x = (VIEW_WIDTH - scaledBoundsW) / 2 - boundsX * containScale
        // 底部对齐：可见边界底边在 VIEW_HEIGHT - MODEL_PADDING - BOTTOM_PADDING
        model.y = VIEW_HEIGHT - MODEL_PADDING - BOTTOM_PADDING - scaledBoundsH - boundsY * containScale

        // 模型可见边界顶部 Y（即 Nito 头顶在画布上的坐标）
        const headY = model.y + boundsY * containScale

        console.log('[Live2DCanvas] 定位计算:', {
          containScale,
          boundsX,
          boundsY,
          boundsW,
          boundsH,
          modelX: model.x,
          modelY: model.y,
          scaledBoundsW,
          scaledBoundsH,
          headY,
          viewW: VIEW_WIDTH,
          viewH: VIEW_HEIGHT,
          padding: MODEL_PADDING,
          bottomPadding: BOTTOM_PADDING
        })

        // 日志：打印可用动作组
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const motionDefs = (model.internalModel as any).motionManager.definitions
          console.log('[Live2DCanvas] 可用动作组:', Object.keys(motionDefs || {}))
        } catch {
          /* 忽略 */
        }

        setLoading(false)
        // 双 rAF 确保首帧渲染后再淡入
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setFadeIn(true))
        })

        onModelReadyRef.current?.(
          {
            setExpression: setExpressionInternal,
            triggerMotion: triggerMotionInternal,
            focus: focusInternal
          },
          { headY }
        )

        // 注册 TTS 口型同步回调：音频播放时驱动 ParamMouthOpenY
        // Cubism 2/4 模型均使用 ParamMouthOpenY 参数；失败静默（不影响渲染）
        setMouthCallback((open: number): void => {
          try {
            const m = modelRef.current
            if (!m) return
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const core = (m.internalModel as any)?.coreModel
            if (core?.setParameterValueById) {
              core.setParameterValueById('ParamMouthOpenY', open)
            } else if (core?.setParamFloat) {
              // Cubism 2 旧 API 兜底
              core.setParamFloat('ParamMouthOpenY', open)
            }
          } catch {
            /* 静默：参数不存在或模型未就绪 */
          }
        })

        scheduleIdleMotion()
      } catch (err) {
        if (destroyed) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[Live2DCanvas] 模型加载失败:', err)
        setError(msg)
        setLoading(false)
        onErrorRef.current?.(msg)
      }
    }

    initModel()

    // 清理函数
    return () => {
      destroyed = true
      // 清理 TTS 口型回调，防止卸载后仍被调用导致空指针
      setMouthCallback(null)
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
      if (modelRef.current) {
        modelRef.current.destroy()
        modelRef.current = null
      }
      if (appRef.current) {
        const view = appRef.current.view as HTMLCanvasElement
        if (view.parentNode) {
          view.parentNode.removeChild(view)
        }
        appRef.current.destroy(true, { children: true })
        appRef.current = null
      }
    }
  }, [
    modelPath,
    modelFormat,
    setExpressionInternal,
    triggerMotionInternal,
    focusInternal,
    scheduleIdleMotion
  ])

  return (
    <>
      <div
        ref={containerRef}
        style={{
          ...canvasContainerStyle,
          opacity: fadeIn ? 1 : 0,
          transition: 'opacity 0.6s ease-in'
        }}
      />
      {loading && <div style={overlayStyle}>正在加载 Nito...</div>}
      {error && <div style={overlayStyle}>{`Nito 加载失败：${error}`}</div>}
    </>
  )
}
