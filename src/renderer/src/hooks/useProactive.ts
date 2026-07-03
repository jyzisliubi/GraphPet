import { useEffect, useRef } from 'react'
import { getProactiveMessage } from '../services/feedService'
import { playMessageSound } from '../services/soundService'

// 主动对话 Hook（Task 21）
//
// 每 60 秒轮询后端 GET /proactive/message，后端依据 settings 中的
// proactiveIntervalMin / quietMode 判断是否该主动说话：
// - should_speak=true 时用传入的 showMessage 弹气泡
// - 安静模式（quietMode）下前端双重检查，直接不启动轮询
//
// 调度逻辑全在后端（scheduler.py），前端只负责轮询与展示。
// 组件卸载或 quietMode 变化时清除并重建 interval。

/** 轮询间隔（毫秒）：每 60 秒检查一次主动对话 */
const POLL_INTERVAL_MS = 60_000

/**
 * 主动对话轮询 Hook。
 *
 * @param showMessage 气泡显示函数（来自 useBubble），触发时调用
 * @param quietMode   安静模式（来自 settings.quietMode），开启则不轮询
 */
export function useProactive(
  showMessage: (message: string, duration?: number) => void,
  quietMode: boolean
): void {
  // 用 ref 持有最新 showMessage，避免闭包陈旧值导致气泡不更新；
  // 同时避免 showMessage 变化导致 effect 频繁重建 interval。
  const showMessageRef = useRef(showMessage)
  showMessageRef.current = showMessage

  useEffect(() => {
    // 安静模式：前端双重检查，不启动轮询（后端也会判断，这里提前短路）
    if (quietMode) return

    let cancelled = false

    const poll = async (): Promise<void> => {
      if (cancelled) return
      try {
        const res = await getProactiveMessage()
        if (cancelled) return
        // 后端返回该说话时弹气泡；用默认时长（4 秒）自动消失
        if (res.should_speak && res.message) {
          playMessageSound()
          showMessageRef.current(res.message)
        }
      } catch {
        // 后端未就绪 / 网络错误时静默，不打扰用户（下次轮询自动重试）
        // 不打印 err 详情，避免在控制台暴露后端实现细节
      }
    }

    // 每 60 秒轮询一次（首次延迟一个周期，避免与启动欢迎语气泡重叠）
    const id = setInterval(poll, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [quietMode])
}
