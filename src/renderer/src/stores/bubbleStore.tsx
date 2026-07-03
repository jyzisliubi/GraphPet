import { createContext, useCallback, useEffect, useReducer, useRef } from 'react'
import type { ReactNode } from 'react'

// 气泡状态管理（用 useReducer + Context 实现，避免引入 zustand 依赖）
//
// 职责：
// - 维护气泡状态 { message, visible, duration }
// - 提供 show / hide 方法
// - show 时启动自动消失定时器（duration=0 不自动消失）
// - 新 show 取消旧的定时器，避免重复触发

/** 默认自动消失时长（毫秒） */
const DEFAULT_DURATION = 5000

/** 气泡状态 */
export interface BubbleState {
  /** 气泡内容；null 表示无内容 */
  message: string | null
  /** 是否可见 */
  visible: boolean
  /** 自动消失时长（毫秒）；0 表示不自动消失 */
  duration: number
}

/** 初始状态 */
export const initialBubbleState: BubbleState = {
  message: null,
  visible: false,
  duration: DEFAULT_DURATION
}

/** Reducer 动作类型 */
export type BubbleAction =
  | { type: 'show'; message: string; duration: number }
  | { type: 'hide' }

/**
 * 气泡状态 Reducer
 * - show：设置 message + visible=true + duration
 * - hide：仅切换 visible=false，保留 message 以便淡出动画期间显示旧内容
 */
export function bubbleReducer(state: BubbleState, action: BubbleAction): BubbleState {
  switch (action.type) {
    case 'show':
      return {
        message: action.message,
        visible: true,
        duration: action.duration
      }
    case 'hide':
      return {
        ...state,
        visible: false
      }
    default:
      return state
  }
}

/** Context 值：状态 + show/hide 方法 */
export interface BubbleContextValue {
  /** 当前气泡状态 */
  state: BubbleState
  /** 显示气泡；duration 默认 4000ms，0 表示不自动消失 */
  show: (message: string, duration?: number) => void
  /** 隐藏气泡（并清除自动消失定时器） */
  hide: () => void
}

/**
 * Context 默认值为 null，便于 useBubble 检测是否在 Provider 内使用
 */
export const BubbleContext = createContext<BubbleContextValue | null>(null)

/** Provider Props */
export interface BubbleProviderProps {
  children: ReactNode
}

/**
 * 气泡状态 Provider
 *
 * 在应用根节点包裹此 Provider，子组件即可通过 useBubble hook 控制气泡。
 * 内部用 useRef 持有 setTimeout 句柄，确保新 show 取消旧定时器，卸载时清理。
 */
export function BubbleProvider({ children }: BubbleProviderProps): JSX.Element {
  const [state, dispatch] = useReducer(bubbleReducer, initialBubbleState)

  // 自动消失定时器句柄（用 ReturnType<typeof setTimeout> 兼容浏览器/Node 类型）
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 清除当前定时器
  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // 显示气泡：先取消旧定时器，再 dispatch show，最后按 duration 启动新定时器
  const show = useCallback(
    (message: string, duration: number = DEFAULT_DURATION): void => {
      clearTimer()
      dispatch({ type: 'show', message, duration })
      // duration=0 表示不自动消失
      if (duration > 0) {
        timerRef.current = setTimeout(() => {
          dispatch({ type: 'hide' })
          timerRef.current = null
        }, duration)
      }
    },
    [clearTimer]
  )

  // 隐藏气泡：清除定时器 + dispatch hide
  const hide = useCallback((): void => {
    clearTimer()
    dispatch({ type: 'hide' })
  }, [clearTimer])

  // 卸载时清理定时器，避免内存泄漏与卸载后 setState
  useEffect(() => {
    return () => {
      clearTimer()
    }
  }, [clearTimer])

  return (
    <BubbleContext.Provider value={{ state, show, hide }}>
      {children}
    </BubbleContext.Provider>
  )
}
