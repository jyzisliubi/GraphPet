import { useContext, useMemo } from 'react'
import { BubbleContext } from '../stores/bubbleStore'
import type { BubbleProps } from '../components/Bubble'

// 气泡显示逻辑自定义 Hook
//
// 封装 bubbleStore 的状态与方法，返回可直接传给 <Bubble /> 组件的 props，
// 以及 showMessage / hideBubble 控制方法。
//
// 使用方式：
//   const { bubbleProps, showMessage, hideBubble } = useBubble()
//   showMessage('你好，我是 Nito~')        // 显示，默认 4 秒后自动消失
//   showMessage('消化中...', 0)            // 显示，不自动消失
//   hideBubble()                           // 手动隐藏
//   <Bubble {...bubbleProps} />

/** useBubble 返回值 */
export interface UseBubbleResult {
  /** 传给 Bubble 组件的 props（message/visible/duration/onClose/position） */
  bubbleProps: BubbleProps
  /** 显示气泡；duration 默认 4000ms，0 表示不自动消失 */
  showMessage: (message: string, duration?: number) => void
  /** 隐藏气泡 */
  hideBubble: () => void
}

/**
 * 封装气泡显示逻辑
 * @param position 气泡位置，默认 'top'（宠物头顶上方）
 * @throws 若未在 BubbleProvider 内使用则抛错
 */
export function useBubble(position: 'top' | 'bottom' = 'top'): UseBubbleResult {
  const ctx = useContext(BubbleContext)
  if (!ctx) {
    throw new Error('useBubble 必须在 BubbleProvider 内使用')
  }
  const { state, show, hide } = ctx

  // 用 useMemo 稳定 bubbleProps 引用，避免 Bubble 组件不必要的重渲染
  // 依赖：state 三个字段 + hide（来自 useCallback，引用稳定）+ position
  const bubbleProps = useMemo<BubbleProps>(
    () => ({
      message: state.message ?? '',
      visible: state.visible,
      duration: state.duration,
      onClose: hide,
      position
    }),
    [state.message, state.visible, state.duration, hide, position]
  )

  return {
    bubbleProps,
    showMessage: show,
    hideBubble: hide
  }
}
