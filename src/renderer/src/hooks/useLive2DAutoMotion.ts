import { useEffect, useRef } from 'react'

/**
 * useLive2DAutoMotion - Live2D 自动生命感驱动
 *
 * 参考 AIRI 的「Auto blink / Auto look at / Idle eye movement」三大件。
 * 让桌宠静态时不再呆滞：会眨眼、目光追随鼠标、偶尔游动眼球。
 *
 * 实现方式：通过 PIXI.Ticker 注入每帧回调，调用 Cubism 核心模型的
 * setParameterValueById 直接驱动参数（与动作系统解耦，互不干扰）。
 *
 * 三大行为：
 * 1. Auto Blink - 随机间隔 2~5s 触发一次眨眼（120ms 完成）
 * 2. Auto Look At - 鼠标位置映射到 ParamAngleX/Y + ParamEyeBallX/Y
 * 3. Idle Eye Movement - 每 4~9s 随机选一个小目标点，平滑过渡眼球
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = any

interface AutoMotionOptions {
  /** 是否启用（默认 true） */
  enabled?: boolean
  /** 自动眨眼间隔下限（ms） */
  blinkIntervalMin?: number
  /** 自动眨眼间隔上限（ms） */
  blinkIntervalMax?: number
  /** 眨眼持续时间（ms） */
  blinkDurationMs?: number
  /** 闲置眼球游动间隔下限（ms） */
  idleEyeIntervalMin?: number
  /** 闲置眼球游动间隔上限（ms） */
  idleEyeIntervalMax?: number
  /** 头部最大旋转角度（度，Cubism 参数范围 -30~30） */
  maxHeadAngle?: number
  /** 眼球最大偏移（Cubism 参数范围 -1~1） */
  maxEyeBallOffset?: number
  /** 鼠标位置到参数的平滑系数（0~1，越大跟随越快） */
  smoothing?: number
}

interface AutoMotionState {
  // 眨眼状态
  nextBlinkAt: number
  blinkStartAt: number | null
  // 闲置眼球游动
  nextIdleEyeAt: number
  idleEyeTargetX: number
  idleEyeTargetY: number
  // 当前平滑后的角度/眼球值
  currentHeadX: number
  currentHeadY: number
  currentEyeX: number
  currentEyeY: number
  // 鼠标位置（屏幕坐标 → 归一化 -1~1）
  mouseX: number
  mouseY: number
}

/**
 * 平滑插值（lerp）
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * 在 [min, max) 范围内生成随机数
 */
function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/**
 * Cubism 4 与 Cubism 2 都支持通过 coreModel.setParameterValueById 设置参数。
 * Cubism 2 旧 API 是 setParamFloat，名称相同。
 */
function safeSetParam(coreModel: AnyModel, name: string, value: number): void {
  try {
    if (!coreModel) return
    if (typeof coreModel.setParameterValueById === 'function') {
      coreModel.setParameterValueById(name, value)
    } else if (typeof coreModel.setParamFloat === 'function') {
      coreModel.setParamFloat(name, value)
    }
  } catch {
    /* 静默：参数不存在或模型未就绪 */
  }
}

/**
 * 启动 Live2D 自动生命感驱动
 *
 * @param modelRef Live2DModel ref（来自 pixi-live2d-display）
 * @param options 配置项
 * @returns cleanup 函数（卸载时调用）
 */
