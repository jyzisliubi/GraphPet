import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

// 气泡对话组件（对应 Task 7）
//
// 用于在宠物头顶/底部显示气泡，展示说话内容（主动对话、操作反馈、消化进度）。
// 设计要点：
// - 定位在窗口内顶部居中（宠物头顶上方），带小三角箭头指向宠物
// - 毛玻璃暗色背景 + 圆角 + 阴影
// - 淡入淡出动画（opacity 200ms）
// - 长内容可滚动（max-height 200px）
// - 支持简单 markdown：**粗体** 与换行（正则替换，不引入 markdown 库）
// - 点击气泡关闭（onClose）
// - pointer-events: auto（可点击），z-index 100（在 DragRegion 之上）
// - 支持思考气泡模式（isThinking）：显示"💭 思考中..."小气泡，带动画
//
// 自动消失定时由 store 层（bubbleStore）管理，组件本身不重复设置定时器，
// 仅根据 visible props 控制淡入淡出与 DOM 挂载/卸载。

/** 气泡组件 Props */
export interface BubbleProps {
  /** 气泡内容（支持 **粗体** 与换行） */
  message: string
  /** 是否显示 */
  visible: boolean
  /** 自动消失毫秒数，0=不自动消失，默认 4000（由 store 层管理定时） */
  duration?: number
  /** 关闭回调（点击气泡时触发） */
  onClose?: () => void
  /** 气泡位置，默认 top（宠物头顶上方） */
  position?: 'top' | 'bottom'
  /** 动态顶部偏移（来自 Live2D 模型实际头顶位置，优先级高于硬编码） */
  anchorTop?: number
  /** 是否显示思考气泡（带动画的"💭 思考中..."） */
  isThinking?: boolean
}

/** 气泡样式 CSS（含 ::before 三角箭头 + 淡入淡出 transition） */
const BUBBLE_CSS = `
.graphpet-bubble {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(24, 24, 27, 0.92);
  color: #e4e4e7;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  -webkit-font-smoothing: antialiased;
  line-height: 1.55;
  max-width: 280px;
  max-height: 200px;
  overflow-y: auto;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  pointer-events: auto;
  z-index: 100;
  word-break: break-word;
  white-space: pre-wrap;
  cursor: default;
  user-select: none;
  transition: opacity 200ms ease;
  animation: graphpet-bounce-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.graphpet-bubble--top { /* top 由内联样式动态控制 */ }
.graphpet-bubble--bottom { bottom: 20px; }
.graphpet-bubble--top::before {
  content: '';
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 6px solid rgba(24, 24, 27, 0.92);
}
.graphpet-bubble--top::after {
  content: '';
  position: absolute;
  bottom: -7px;
  left: 50%;
  transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 7px solid rgba(255, 255, 255, 0.08);
  z-index: -1;
}
.graphpet-bubble--bottom::before {
  content: '';
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 6px solid rgba(24, 24, 27, 0.92);
}
.graphpet-bubble--visible { opacity: 1; }
.graphpet-bubble--hidden { opacity: 0; pointer-events: none; }
.graphpet-bubble strong {
  color: #818cf8;
  font-weight: 600;
}
/* 思考气泡样式 */
.graphpet-bubble--thinking {
  padding: 8px 14px;
  font-size: 13px;
}
.graphpet-bubble-thinking-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
}
.graphpet-bubble-thinking-dots span {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #818cf8;
  animation: graphpet-thinking-bounce 1.2s infinite ease-in-out;
}
.graphpet-bubble-thinking-dots span:nth-child(2) {
  animation-delay: 0.2s;
}
.graphpet-bubble-thinking-dots span:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes graphpet-thinking-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}
`

const STYLE_ELEMENT_ID = 'graphpet-bubble-style'

/** 注入气泡样式到 document.head（全局仅注入一次） */
function injectBubbleStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ELEMENT_ID)) return
  const styleEl = document.createElement('style')
  styleEl.id = STYLE_ELEMENT_ID
  styleEl.textContent = BUBBLE_CSS
  document.head.appendChild(styleEl)
}

/**
 * 简单 markdown 渲染：支持 **粗体** 与换行
 *
 * 不引入 markdown 库，用正则分割 + React 元素渲染，
 * 避免使用 dangerouslySetInnerHTML 带来的 XSS 风险。
 */
