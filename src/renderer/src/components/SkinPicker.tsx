import type { CSSProperties } from 'react'
import { useLive2DSkins } from '../hooks/useLive2DSkins'

// 换皮肤选择浮层（Task 8）
//
// 独立浮层：半透明遮罩 + 居中卡片。打开时通过 useLive2DSkins hook 拉取
// 差分角色列表，点击某项调用 onSelect(skinPath) 通知 Live2DCanvas 加载
// 新的 .model3.json，然后关闭浮层。
//
// 边界处理：
//   - 皮肤列表为空：提示"暂无可用皮肤，请先下载 Nito 模型"
//   - 只有一个皮肤：提示"当前只有默认皮肤"
//   - 加载中 / 出错：对应提示文案
//
// 注意：本组件不集成到 App.tsx，由 Task 6 统一接线。

export interface SkinPickerProps {
  /** 是否显示 */
  visible: boolean
  /** 关闭回调（点击遮罩 / 点击 X / 选择后） */
  onClose: () => void
  /** 选中某个皮肤后回调，参数为该皮肤的路径和格式 */
  onSelect: (skinPath: string, format?: 'cubism2' | 'cubism4') => void
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
  width: 260,
  maxHeight: 320,
  boxSizing: 'border-box',
  padding: 18,
  background: '#18181b',
  border: '1px solid #27272a',
  borderRadius: 16,
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
  color: '#e4e4e7',
  userSelect: 'none',
  display: 'flex',
  flexDirection: 'column'
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
  flexShrink: 0
}

const titleStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: '#e4e4e7',
  margin: 0
}

const closeButtonStyle: CSSProperties = {
  width: 26,
  height: 26,
  border: 'none',
  borderRadius: 8,
  background: '#27272a',
  color: '#a1a1aa',
  fontSize: 16,
  lineHeight: '16px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s'
}

// 列表滚动容器：占据剩余高度
const listStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  margin: '0 -4px',
  padding: '0 4px'
}

const skinItemStyle: CSSProperties = {
  padding: '10px 12px',
  marginBottom: 6,
  fontSize: 13,
  color: '#e4e4e7',
  background: '#27272a',
  border: '1px solid #3f3f46',
  borderRadius: 8,
  cursor: 'pointer',
  transition: 'background 0.15s, border-color 0.15s',
  textAlign: 'left',
  width: '100%'
}

const skinItemHoverBg = 'rgba(99, 102, 241, 0.15)'
const skinItemHoverBorder = '#6366f1'

const messageStyle: CSSProperties = {
  padding: '16px 8px',
  fontSize: 13,
  color: '#71717a',
  textAlign: 'center',
  lineHeight: 1.6
}

// —— 主组件 ——

export default function SkinPicker({
  visible,
  onClose,
  onSelect
}: SkinPickerProps): JSX.Element | null {
  const { skins, loading, error } = useLive2DSkins()

  if (!visible) return null

  const handleSelect = (skin: { path: string; format: 'cubism2' | 'cubism4' }): void => {
    onSelect(skin.path, skin.format)
    onClose()
  }

  const renderBody = (): JSX.Element => {
    if (loading) {
      return <div style={messageStyle}>正在加载皮肤列表…</div>
    }
    if (error) {
      return <div style={messageStyle}>{`加载失败：${error}`}</div>
    }
    if (skins.length === 0) {
      return <div style={messageStyle}>暂无可用皮肤，请先下载 Nito 模型</div>
    }
    if (skins.length === 1) {
      return (
        <>
          <div style={{ ...messageStyle, padding: '8px 0 12px' }}>
            当前只有默认皮肤
          </div>
          {skins.map((skin) => (
            <button
              key={skin.path}
              type="button"
              style={skinItemStyle}
              onClick={() => handleSelect(skin)}
              onMouseEnter={(e) => {
                const el = e.currentTarget
                el.style.background = skinItemHoverBg
                el.style.borderColor = skinItemHoverBorder
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget
                el.style.background = '#27272a'
                el.style.borderColor = '#3f3f46'
              }}
            >
              {skin.name}
            </button>
          ))}
        </>
      )
    }
    return (
      <>
        {skins.map((skin) => (
          <button
            key={skin.path}
            type="button"
            style={skinItemStyle}
            onClick={() => handleSelect(skin)}
            onMouseEnter={(e) => {
              const el = e.currentTarget
              el.style.background = skinItemHoverBg
              el.style.borderColor = skinItemHoverBorder
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget
              el.style.background = '#27272a'
              el.style.borderColor = '#3f3f46'
            }}
          >
            {skin.name}
          </button>
        ))}
      </>
    )
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="选择皮肤"
      >
        {/* 标题栏 */}
        <div style={headerStyle}>
          <h2 style={titleStyle}>选择皮肤</h2>
          <button
            type="button"
            style={closeButtonStyle}
            onClick={onClose}
            aria-label="关闭"
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background =
                '#3f3f46'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background =
                '#27272a'
            }}
          >
            ×
          </button>
        </div>

        {/* 皮肤列表 / 提示文案 */}
        <div style={listStyle}>{renderBody()}</div>
      </div>
    </div>
  )
}
