import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import DeepChat from './DeepChat'
import MemoryGraph from './MemoryGraph'
import Timeline from './Timeline'
import FileList from './FileList'
import Profile from './Profile'
import NitoIcon from '../components/NitoIcon'

/** 面板路由 key */
type PanelRoute = 'chat' | 'memory' | 'timeline' | 'files' | 'profile'

interface NavItem {
  key: PanelRoute
  icon: string
  label: string
  desc: string
}

const NAV_ITEMS: NavItem[] = [
  { key: 'chat', icon: '💬', label: '深度聊天', desc: '完整对话与引用溯源' },
  { key: 'memory', icon: '🕸️', label: '记忆图谱', desc: '知识三元组可视化' },
  { key: 'timeline', icon: '📅', label: '时间线', desc: '喂食与互动历史' },
  { key: 'files', icon: '📁', label: '文件清单', desc: '已吃文件管理' },
  { key: 'profile', icon: '📊', label: '智力展示', desc: '成长状态总览' }
]

/** 全局暗色主题样式 */
const PANEL_CSS = `
:root {
  --gp-bg: #0a0a0a;
  --gp-bg-card: #18181b;
  --gp-bg-subtle: #27272a;
  --gp-bg-hover: #3f3f46;
  --gp-text: #e4e4e7;
  --gp-text-secondary: #a1a1aa;
  --gp-text-muted: #71717a;
  --gp-border: #27272a;
  --gp-brand: #6366f1;
  --gp-brand-hover: #818cf8;
  --gp-bg-sidebar: #111113;
  --gp-bg-sidebar-hover: #27272a;
  --gp-text-sidebar: #fafafa;
}
* { box-sizing: border-box; }
html, body, #root {
  margin: 0; padding: 0; height: 100%; width: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background: var(--gp-bg);
  color: var(--gp-text);
}
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #52525b; }
::-webkit-scrollbar-track { background: transparent; }
.gp-panel-root { display: flex; height: 100vh; width: 100vw; overflow: hidden; }
.gp-panel-sidebar {
  width: 232px; flex-shrink: 0; background: var(--gp-bg-sidebar); color: var(--gp-text-sidebar);
  display: flex; flex-direction: column; padding: 0; user-select: none;
  border-right: 1px solid var(--gp-border);
}
.gp-panel-brand {
  padding: 20px 16px 18px; display: flex; align-items: center; gap: 10px;
  border-bottom: 1px solid var(--gp-border);
}
.gp-panel-brand-icon {
  width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
  background: var(--gp-bg-card);
  border-radius: 10px; flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}
.gp-panel-brand-text { font-size: 15px; font-weight: 700; color: var(--gp-text-sidebar); letter-spacing: -0.01em; }
.gp-panel-brand-sub { font-size: 11px; color: var(--gp-text-muted); margin-top: 2px; }
.gp-panel-nav { flex: 1; padding: 8px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
.gp-panel-nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: 8px; cursor: pointer;
  color: var(--gp-text-muted); font-size: 13px; transition: all 0.12s ease;
  border: none; background: transparent; text-align: left; width: 100%; font-family: inherit;
}
.gp-panel-nav-item:hover { background: var(--gp-bg-sidebar-hover); color: var(--gp-text-sidebar); }
.gp-panel-nav-item--active { background: rgba(99, 102, 241, 0.15); color: var(--gp-brand); font-weight: 600; }
.gp-panel-nav-item--active .gp-panel-nav-desc { color: var(--gp-text-muted); }
.gp-panel-nav-icon { font-size: 16px; line-height: 1; flex-shrink: 0; width: 20px; text-align: center; }
.gp-panel-nav-text { flex: 1; min-width: 0; }
.gp-panel-nav-label { font-size: 13px; line-height: 1.3; }
.gp-panel-nav-desc { font-size: 11px; opacity: 0.6; margin-top: 1px; line-height: 1.2; }
.gp-panel-sidebar-footer { padding: 10px 16px; border-top: 1px solid var(--gp-border); font-size: 11px; color: var(--gp-text-muted); }
.gp-panel-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--gp-bg); }
.gp-panel-header {
  background: var(--gp-bg); padding: 16px 28px 12px; border-bottom: 1px solid var(--gp-border);
  flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
}
.gp-panel-header-title { font-size: 16px; font-weight: 700; color: var(--gp-text); display: flex; align-items: center; gap: 8px; letter-spacing: -0.01em; }
.gp-panel-header-sub { font-size: 12px; color: var(--gp-text-muted); margin-top: 2px; }
.gp-panel-content { flex: 1; overflow-y: auto; padding: 20px 28px; }
.gp-card {
  background: var(--gp-bg-card); border-radius: 12px; padding: 20px;
  border: 1px solid var(--gp-border);
}
.gp-card-title { font-size: 13px; font-weight: 600; color: var(--gp-text); margin: 0 0 14px; letter-spacing: -0.01em; }
.gp-stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
.gp-stat-card {
  background: var(--gp-bg-card); border-radius: 12px; padding: 18px;
  border: 1px solid var(--gp-border);
  transition: border-color 0.15s;
}
.gp-stat-card:hover { border-color: var(--gp-bg-hover); }
.gp-stat-label { font-size: 12px; color: var(--gp-text-secondary); margin-bottom: 8px; font-weight: 500; }
.gp-stat-value { font-size: 28px; font-weight: 700; color: var(--gp-text); line-height: 1.1; letter-spacing: -0.02em; }
.gp-stat-unit { font-size: 13px; color: var(--gp-text-muted); font-weight: 400; margin-left: 4px; }
.gp-progress { width: 100%; height: 6px; background: var(--gp-bg-subtle); border-radius: 3px; overflow: hidden; }
.gp-progress-bar { height: 100%; border-radius: 3px; transition: width 0.5s cubic-bezier(0.4,0,0.2,1); }
.gp-btn {
  padding: 7px 14px; border-radius: 8px; border: 1px solid var(--gp-border);
  background: var(--gp-bg-card); color: var(--gp-text); font-size: 13px; cursor: pointer;
  transition: all 0.12s; font-family: inherit; font-weight: 500;
}
.gp-btn:hover { border-color: var(--gp-bg-hover); background: var(--gp-bg-subtle); }
.gp-btn:active { transform: scale(0.98); }
.gp-btn--primary {
  background: var(--gp-brand); color: #fff; border: 1px solid var(--gp-brand);
}
.gp-btn--primary:hover { background: var(--gp-brand-hover); border-color: var(--gp-brand-hover); }
.gp-btn--danger { color: #f87171; border-color: rgba(248, 113, 113, 0.3); background: var(--gp-bg-card); }
.gp-btn--danger:hover { background: rgba(248, 113, 113, 0.1); border-color: rgba(248, 113, 113, 0.5); }
.gp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.gp-tag { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; line-height: 1.6; }
.gp-loading { text-align: center; padding: 40px; color: var(--gp-text-muted); font-size: 14px; }
.gp-empty { text-align: center; padding: 48px 20px; color: var(--gp-text-muted); font-size: 14px; line-height: 1.7; }
.gp-empty-icon {
  width: 48px; height: 48px; margin: 0 auto 14px;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; background: var(--gp-bg-subtle); border-radius: 12px;
}
.gp-error { text-align: center; padding: 14px; color: #f87171; font-size: 13px; background: rgba(248, 113, 113, 0.1); border-radius: 8px; border: 1px solid rgba(248, 113, 113, 0.3); }
.gp-panel-content::-webkit-scrollbar { width: 8px; }
.gp-panel-content::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 4px; }
.gp-panel-content::-webkit-scrollbar-thumb:hover { background: #52525b; }
.gp-panel-content::-webkit-scrollbar-track { background: transparent; }
input, textarea, select {
  color: var(--gp-text);
  background: var(--gp-bg-subtle);
  border: 1px solid var(--gp-border);
}
input::placeholder, textarea::placeholder { color: var(--gp-text-muted); }
`