function renderBubbleContent(text: string): ReactNode[] {
  const lines = text.split('\n')
  return lines.map((line, lineIdx) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g)
    const nodes = parts.map((part, partIdx) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return <strong key={`b-${lineIdx}-${partIdx}`}>{part.slice(2, -2)}</strong>
      }
      return <span key={`t-${lineIdx}-${partIdx}`}>{part}</span>
    })
    return (
      <span key={`l-${lineIdx}`}>
        {nodes}
        {lineIdx < lines.length - 1 && <br />}
      </span>
    )
  })
}

/**
 * 渲染思考气泡内容：💭 思考中... + 三点跳动动画
 */
function renderThinkingContent(): ReactNode {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      💭 思考中
      <span className="graphpet-bubble-thinking-dots">
        <span />
        <span />
        <span />
      </span>
    </span>
  )
}

/**
 * 气泡组件
 *
 * visible=true 时挂载并淡入；visible=false 时保持挂载播放淡出动画，
 * transition 结束后才卸载（保证淡出动画可见）。
 * isThinking=true 时显示带动画的"💭 思考中..."小气泡。
 */
export default function Bubble({
  message,
  visible,
  onClose,
  position = 'top',
  anchorTop,
  isThinking = false
}: BubbleProps): JSX.Element | null {
  const [shouldRender, setShouldRender] = useState<boolean>(false)
  const [isVisible, setIsVisible] = useState<boolean>(false)
  const [bounceComplete, setBounceComplete] = useState<boolean>(false)

  useEffect(() => {
    injectBubbleStyle()
  }, [])

  useEffect(() => {
    const shouldShow = visible || isThinking
    if (shouldShow) {
      setShouldRender(true)
      setBounceComplete(false)
      const raf = requestAnimationFrame(() => {
        setIsVisible(true)
      })
      return () => cancelAnimationFrame(raf)
    }
    setIsVisible(false)
  }, [visible, isThinking])

  const hasContent = isThinking || (message && message.length > 0)
  if (!shouldRender || !hasContent) {
    return null
  }

  const positionClass =
    position === 'bottom' ? 'graphpet-bubble--bottom' : 'graphpet-bubble--top'
  const visibilityClass = isVisible ? 'graphpet-bubble--visible' : 'graphpet-bubble--hidden'
  const thinkingClass = isThinking ? ' graphpet-bubble--thinking' : ''

  const handleTransitionEnd = (): void => {
    if (!visible && !isThinking) {
      setShouldRender(false)
    }
  }

  const handleAnimationEnd = (): void => {
    setBounceComplete(true)
  }

  const handleClick = (): void => {
    if (!isThinking) {
      onClose?.()
    }
  }

  const bubbleStyle: CSSProperties = bounceComplete
    ? { animation: 'none' }
    : {}

  const VIEW_HEIGHT = 580
  const DEFAULT_TOP = 150
  const MIN_TOP = 10
  const BOTTOM_SAFE_MARGIN = 20

  if (position === 'bottom') {
    Object.assign(bubbleStyle, { bottom: '20px' })
  } else if (anchorTop != null && anchorTop > 0) {
    const estimatedBubbleHeight = isThinking ? 40 : 80
    const spacing = 12
    let calculatedTop = anchorTop - estimatedBubbleHeight - spacing
    calculatedTop = Math.max(MIN_TOP, calculatedTop)
    const maxTop = VIEW_HEIGHT - estimatedBubbleHeight - BOTTOM_SAFE_MARGIN
    calculatedTop = Math.min(calculatedTop, maxTop)
    Object.assign(bubbleStyle, {
      top: `${calculatedTop}px`,
      bottom: 'auto'
    })
  } else {
    Object.assign(bubbleStyle, { top: `${DEFAULT_TOP}px` })
  }

  return (
    <div
      className={`graphpet-bubble ${positionClass}${thinkingClass} ${visibilityClass}`}
      style={bubbleStyle}
      onClick={handleClick}
      onTransitionEnd={handleTransitionEnd}
      onAnimationEnd={handleAnimationEnd}
      role={isThinking ? undefined : 'button'}
      tabIndex={isThinking ? undefined : 0}
    >
      {isThinking ? renderThinkingContent() : renderBubbleContent(message)}
    </div>
  )
}
