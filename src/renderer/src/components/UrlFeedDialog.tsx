import { useEffect, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'

// URL 喂食对话框（Task 16）
//
// 让用户输入一个网页 URL，提交后由父组件调用 feedService.feedUrl 走
// Python /feed 端点完成喂食。对话框本身只负责输入校验与提交回调，
// 不直接调用后端，便于复用与测试。
//
// 交互：
// - 输入校验：必须是 http:// 或 https:// 开头
// - 提交期间禁用按钮显示"消化中..."
// - 点击遮罩 / ESC / 取消按钮：关闭对话框（提交中时不允许关闭）
// - visible=false 时不渲染

export interface UrlFeedDialogProps {
  /** 是否显示 */
  visible: boolean
  /** 关闭回调（取消 / 点击遮罩 / ESC） */
  onClose: () => void
  /** 提交回调，参数为用户输入的 URL；父组件负责调用后端并控制消化中状态 */
  onSubmit: (url: string) => void
  /** 是否处于消化中（提交后父组件置 true，完成后置 false） */
  submitting?: boolean
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
  width: 380,
  boxSizing: 'border-box',
  padding: 22,
  background: '#18181b',
  border: '1px solid #27272a',
  borderRadius: 16,
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
  color: '#e4e4e7',
  userSelect: 'none'
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 14
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

const descStyle: CSSProperties = {
  fontSize: 12,
  color: '#a1a1aa',
  marginBottom: 10,
  lineHeight: 1.5
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 11px',
  fontSize: 13,
  color: '#e4e4e7',
  background: '#27272a',
  border: '1px solid #3f3f46',
  borderRadius: 8,
  outline: 'none',
  transition: 'border-color 0.15s, box-shadow 0.15s'
}

const inputFocusStyle: CSSProperties = {
  borderColor: '#6366f1',
  boxShadow: '0 0 0 3px rgba(99, 102, 241, 0.15)'
}

const inputErrorStyle: CSSProperties = {
  borderColor: '#ef4444'
}

const errorTextStyle: CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  color: '#fca5a5',
  lineHeight: 1.4
}

const footerStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  marginTop: 18
}

const cancelButtonStyle: CSSProperties = {
  flex: 1,
  padding: '10px 0',
  fontSize: 14,
  fontWeight: 600,
  color: '#a1a1aa',
  background: '#27272a',
  border: '1px solid #3f3f46',
  borderRadius: 10,
  cursor: 'pointer',
  transition: 'background 0.15s'
}

const submitButtonStyle: CSSProperties = {
  flex: 1,
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

const submitButtonDisabledStyle: CSSProperties = {
  ...submitButtonStyle,
  cursor: 'not-allowed',
  opacity: 0.7,
  boxShadow: 'none'
}

/** URL 合法性校验：必须 http/https 开头，且能被 URL 解析 */
function isValidUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  if (!/^https?:\/\//i.test(trimmed)) return false
  try {
    // 进一步用 URL 构造器校验合法性
    const u = new URL(trimmed)
    // 必须有 host
    return u.hostname.length > 0
  } catch {
    return false
  }
}

export default function UrlFeedDialog({
  visible,
  onClose,
  onSubmit,
  submitting = false
}: UrlFeedDialogProps): JSX.Element | null {
  const [url, setUrl] = useState<string>('')
  const [touched, setTouched] = useState<boolean>(false)
  const [focused, setFocused] = useState<boolean>(false)

  // 对话框重新打开时重置输入与校验状态
  useEffect(() => {
    if (visible) {
      setUrl('')
      setTouched(false)
      setFocused(false)
    }
  }, [visible])

  // ESC 关闭（消化中时不允许）
  useEffect(() => {
    if (!visible || submitting) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, submitting, onClose])

  if (!visible) return null

  const trimmedUrl = url.trim()
  const valid = isValidUrl(trimmedUrl)
  // 仅在用户触碰过输入框（输入 / 失焦）后才显示错误提示
  const showError = touched && !valid && trimmedUrl.length > 0
  const canSubmit = valid && !submitting

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    onSubmit(trimmedUrl)
  }

  // 遮罩点击：消化中不允许关闭，避免误触丢失进度
  const handleOverlayClick = (): void => {
    if (submitting) return
    onClose()
  }

  // 输入框样式：错误优先，其次聚焦高亮
  const computedInputStyle: CSSProperties = {
    ...inputStyle,
    ...(showError ? inputErrorStyle : focused ? inputFocusStyle : {}),
    ...(submitting ? { background: '#18181b', color: '#71717a' } : {})
  }

  return (
    <div style={overlayStyle} onClick={handleOverlayClick}>
      <div
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="喂网页 URL"
      >
        {/* 标题栏 */}
        <div style={headerStyle}>
          <h2 style={titleStyle}>🌐 喂网页 URL</h2>
          <button
            type="button"
            style={closeButtonStyle}
            onClick={onClose}
            disabled={submitting}
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

        {/* 说明 */}
        <div style={descStyle}>
          输入一个网页链接，Nito 会抓取正文、抽取三元组并增量索引到知识图谱。
        </div>

        {/* 输入表单 */}
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={url}
            placeholder="https://example.com/article"
            disabled={submitting}
            style={computedInputStyle}
            onChange={(e) => {
              setUrl(e.target.value)
              if (!touched) setTouched(true)
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false)
              setTouched(true)
            }}
            autoFocus
            spellCheck={false}
            autoComplete="off"
          />
          {showError && (
            <div style={errorTextStyle}>
              请输入以 http:// 或 https:// 开头的合法网址
            </div>
          )}

          {/* 底部按钮 */}
          <div style={footerStyle}>
            <button
              type="button"
              style={cancelButtonStyle}
              onClick={onClose}
              disabled={submitting}
              onMouseEnter={(e) => {
                if (!submitting) {
                  ;(e.currentTarget as HTMLButtonElement).style.background =
                    '#3f3f46'
                }
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background =
                  '#27272a'
              }}
            >
              取消
            </button>
            <button
              type="submit"
              style={canSubmit ? submitButtonStyle : submitButtonDisabledStyle}
              disabled={!canSubmit}
              onMouseEnter={(e) => {
                if (canSubmit) {
                  ;(e.currentTarget as HTMLButtonElement).style.filter =
                    'brightness(1.1)'
                }
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.filter = 'none'
              }}
            >
              {submitting ? '消化中...' : '喂食'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
