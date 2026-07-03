import { useEffect } from 'react'
import type { CSSProperties } from 'react'

// 喂食进度对话框（Task 15 + P0-C 四阶段进度反馈）
//
// 批量喂食时以模态浮层形式展示每个文件的消化进度。
// - 顶部显示总进度"已完成 N/M"
// - 中间为文件列表，每项带状态图标（⏳ pending / 🍽️ feeding / ✓ success / ✗ failed）
//   P0-C：feeding 状态下展示四阶段进度条（解析→准备→抽取→入库）
// - 底部为关闭/取消按钮

/** 单个喂食文件的处理状态 */
export type FeedFileStatus = 'pending' | 'feeding' | 'success' | 'failed'

/** 喂食文件项（由 App.tsx 维护并传入） */
export interface FeedFileItem {
  /** 文件名（不含路径，用于展示） */
  name: string
  /** 当前状态 */
  status: FeedFileStatus
  /** 结果消息（成功/失败时由后端返回，取消时为"已取消"） */
  message?: string
  /** 当前阶段（feeding 时）：parsing/preparing/extracting/finalizing（P0-C） */
  stage?: string
  /** 进度百分比 0-100（feeding 时）（P0-C） */
  progress?: number
  /** 阶段消息（feeding 时）（P0-C） */
  stageMessage?: string
}

export interface FeedProgressDialogProps {
  /** 是否显示 */
  visible: boolean
  /** 文件列表（含每个文件的实时状态） */
  files: FeedFileItem[]
  /** 关闭/取消回调（全部完成时为关闭，处理中为取消，由父组件判断） */
  onClose: () => void
}

// 状态 -> 图标映射
const STATUS_ICON: Record<FeedFileStatus, string> = {
  pending: '⏳',
  feeding: '🍽️',
  success: '✓',
  failed: '✗'
}

// 状态 -> 颜色映射
const STATUS_COLOR: Record<FeedFileStatus, string> = {
  pending: '#71717a',
  feeding: '#6366f1',
  success: '#22c55e',
  failed: '#ef4444'
}

// 阶段中文标签（P0-C）
const STAGE_LABEL: Record<string, string> = {
  parsing: '解析文档',
  preparing: '准备图谱',
  extracting: '抽取知识',
  finalizing: '入库统计'
}

// 四阶段进度条颜色（渐变）
const STAGE_COLOR: Record<string, string> = {
  parsing: '#3b82f6',
  preparing: '#6366f1',
  extracting: '#6366f1',
  finalizing: '#22c55e'
}

// —— 样式常量 ——

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
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
  pointerEvents: 'auto'
}

const cardStyle: CSSProperties = {
  width: 400,
  maxHeight: 460,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  padding: 20,
  background: '#18181b',
  border: '1px solid #27272a',
  borderRadius: 16,
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
  color: '#e4e4e7',
  userSelect: 'none'
}

const titleStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: '#e4e4e7',
  margin: '0 0 4px'
}

const progressStyle: CSSProperties = {
  fontSize: 12,
  color: '#a1a1aa',
  fontVariantNumeric: 'tabular-nums'
}

const listStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  margin: '12px 0',
  padding: 0,
  listStyle: 'none'
}

const itemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '10px 4px',
  fontSize: 13,
  borderBottom: '1px solid #27272a'
}

const nameStyle: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '#e4e4e7',
  fontWeight: 500
}

const messageStyle: CSSProperties = {
  fontSize: 11,
  color: '#71717a',
  marginTop: 2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

// 进度条容器
const progressTrackStyle: CSSProperties = {
  width: '100%',
  height: 6,
  background: '#27272a',
  borderRadius: 3,
  marginTop: 6,
  overflow: 'hidden'
}

// 阶段标签行
const stageRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: 4,
  fontSize: 11,
  color: '#71717a'
}

const closeButtonStyle: CSSProperties = {
  width: '100%',
  padding: '10px 0',
  fontSize: 14,
  fontWeight: 600,
  color: '#ffffff',
  background: '#6366f1',
  border: 'none',
  borderRadius: 10,
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)',
  transition: 'filter 0.15s'
}

export default function FeedProgressDialog({
  visible,
  files,
  onClose
}: FeedProgressDialogProps): JSX.Element | null {
  // ESC 关闭（等同点击关闭/取消按钮）
  useEffect(() => {
    if (!visible) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, onClose])

  if (!visible) return null

  const total = files.length
  const done = files.filter(
    (f) => f.status === 'success' || f.status === 'failed'
  ).length
  const allDone = total > 0 && done === total

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* 标题 + 总进度 */}
        <h2 style={titleStyle}>🍖 喂食进度</h2>
        <div style={progressStyle}>已完成 {done}/{total}</div>

        {/* 文件列表（可滚动） */}
        <ul style={listStyle}>
          {files.map((f, idx) => {
            const pct = Math.round(f.progress ?? 0)
            const stageLabel = f.stage ? STAGE_LABEL[f.stage] ?? f.stage : ''
            const stageColor = f.stage ? STAGE_COLOR[f.stage] ?? '#6366f1' : '#6366f1'
            return (
              <li key={`${f.name}-${idx}`} style={itemStyle}>
                <span
                  style={{
                    fontSize: 16,
                    lineHeight: '20px',
                    color: STATUS_COLOR[f.status],
                    flexShrink: 0
                  }}
                >
                  {STATUS_ICON[f.status]}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={nameStyle}>{f.name}</div>
                  {/* feeding 状态：展示四阶段进度条 */}
                  {f.status === 'feeding' && (
                    <>
                      <div style={progressTrackStyle}>
                        <div
                          style={{
                            height: '100%',
                            width: `${pct}%`,
                            background: stageColor,
                            borderRadius: 3,
                            transition: 'width 0.3s ease, background 0.3s ease'
                          }}
                        />
                      </div>
                      <div style={stageRowStyle}>
                        <span style={{ color: stageColor, fontWeight: 600 }}>
                          {stageLabel} {pct}%
                        </span>
                        {f.stageMessage && (
                          <span style={messageStyle}>{f.stageMessage}</span>
                        )}
                      </div>
                    </>
                  )}
                  {/* success/failed 状态：展示结果消息 */}
                  {f.status !== 'feeding' && f.message && (
                    <div style={messageStyle}>{f.message}</div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        {/* 底部按钮：处理中为"取消"，全部完成后为"关闭" */}
        <button
          style={closeButtonStyle}
          onClick={onClose}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.1)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.filter = 'none'
          }}
        >
          {allDone ? '关闭' : '取消'}
        </button>
      </div>
    </div>
  )
}
