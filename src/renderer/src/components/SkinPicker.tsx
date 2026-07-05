import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useLive2DSkins } from '../hooks/useLive2DSkins'

// 换皮肤选择浮层（v0.3.8 增加自定义模型导入）
//
// 独立浮层：半透明遮罩 + 居中卡片。打开时通过 useLive2DSkins hook 拉取
// Nito 家族差分角色列表，并通过 window.api.listImportedLive2DModels() 拉取已导入的自定义模型。
// 点击某项调用 onSelect(skinPath, format) 通知 Live2DCanvas 加载，然后关闭浮层。
//
// v0.3.8 新增：
//   - "📁 导入自定义模型" 按钮：弹出文件夹选择，复制到 userData/imported-models
//   - 已导入模型列表：显示用户导入的第三方 Live2D 模型，支持切换和删除

export interface SkinPickerProps {
  /** 是否显示 */
  visible: boolean
  /** 关闭回调（点击遮罩 / 点击 X / 选择后） */
  onClose: () => void
  /** 选中某个皮肤后回调，参数为该皮肤的路径和格式 */
  onSelect: (skinPath: string, format?: 'cubism2' | 'cubism4') => void
}

interface ImportedModel {
  name: string
  path: string
  format: 'cubism2' | 'cubism4'
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
  width: 320,
  maxHeight: 460,
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

const listStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  margin: '0 -4px',
  padding: '0 4px'
}

const sectionTitleStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#71717a',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  margin: '8px 4px 6px',
  flexShrink: 0
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
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8
}

const deleteBtnStyle: CSSProperties = {
  flexShrink: 0,
  width: 22,
  height: 22,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: '#71717a',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
}

const importBtnStyle: CSSProperties = {
  flexShrink: 0,
  marginBottom: 10,
  padding: '10px 12px',
  fontSize: 13,
  fontWeight: 600,
  color: '#c7d2fe',
  background: 'rgba(99, 102, 241, 0.1)',
  border: '1px dashed #6366f1',
  borderRadius: 8,
  cursor: 'pointer',
  width: '100%',
  textAlign: 'center'
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

const importBtnHoverBg = 'rgba(99, 102, 241, 0.18)'
const importBtnHoverBorder = '#818cf8'
const deleteBtnHoverColor = '#fca5a5'
const deleteBtnHoverBg = 'rgba(239, 68, 68, 0.15)'

// —— 主组件 ——

export default function SkinPicker({
  visible,
  onClose,
  onSelect
}: SkinPickerProps): JSX.Element | null {
  const { skins, loading, error } = useLive2DSkins()
  const [importedModels, setImportedModels] = useState<ImportedModel[]>([])
  const [importing, setImporting] = useState<boolean>(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  // 拉取已导入模型列表
  const refreshImported = async (): Promise<void> => {
    try {
      const list = await window.api.listImportedLive2DModels()
      setImportedModels(list ?? [])
    } catch (err) {
      console.error('[SkinPicker] 拉取已导入模型失败:', err)
      setImportedModels([])
    }
  }

  useEffect(() => {
    if (visible) {
      setImportMsg(null)
      void refreshImported()
    }
  }, [visible])

  if (!visible) return null

  const handleSelect = (skin: { path: string; format: 'cubism2' | 'cubism4' }): void => {
    onSelect(skin.path, skin.format)
    onClose()
  }

  const handleImport = async (): Promise<void> => {
    if (importing) return
    setImporting(true)
    setImportMsg(null)
    try {
      const result = await window.api.importLive2DModel()
      if (result.success && result.path && result.format) {
        setImportMsg(`✓ 已导入：${result.name}`)
        await refreshImported()
        // 自动切换到新导入的模型
        onSelect(result.path, result.format)
        onClose()
      } else {
        setImportMsg(`✗ ${result.error || '导入失败'}`)
      }
    } catch (err) {
      setImportMsg(`✗ ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setImporting(false)
    }
  }

  const handleDelete = async (name: string): Promise<void> => {
    if (!confirm(`确定删除已导入的模型 "${name}"？`)) return
    try {
      const result = await window.api.deleteImportedLive2DModel(name)
      if (result.success) {
        await refreshImported()
      } else {
        alert(`删除失败：${result.error || '未知错误'}`)
      }
    } catch (err) {
      alert(`删除失败：${err instanceof Error ? err.message : String(err)}`)
    }
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
              ;(e.currentTarget as HTMLButtonElement).style.background = '#3f3f46'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background = '#27272a'
            }}
          >
            ×
          </button>
        </div>

        {/* 导入按钮 */}
        <button
          type="button"
          style={importBtnStyle}
          onClick={handleImport}
          disabled={importing}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLButtonElement
            el.style.background = importBtnHoverBg
            el.style.borderColor = importBtnHoverBorder
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLButtonElement
            el.style.background = 'rgba(99, 102, 241, 0.1)'
            el.style.borderColor = '#6366f1'
          }}
        >
          {importing ? '导入中...' : '📁 导入自定义 Live2D 模型'}
        </button>

        {importMsg && (
          <div style={{ ...messageStyle, padding: '4px 0 8px', fontSize: 12 }}>
            {importMsg}
          </div>
        )}

        {/* 列表 */}
        <div style={listStyle}>
          {/* 已导入的自定义模型 */}
          {importedModels.length > 0 && (
            <>
              <div style={sectionTitleStyle}>已导入模型</div>
              {importedModels.map((m) => (
                <button
                  key={m.path}
                  type="button"
                  style={skinItemStyle}
                  onClick={() => handleSelect(m)}
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
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {`📦 ${m.name}`}
                  </span>
                  <span
                    style={{
                      ...deleteBtnStyle,
                      flexShrink: 0
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDelete(m.name)
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLSpanElement
                      el.style.color = deleteBtnHoverColor
                      el.style.background = deleteBtnHoverBg
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLSpanElement
                      el.style.color = '#71717a'
                      el.style.background = 'transparent'
                    }}
                    role="button"
                    aria-label={`删除 ${m.name}`}
                  >
                    ×
                  </span>
                </button>
              ))}
            </>
          )}

          {/* Nito 家族内置皮肤 */}
          <div style={sectionTitleStyle}>Nito 家族</div>
          {loading ? (
            <div style={messageStyle}>正在加载皮肤列表…</div>
          ) : error ? (
            <div style={messageStyle}>{`加载失败：${error}`}</div>
          ) : skins.length === 0 ? (
            <div style={messageStyle}>暂无可用皮肤，请先下载 Nito 模型</div>
          ) : (
            skins.map((skin) => (
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
            ))
          )}
        </div>
      </div>
    </div>
  )
}
