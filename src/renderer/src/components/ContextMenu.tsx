import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  MessageCircle,
  Paperclip,
  Globe,
  Settings,
  Shirt,
  Brain,
  Trash2,
  Layout,
  LogOut,
  Plus,
  Footprints
} from 'lucide-react'

// 右键菜单浮层组件（对应 Task 6）
//
// 由 App.tsx 通过 window.api.onContextMenu 订阅主进程的右键事件后控制显隐。
// 主进程在 webContents 'context-menu' 事件中阻止系统默认菜单，并把右键坐标
// {x, y} 通过 IPC 发给渲染进程；本组件根据坐标定位，超出窗口边界时自动调整。
//
// Phase 1 部分菜单项可用（聊天 / 喂文件 / 喂网页 URL / 设置 / 换皮肤 / 退出），其余项显示"敬请期待"并禁用。
//
// 交互：
// - 点击菜单项：触发 onAction(key) 后关闭
// - 点击菜单外部 / 按 ESC：关闭
// - 右键新位置：由 App 更新坐标重新定位（不在此处关闭）

/** 右键菜单 Props */
export interface ContextMenuProps {
  /** 是否显示 */
  visible: boolean
  /** 右键坐标 x（视口坐标，CSS 像素） */
  x: number
  /** 右键坐标 y（视口坐标，CSS 像素） */
  y: number
  /** 关闭回调（点击外部 / ESC / 选择菜单项后触发） */
  onClose: () => void
  /** 菜单项动作回调，参数为菜单项 key（如 'settings' / 'exit'） */
  onAction: (action: string) => void
}

/** 菜单项定义 */
interface MenuItemDef {
  /** 动作 key，传给 onAction */
  key: string
  /** 图标组件（lucide-react） */
  icon: typeof MessageCircle
  /** 菜单项文案 */
  label: string
  /** 是否禁用（Phase 未实现的阶段） */
  disabled?: boolean
  /** 是否在该项之前渲染分隔线 */
  dividerBefore?: boolean
}

// Phase 5 菜单项：聊天 / 喂文件 / 喂网页 URL 已激活（Task 15/16/19）
// 网页面板已激活（Task 23），吐掉最近吃的已激活（Task 28）
// "我的记忆"打开网页面板（知识图谱/记忆文件）
// 分组分隔：[聊天/喂文件/喂网页 URL] | [设置/换皮肤] | [我的记忆/吐掉最近吃的/打开网页面板] | [退出]
const MENU_ITEMS: MenuItemDef[] = [
  { key: 'chat', icon: MessageCircle, label: '聊天' },
  { key: 'new-chat', icon: Plus, label: '新对话' },
  { key: 'feed-file', icon: Paperclip, label: '喂文件' },
  { key: 'feed-url', icon: Globe, label: '喂网页 URL' },
  { key: 'settings', icon: Settings, label: '设置', dividerBefore: true },
  { key: 'skin', icon: Shirt, label: '换皮肤' },
  { key: 'memory', icon: Brain, label: '我的记忆', dividerBefore: true },
  { key: 'spit-last', icon: Trash2, label: '吐掉最近吃的' },
  { key: 'web', icon: Layout, label: '打开网页面板' },
  { key: 'walk-start', icon: Footprints, label: '开始走动', dividerBefore: true },
  { key: 'exit', icon: LogOut, label: '退出', dividerBefore: true }
]

/** 菜单样式 CSS（暗色毛玻璃风格，含 hover 高亮） */
const CONTEXT_MENU_CSS = `
.graphpet-ctx-menu {
  position: fixed;
  background: rgba(24,24,27,0.92);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  padding: 6px;
  min-width: 168px;
  z-index: 10000;
  user-select: none;
  pointer-events: auto;
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
  box-sizing: border-box;
}
.graphpet-ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 13px;
  color: #e4e4e7;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}
.graphpet-ctx-item.disabled {
  color: rgba(228,228,231,0.4);
  cursor: not-allowed;
}
.graphpet-ctx-item:not(.disabled):hover {
  background: rgba(99,102,241,0.15);
  color: #c7d2fe;
}
.graphpet-ctx-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.graphpet-ctx-label {
  flex: 1;
}
.graphpet-ctx-suffix {
  margin-left: auto;
  font-size: 11px;
  color: rgba(228,228,231,0.35);
}
.graphpet-ctx-divider {
  height: 1px;
  background: rgba(255,255,255,0.06);
  margin: 4px 0;
}
`

/** 样式注入标记（全局只注入一次，避免重复 <style>） */
let styleInjected = false

/** 注入菜单样式到 document.head */
function injectStyle(): void {
  if (styleInjected) return
  if (typeof document === 'undefined') return
  const el = document.createElement('style')
  el.textContent = CONTEXT_MENU_CSS
  document.head.appendChild(el)
  styleInjected = true
}

/** 边界安全间距（避免菜单紧贴窗口边缘） */
const EDGE_MARGIN = 4

export default function ContextMenu({
  visible,
  x,
  y,
  onClose,
  onAction
}: ContextMenuProps): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null)
  // 实际渲染坐标（经过边界调整）
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  // 首次挂载注入样式
  useEffect(() => {
    injectStyle()
  }, [])

  // 可见性或坐标变化时，测量菜单尺寸并做边界调整，避免超出窗口
  useLayoutEffect(() => {
    if (!visible) return
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const maxX = window.innerWidth - rect.width - EDGE_MARGIN
    const maxY = window.innerHeight - rect.height - EDGE_MARGIN
    const nx = x > maxX ? Math.max(EDGE_MARGIN, maxX) : x
    const ny = y > maxY ? Math.max(EDGE_MARGIN, maxY) : y
    setPos({ x: nx, y: ny })
  }, [visible, x, y])

  // 点击菜单外部（左键）/ 按 ESC 关闭菜单
  // 仅响应左键（button===0），右键由 App 更新坐标重新定位，不在此关闭
  useEffect(() => {
    if (!visible) return
    const handleMouseDown = (e: globalThis.MouseEvent): void => {
      if (e.button !== 0) return
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // 捕获阶段监听，确保在菜单项 click 之前判定外部点击
    document.addEventListener('mousedown', handleMouseDown, true)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
      document.removeEventListener('keydown', handleKey)
    }
  }, [visible, onClose])

  if (!visible) return null

  // 点击菜单项：禁用项不响应，可用项触发 onAction 后关闭
  const handleItemClick = (item: MenuItemDef): void => {
    if (item.disabled) return
    onAction(item.key)
    onClose()
  }

  const menuStyle: CSSProperties = {
    left: pos.x,
    top: pos.y
  }

  return (
    <div ref={menuRef} className="graphpet-ctx-menu" style={menuStyle} role="menu">
      {MENU_ITEMS.map((item) => {
        const IconComponent = item.icon
        return (
          <div key={item.key}>
            {item.dividerBefore && <div className="graphpet-ctx-divider" />}
            <div
              className={`graphpet-ctx-item${item.disabled ? ' disabled' : ''}`}
              onClick={() => handleItemClick(item)}
              role="menuitem"
              aria-disabled={item.disabled ?? false}
            >
              <span className="graphpet-ctx-icon">
                <IconComponent size={16} />
              </span>
              <span className="graphpet-ctx-label">{item.label}</span>
              {item.disabled && <span className="graphpet-ctx-suffix">敬请期待</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
