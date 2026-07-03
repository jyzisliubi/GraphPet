import type { CSSProperties } from 'react'

// Live2D 模型未就绪时的占位组件
//
// 显示一个可爱的渐变圆形 + "Nito" 文字 + 下载提示。
// 该组件可被 DragRegion 包裹作为其 children，从而支持拖拽窗口。
// 占位元素本身不接收鼠标事件（pointerEvents: 'none'），事件冒泡到 DragRegion。

interface Live2DPlaceholderProps {
  /** 可选错误信息（如加载失败）；不传则显示通用的"模型未就绪"提示 */
  error?: string | null
}

const containerStyle: CSSProperties = {
  width: 400,
  height: 500,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  userSelect: 'none',
  // 占位组件本身不接收事件，由 DragRegion 处理拖拽
  pointerEvents: 'none'
}

// 品牌色圆形（呼应 Nito 二头身角色风格）
const circleStyle: CSSProperties = {
  width: 160,
  height: 160,
  borderRadius: '50%',
  background: 'var(--gp-brand)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#ffffff',
  fontSize: 30,
  fontWeight: 700,
  letterSpacing: 1,
  textShadow: '0 2px 6px rgba(0,0,0,0.35)',
  boxShadow: 'var(--gp-shadow-md)'
}

const messageStyle: CSSProperties = {
  marginTop: 20,
  color: '#ffffff',
  fontSize: 13,
  textAlign: 'center',
  lineHeight: 1.6,
  textShadow: '0 1px 2px rgba(0,0,0,0.6)',
  whiteSpace: 'pre-line'
}

const hintStyle: CSSProperties = {
  marginTop: 8,
  color: 'rgba(255,255,255,0.78)',
  fontSize: 11,
  textAlign: 'center',
  textShadow: '0 1px 2px rgba(0,0,0,0.6)',
  fontFamily: 'Consolas, "Courier New", monospace'
}

export default function Live2DPlaceholder({
  error
}: Live2DPlaceholderProps): JSX.Element {
  // 优先显示错误信息；否则显示"模型未就绪"通用提示
  const message = error
    ? `Nito 加载失败\n${error}`
    : 'Nito 模型未就绪\n请运行 assets/live2d/download-nito.ps1 下载模型'

  return (
    <div style={containerStyle}>
      <div style={circleStyle}>Nito</div>
      <div style={messageStyle}>{message}</div>
      <div style={hintStyle}>download-nito.ps1</div>
    </div>
  )
}
