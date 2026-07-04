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

/** 全局暗色主题样式（Linear/Stripe 风格） */
const PANEL_CSS = `
:root {
  --gp-bg: #0a0a0a;
  --gp-bg-card: #18181b;
  --gp-bg-subtle: #27272a;
  --gp-bg-hover: #3f3f46;
  --gp-text: #fafafa;
  --gp-text-secondary: #a1a1aa;
  --gp-text-muted: #71717a;
  --gp-border: #27272a;
  --gp-border-hover: #3f3f46;
  --gp-brand: #6366f1;
  --gp-brand-hover: #818cf8;
  --gp-brand-glow: rgba(99, 102, 241, 0.4);
  --gp-bg-sidebar: #0d0d0f;
  --gp-bg-sidebar-hover: #1a1a1f;
  --gp-text-sidebar: #fafafa;
  --gp-success: #10b981;
  --gp-warning: #f59e0b;
  --gp-danger: #f87171;
  --gp-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --gp-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.02);
  --gp-shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.03);
  --gp-shadow-brand: 0 8px 24px rgba(99, 102, 241, 0.25);
  --gp-grad-brand: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  --gp-grad-bg: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99, 102, 241, 0.08), transparent);
  --gp-grad-card: linear-gradient(180deg, rgba(255, 255, 255, 0.02) 0%, transparent 100%);
}
* { box-sizing: border-box; }
html, body, #root {
  margin: 0; padding: 0; height: 100%; width: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background: var(--gp-bg);
  background-image: var(--gp-grad-bg);
  color: var(--gp-text);
  letter-spacing: -0.005em;
}
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #52525b; }
::-webkit-scrollbar-track { background: transparent; }
.gp-panel-root { display: flex; height: 100vh; width: 100vw; overflow: hidden; }
.gp-panel-sidebar {
  width: 240px; flex-shrink: 0; background: var(--gp-bg-sidebar); color: var(--gp-text-sidebar);
  display: flex; flex-direction: column; padding: 0; user-select: none;
  border-right: 1px solid var(--gp-border);
  position: relative;
}
.gp-panel-sidebar::before {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(ellipse 60% 40% at 50% 0%, rgba(99, 102, 241, 0.06), transparent 60%);
  pointer-events: none;
}
.gp-panel-sidebar > * { position: relative; z-index: 1; }
.gp-panel-brand {
  padding: 22px 18px 20px; display: flex; align-items: center; gap: 12px;
  border-bottom: 1px solid var(--gp-border);
}
.gp-panel-brand-icon {
  width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;
  background: var(--gp-grad-brand);
  border-radius: 11px; flex-shrink: 0;
  box-shadow: var(--gp-shadow-brand);
  overflow: hidden;
  position: relative;
}
.gp-panel-brand-icon::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 50%);
  border-radius: 11px;
}
.gp-panel-brand-text { font-size: 15px; font-weight: 700; color: var(--gp-text-sidebar); letter-spacing: -0.015em; }
.gp-panel-brand-sub { font-size: 11px; color: var(--gp-text-muted); margin-top: 2px; letter-spacing: 0.01em; }
.gp-panel-nav { flex: 1; padding: 10px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
.gp-panel-nav-item {
  display: flex; align-items: center; gap: 11px;
  padding: 10px 12px; border-radius: 9px; cursor: pointer;
  color: var(--gp-text-muted); font-size: 13px; transition: all 0.15s ease;
  border: none; background: transparent; text-align: left; width: 100%; font-family: inherit;
  position: relative;
}
.gp-panel-nav-item:hover {
  background: var(--gp-bg-sidebar-hover); color: var(--gp-text-sidebar);
  transform: translateX(1px);
}
.gp-panel-nav-item--active {
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.15), rgba(99, 102, 241, 0.05));
  color: var(--gp-brand); font-weight: 600;
}
.gp-panel-nav-item--active::before {
  content: ''; position: absolute; left: -10px; top: 50%; transform: translateY(-50%);
  width: 3px; height: 20px; background: var(--gp-brand); border-radius: 0 3px 3px 0;
  box-shadow: 0 0 8px var(--gp-brand-glow);
}
.gp-panel-nav-item--active .gp-panel-nav-desc { color: var(--gp-text-muted); }
.gp-panel-nav-icon { font-size: 16px; line-height: 1; flex-shrink: 0; width: 20px; text-align: center; }
.gp-panel-nav-text { flex: 1; min-width: 0; }
.gp-panel-nav-label { font-size: 13px; line-height: 1.3; }
.gp-panel-nav-desc { font-size: 11px; opacity: 0.55; margin-top: 1px; line-height: 1.2; }
.gp-panel-sidebar-footer {
  padding: 12px 18px; border-top: 1px solid var(--gp-border);
  font-size: 11px; color: var(--gp-text-muted);
  display: flex; align-items: center; gap: 6px;
}
.gp-panel-status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--gp-success);
  box-shadow: 0 0 6px var(--gp-success);
  animation: gp-pulse 2s ease-in-out infinite;
}
@keyframes gp-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.gp-panel-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--gp-bg); position: relative; }
.gp-panel-main::before {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(ellipse 60% 30% at 50% 0%, rgba(99, 102, 241, 0.04), transparent 70%);
  pointer-events: none; z-index: 0;
}
.gp-panel-main > * { position: relative; z-index: 1; }
.gp-panel-header {
  background: rgba(10, 10, 10, 0.6);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  padding: 18px 32px 14px; border-bottom: 1px solid var(--gp-border);
  flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
}
.gp-panel-header-title { font-size: 17px; font-weight: 700; color: var(--gp-text); display: flex; align-items: center; gap: 8px; letter-spacing: -0.015em; }
.gp-panel-header-sub { font-size: 12px; color: var(--gp-text-muted); margin-top: 2px; }
.gp-panel-content { flex: 1; overflow-y: auto; padding: 24px 32px; }
.gp-card {
  background: var(--gp-bg-card);
  background-image: var(--gp-grad-card);
  border-radius: 14px; padding: 22px;
  border: 1px solid var(--gp-border);
  box-shadow: var(--gp-shadow-sm);
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
}
.gp-card:hover { border-color: var(--gp-border-hover); box-shadow: var(--gp-shadow-md); }
.gp-card-title { font-size: 13px; font-weight: 600; color: var(--gp-text); margin: 0 0 14px; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; }
.gp-stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 14px; }
.gp-stat-card {
  background: var(--gp-bg-card);
  background-image: var(--gp-grad-card);
  border-radius: 14px; padding: 20px;
  border: 1px solid var(--gp-border);
  box-shadow: var(--gp-shadow-sm);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative; overflow: hidden;
}
.gp-stat-card::after {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.06), transparent);
}
.gp-stat-card:hover {
  border-color: var(--gp-border-hover);
  transform: translateY(-2px);
  box-shadow: var(--gp-shadow-md);
}
.gp-stat-label { font-size: 11px; color: var(--gp-text-secondary); margin-bottom: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.gp-stat-value { font-size: 30px; font-weight: 700; color: var(--gp-text); line-height: 1.1; letter-spacing: -0.025em; }
.gp-stat-unit { font-size: 13px; color: var(--gp-text-muted); font-weight: 400; margin-left: 4px; }
.gp-progress { width: 100%; height: 6px; background: var(--gp-bg-subtle); border-radius: 3px; overflow: hidden; }
.gp-progress-bar { height: 100%; border-radius: 3px; transition: width 0.6s cubic-bezier(0.4,0,0.2,1); background: var(--gp-grad-brand); box-shadow: 0 0 8px var(--gp-brand-glow); }
.gp-btn {
  padding: 8px 15px; border-radius: 9px; border: 1px solid var(--gp-border);
  background: var(--gp-bg-card); color: var(--gp-text); font-size: 13px; cursor: pointer;
  transition: all 0.15s; font-family: inherit; font-weight: 500;
}
.gp-btn:hover { border-color: var(--gp-border-hover); background: var(--gp-bg-subtle); transform: translateY(-1px); }
.gp-btn:active { transform: translateY(0) scale(0.98); }
.gp-btn--primary {
  background: var(--gp-grad-brand); color: #fff; border: 1px solid transparent;
  box-shadow: var(--gp-shadow-brand);
}
.gp-btn--primary:hover { box-shadow: 0 12px 28px rgba(99, 102, 241, 0.35); transform: translateY(-1px); }
.gp-btn--danger { color: #f87171; border-color: rgba(248, 113, 113, 0.3); background: var(--gp-bg-card); }
.gp-btn--danger:hover { background: rgba(248, 113, 113, 0.1); border-color: rgba(248, 113, 113, 0.5); }
.gp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.gp-tag { display: inline-block; padding: 3px 9px; border-radius: 6px; font-size: 11px; font-weight: 600; line-height: 1.6; letter-spacing: 0.02em; }
.gp-loading { text-align: center; padding: 48px; color: var(--gp-text-muted); font-size: 14px; }
.gp-loading::before {
  content: ''; display: inline-block; width: 16px; height: 16px; margin-right: 8px;
  border: 2px solid var(--gp-border); border-top-color: var(--gp-brand);
  border-radius: 50%; animation: gp-spin 0.8s linear infinite; vertical-align: -3px;
}
@keyframes gp-spin { to { transform: rotate(360deg); } }
.gp-empty { text-align: center; padding: 56px 24px; color: var(--gp-text-muted); font-size: 14px; line-height: 1.7; }
.gp-empty-icon {
  width: 56px; height: 56px; margin: 0 auto 16px;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; background: var(--gp-bg-subtle); border-radius: 14px;
  box-shadow: var(--gp-shadow-sm);
}
.gp-error { text-align: center; padding: 14px; color: #fca5a5; font-size: 13px; background: rgba(248, 113, 113, 0.08); border-radius: 10px; border: 1px solid rgba(248, 113, 113, 0.25); }
.gp-panel-content::-webkit-scrollbar { width: 8px; }
.gp-panel-content::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 4px; }
.gp-panel-content::-webkit-scrollbar-thumb:hover { background: #52525b; }
.gp-panel-content::-webkit-scrollbar-track { background: transparent; }
input, textarea, select {
  color: var(--gp-text);
  background: var(--gp-bg-subtle);
  border: 1px solid var(--gp-border);
  border-radius: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
input:focus, textarea:focus, select:focus {
  outline: none;
  border-color: var(--gp-brand);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
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
        <div className="gp-panel-sidebar-footer">
          <span className="gp-panel-status-dot" />
          v0.2.5 · 在线
        </div>
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
