import type { CSSProperties } from 'react'
import type { TripleItem } from '../services/feedService'

// P1-C：喂食后三元组预览卡片
//
// 喂食成功后弹出，展示"Nito 学到了什么"：
// - 顶部显示文件名 + 新增实体/三元组数量
// - 中间为三元组列表（head → relation → tail）
// - 底部"查看完整图谱"按钮跳转 MemoryGraph
// - 最多展示 20 条，超出显示"等 N 条更多"

export interface TriplePreviewCardProps {
  /** 是否显示 */
  visible: boolean
  /** 文件名 */
  fileName: string
  /** 新增三元组列表 */
  triples: TripleItem[]
  /** 实体总数 */
  entityCount: number
  /** 三元组总数 */
  tripleCount: number
  /** 关闭回调 */
  onClose: () => void
  /** 查看完整图谱回调（跳转 MemoryGraph 面板） */
  onViewGraph: () => void
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.6)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
  pointerEvents: 'auto'
}

const cardStyle: CSSProperties = {
  width: 460,
  maxHeight: 520,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  padding: 20,
  background: '#18181b',
  border: '1px solid #27272a',
  borderRadius: 14,
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
  color: '#e4e4e7'
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginBottom: 4
}

const titleStyle: CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  color: '#e4e4e7',
  margin: 0
}

const subtitleStyle: CSSProperties = {
  fontSize: 13,
  color: '#a1a1aa',
  marginBottom: 14
}

const listStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  margin: '0 0 12px',
  padding: 0,
  listStyle: 'none'
}

const itemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 10px',
  fontSize: 13,
  lineHeight: 1.5,
  color: '#e4e4e7',
  background: '#27272a',
  borderRadius: 8,
  marginBottom: 6,
  borderLeft: '3px solid #6366f1'
}

const headStyle: CSSProperties = {
  fontWeight: 600,
  color: '#6366f1',
  flexShrink: 0,
  maxWidth: 140,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const relationStyle: CSSProperties = {
  color: '#818cf8',
  fontWeight: 600,
  fontSize: 12,
  flexShrink: 0,
  maxWidth: 100,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  background: 'rgba(99, 102, 241, 0.15)',
  padding: '2px 6px',
  borderRadius: 4
}

const tailStyle: CSSProperties = {
  color: '#a1a1aa',
  flexShrink: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const footerStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center'
}

const viewButtonStyle: CSSProperties = {
  flex: 1,
  padding: '10px 0',
  fontSize: 13,
  fontWeight: 600,
  color: '#ffffff',
  background: '#6366f1',
  border: 'none',
  borderRadius: 10,
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
  transition: 'filter 0.15s'
}

const closeButtonStyle: CSSProperties = {
  padding: '10px 20px',
  fontSize: 13,
  fontWeight: 600,
  color: '#a1a1aa',
  background: '#27272a',
  border: '1px solid #3f3f46',
  borderRadius: 10,
  cursor: 'pointer',
  transition: 'background 0.15s'
}

// 最多展示多少条三元组
const MAX_DISPLAY = 20

export default function TriplePreviewCard({
  visible,
  fileName,
  triples,
  entityCount,
  tripleCount,
  onClose,
  onViewGraph
}: TriplePreviewCardProps): JSX.Element | null {
  if (!visible) return null

  const display = triples.slice(0, MAX_DISPLAY)
  const remaining = triples.length - MAX_DISPLAY

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* 头部 */}
        <div style={headerStyle}>
          <span style={{ fontSize: 24 }}>✨</span>
          <h2 style={titleStyle}>Nito 学到了新知识！</h2>
        </div>
        <div style={subtitleStyle}>
          从 <strong style={{ color: '#e4e4e7' }}>{fileName}</strong> 中学会了{' '}
          <strong style={{ color: '#6366f1' }}>{triples.length}</strong> 条新知识
          {' '}（图谱共 {entityCount} 实体 · {tripleCount} 三元组）
        </div>

        {/* 三元组列表 */}
        <ul style={listStyle}>
          {display.map((t, idx) => (
            <li key={idx} style={itemStyle}>
              <span style={headStyle} title={t.head}>{t.head}</span>
              <span style={relationStyle} title={t.relation}>—{t.relation}→</span>
              <span style={tailStyle} title={t.tail}>{t.tail}</span>
            </li>
          ))}
          {remaining > 0 && (
            <li style={{ ...itemStyle, background: 'transparent', borderLeft: 'none', color: '#71717a', justifyContent: 'center', border: 'none' }}>
              还有 {remaining} 条知识，点击下方查看完整图谱
            </li>
          )}
        </ul>

        {/* 底部按钮 */}
        <div style={footerStyle}>
          <button
            style={viewButtonStyle}
            onClick={onViewGraph}
            onMouseEnter={(e) => { ;(e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.1)' }}
            onMouseLeave={(e) => { ;(e.currentTarget as HTMLButtonElement).style.filter = 'none' }}
          >
            🕸️ 查看完整图谱
          </button>
          <button
            style={closeButtonStyle}
            onClick={onClose}
            onMouseEnter={(e) => { ;(e.currentTarget as HTMLButtonElement).style.background = '#3f3f46' }}
            onMouseLeave={(e) => { ;(e.currentTarget as HTMLButtonElement).style.background = '#27272a' }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
