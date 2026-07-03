import { createRoot } from 'react-dom/client'
import App from './App'
import './global.css'

// 非宠物窗口（网页面板/聊天窗）立即移除 splash 紫色球，避免闪烁
(function removeSplashForNonPetWindows(): void {
  if (typeof window === 'undefined') return
  const hash = window.location.hash
  if (hash.startsWith('#/panel') || hash.startsWith('#/chat-window')) {
    const splash = document.getElementById('graphpet-splash')
    if (splash) splash.remove()
  }
})()

const container = document.getElementById('root')
if (!container) {
  throw new Error('找不到 #root 根节点')
}

createRoot(container).render(<App />)