export function useLive2DAutoMotion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelRef: React.MutableRefObject<AnyModel | null>,
  options: AutoMotionOptions = {}
): void {
  const {
    enabled = true,
    blinkIntervalMin = 2000,
    blinkIntervalMax = 5000,
    blinkDurationMs = 120,
    idleEyeIntervalMin = 4000,
    idleEyeIntervalMax = 9000,
    maxHeadAngle = 30,
    maxEyeBallOffset = 1,
    smoothing = 0.08
  } = options

  // 用 ref 存所有状态，避免每帧触发 React 重渲染
  const stateRef = useRef<AutoMotionState>({
    nextBlinkAt: Date.now() + randomBetween(blinkIntervalMin, blinkIntervalMax),
    blinkStartAt: null,
    nextIdleEyeAt: Date.now() + randomBetween(idleEyeIntervalMin, idleEyeIntervalMax),
    idleEyeTargetX: 0,
    idleEyeTargetY: 0,
    currentHeadX: 0,
    currentHeadY: 0,
    currentEyeX: 0,
    currentEyeY: 0,
    mouseX: 0,
    mouseY: 0
  })

  // 鼠标移动监听：仅记录位置，不直接驱动（每帧统一处理）
  useEffect(() => {
    if (!enabled) return
    const onMove = (e: MouseEvent): void => {
      const w = window.innerWidth || 1
      const h = window.innerHeight || 1
      const s = stateRef.current
      // 归一化到 -1~1（屏幕中心为 0）
      s.mouseX = (e.clientX / w) * 2 - 1
      s.mouseY = (e.clientY / h) * 2 - 1
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [enabled])

  // Ticker 注入：每帧驱动参数
  useEffect(() => {
    if (!enabled) return
    let rafId = 0
    const tick = (): void => {
      const m = modelRef.current
      if (!m) {
        rafId = requestAnimationFrame(tick)
        return
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const core = (m.internalModel as any)?.coreModel
        if (!core) {
          rafId = requestAnimationFrame(tick)
          return
        }

        const now = Date.now()
        const s = stateRef.current

        // ========== 1. Auto Blink ==========
        // 触发新眨眼
        if (s.blinkStartAt === null && now >= s.nextBlinkAt) {
          s.blinkStartAt = now
        }
        // 眨眼动画进行中：闭合 → 张开（三角波）
        let eyeOpen = 1
        if (s.blinkStartAt !== null) {
          const elapsed = now - s.blinkStartAt
          if (elapsed >= blinkDurationMs) {
            // 眨眼结束
            s.blinkStartAt = null
            s.nextBlinkAt = now + randomBetween(blinkIntervalMin, blinkIntervalMax)
            eyeOpen = 1
          } else {
            // 0~half: 1→0；half~end: 0→1
            const half = blinkDurationMs / 2
            const t = elapsed < half ? elapsed / half : (blinkDurationMs - elapsed) / half
            eyeOpen = Math.max(0, 1 - t)
          }
        }
        safeSetParam(core, 'ParamEyeLOpen', eyeOpen)
        safeSetParam(core, 'ParamEyeROpen', eyeOpen)

        // ========== 2. Idle Eye Movement ==========
        // 到时间换一个闲置目标点
        if (now >= s.nextIdleEyeAt) {
          s.idleEyeTargetX = randomBetween(-0.4, 0.4)
          s.idleEyeTargetY = randomBetween(-0.3, 0.3)
          s.nextIdleEyeAt = now + randomBetween(idleEyeIntervalMin, idleEyeIntervalMax)
        }

        // ========== 3. Auto Look At ==========
        // 鼠标位置 + 闲置目标点的混合（鼠标主导，闲置为微扰）
        const targetHeadX = s.mouseX * maxHeadAngle * 0.7 + s.idleEyeTargetX * maxHeadAngle * 0.3
        const targetHeadY = -s.mouseY * maxHeadAngle * 0.7 - s.idleEyeTargetY * maxHeadAngle * 0.3
        const targetEyeX = s.mouseX * maxEyeBallOffset * 0.8 + s.idleEyeTargetX
        const targetEyeY = -s.mouseY * maxEyeBallOffset * 0.8 - s.idleEyeTargetY

        // 平滑插值
        s.currentHeadX = lerp(s.currentHeadX, targetHeadX, smoothing)
        s.currentHeadY = lerp(s.currentHeadY, targetHeadY, smoothing)
        s.currentEyeX = lerp(s.currentEyeX, targetEyeX, smoothing)
        s.currentEyeY = lerp(s.currentEyeY, targetEyeY, smoothing)

        safeSetParam(core, 'ParamAngleX', s.currentHeadX)
        safeSetParam(core, 'ParamAngleY', s.currentHeadY)
        safeSetParam(core, 'ParamEyeBallX', s.currentEyeX)
        safeSetParam(core, 'ParamEyeBallY', s.currentEyeY)
      } catch {
        /* 静默：参数驱动失败不影响渲染 */
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [enabled, modelRef, blinkIntervalMin, blinkIntervalMax, blinkDurationMs, idleEyeIntervalMin, idleEyeIntervalMax, maxHeadAngle, maxEyeBallOffset, smoothing])
}
