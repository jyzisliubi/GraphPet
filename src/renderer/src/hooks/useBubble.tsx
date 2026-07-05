import { useContext, useMemo } from 'react'
import { BubbleContext } from '../stores/bubbleStore'
import type { BubbleProps } from '../components/Bubble'

// 气泡显示逻辑自定义 Hook
//
// 封装 bubbleStore 的状态与方法，返回可直接传给 <Bubble /> 组件的 props，
// 以及 showMessage / showInnerThought / hideBubble 控制方法。
//
// 使用方式：
//   const { bubbleProps, showMessage, showInnerThought, hideBubble } = useBubble()
//   showMessage('你好，我是 Nito~')        // 显示，默认 5 秒后自动消失
//   showMessage('消化中...', 0)            // 显示，不自动消失
//   showInnerThought('今天的云好像棉花糖')  // 云朵风格内心想法，3.5 秒消失
//   hideBubble()                           // 手动隐藏
//   <Bubble {...bubbleProps} />

/** useBubble 返回值 */
export interface UseBubbleResult {
  /** 传给 Bubble 组件的 props（message/visible/duration/onClose/position/isInnerThought） */
  bubbleProps: BubbleProps
  /** 显示气泡；duration 默认 5000ms，0 表示不自动消失 */
  showMessage: (message: string, duration?: number) => void
  /** 显示内心想法气泡（云朵风格，默认 3500ms 自动消失） */
  showInnerThought: (message: string, duration?: number) => void
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
  const { state, show, showInnerThought, hide } = ctx

  // 用 useMemo 稳定 bubbleProps 引用，避免 Bubble 组件不必要的重渲染
  // 依赖：state 四个字段 + hide（来自 useCallback，引用稳定）+ position
  const bubbleProps = useMemo<BubbleProps>(
    () => ({
      message: state.message ?? '',
      visible: state.visible,
      duration: state.duration,
      onClose: hide,
      position,
      isInnerThought: state.isInnerThought
    }),
    [state.message, state.visible, state.duration, state.isInnerThought, hide, position]
  )

  return {
    bubbleProps,
    showMessage: show,
    showInnerThought,
    hideBubble: hide
  }
}