let panelStyleInjected = false

function injectPanelStyle(): void {
  if (panelStyleInjected) return
  if (typeof document === 'undefined') return
  const el = document.createElement('style')
  el.textContent = PANEL_CSS
  document.head.appendChild(el)
  panelStyleInjected = true
}

function parseHash(): PanelRoute {
  const hash = window.location.hash || ''
  const match = hash.match(/^#\/panel\/(\w+)/)
  if (match) {
    const route = match[1] as PanelRoute
    if (NAV_ITEMS.some((n) => n.key === route)) return route
  }
  return 'chat'
}

function navigate(route: PanelRoute): void {
  window.location.hash = `#/panel/${route}`
}

export default function PanelApp(): JSX.Element {
  const [route, setRoute] = useState<PanelRoute>(parseHash)

  useEffect(() => {
    injectPanelStyle()
    const splash = document.getElementById('graphpet-splash')
    if (splash) splash.remove()
  }, [])

  useEffect(() => {
    const onHashChange = (): void => setRoute(parseHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const currentNav = NAV_ITEMS.find((n) => n.key === route) ?? NAV_ITEMS[0]

  const renderContent = (): JSX.Element => {
    switch (route) {
      case 'chat':
        return <DeepChat />
      case 'memory':
        return <MemoryGraph />
      case 'timeline':
        return <Timeline />
      case 'files':
        return <FileList />
      case 'profile':
        return <Profile />
      default:
        return <DeepChat />
    }
  }

  const sidebarStyle: CSSProperties = { height: '100%' }

  return (
    <div className="gp-panel-root">
      <div className="gp-panel-sidebar" style={sidebarStyle}>
        <div className="gp-panel-brand">
          <span className="gp-panel-brand-icon"><NitoIcon size={36} /></span>
          <div>
            <div className="gp-panel-brand-text">GraphPet</div>
            <div className="gp-panel-brand-sub">知识图谱桌宠</div>
          </div>
        </div>
        <nav className="gp-panel-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`gp-panel-nav-item${route === item.key ? ' gp-panel-nav-item--active' : ''}`}
              onClick={() => navigate(item.key)}
            >
              <span className="gp-panel-nav-icon">{item.icon}</span>
              <span className="gp-panel-nav-text">
                <div className="gp-panel-nav-label">{item.label}</div>
                <div className="gp-panel-nav-desc">{item.desc}</div>
              </span>
            </button>
          ))}
        </nav>
        <div className="gp-panel-sidebar-footer">v0.1.0 · Phase 5</div>
      </div>
      <div className="gp-panel-main">
        <div className="gp-panel-header">
          <div>
            <div className="gp-panel-header-title">
              <span>{currentNav.icon}</span>
              <span>{currentNav.label}</span>
            </div>
            <div className="gp-panel-header-sub">{currentNav.desc}</div>
          </div>
        </div>
        <div className="gp-panel-content">{renderContent()}</div>
      </div>
    </div>
  )
}
