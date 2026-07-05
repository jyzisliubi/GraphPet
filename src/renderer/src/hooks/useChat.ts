import { useCallback, useEffect, useRef, useState } from 'react'
import { chatStream, type ChatSource } from '../services/chatService'
import { playMessageSound, playErrorSound } from '../services/soundService'
import { speakText } from '../services/ttsService'

// 聊天 Hook（对应 Task 19）
//
// 封装聊天状态管理：
// - messages：对话历史（用户消息 + Nito 回答，含 sources / error 标记）
// - loading：是否正在等待回答（用于显示"思考中..."动画）
// - error：最近一次错误（用于面板顶部提示条，可选）
// - sendQuestion：发送问题，调用 chatService.chat，更新 messages
//
// 设计要点：
// - sendQuestion 会先 push 一条用户消息 + 一条占位 Nito 消息（loading 期间由面板渲染为"思考中..."），
//   拿到响应后用结果替换占位消息，失败则替换为 error 消息
// - 用 ref 持有 onThinkingChange 回调，避免外部内联函数导致 useCallback 依赖频繁变化
// - 不在此处联动 Live2D 表情，由 App.tsx 通过 onThinkingChange 回调统一控制
//   （发送问题时触发 thinking 表情，回答完成恢复 default 表情）

/** 一条聊天消息 */
export interface ChatMessage {
  /** 角色：用户 / Nito */
  role: 'user' | 'nito'
  /** 文本内容（Nito 回答可能含 [1][2] 引用编号） */
  content: string
  /** 引用源列表（仅 Nito 回答有，对应 content 中的 [id]） */
  sources?: ChatSource[]
  /** 是否为错误消息（true 时面板用红色文字渲染） */
  error?: boolean
  /** 是否处于"思考中"（true 时面板渲染三点跳动动画，content 为空） */
  pending?: boolean
  /** 是否正在流式输出（true 时显示闪烁光标） */
  streaming?: boolean
  /** 本地消息 id（用于列表 key 与替换占位消息） */
  localId: number
}

/** useChat 选项：通过回调让外部控制 Live2D 思考表情 */
export interface UseChatOptions {
  /** 思考状态变化回调：true=开始思考（触发 thinking 表情），false=结束（恢复 default） */
  onThinkingChange?: (thinking: boolean) => void
  /** 情感变化回调：后端返回的emotion标签用于驱动Live2D表情 */
  onEmotionChange?: (emotion: string) => void
  /** localStorage 持久化 key（Task 24 深度聊天用）；不传则不持久化（桌宠 ChatPanel 行为不变） */
  storageKey?: string
  /** TTS 语音播报开关：开启后 Nito 回答会用 edge-tts 朗读 */
  ttsEnabled?: boolean
  /** TTS 语音角色（edge-tts ShortName，仅当 ttsEnabled 为 true 时使用） */
  ttsVoice?: string
}

/** useChat 返回值 */
export interface UseChatResult {
  /** 对话历史 */
  messages: ChatMessage[]
  /** 是否正在等待回答 */
  loading: boolean
  /** 最近一次错误（用于面板顶部提示条，可选） */
  error: string | null
  /** 发送问题：立即追加用户消息 + 占位 Nito 消息，异步拿到答案后替换占位 */
  sendQuestion: (question: string, searchMode?: string) => Promise<void>
  /** 清空对话历史 */
  clearMessages: () => void
}

export function useChat(options?: UseChatOptions): UseChatResult {
  // 若提供了 storageKey，从 localStorage 懒加载历史消息（Task 24 深度聊天持久化）
  const storageKey = options?.storageKey
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (!storageKey) return []
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[]
        if (Array.isArray(parsed)) return parsed
      }
    } catch {
      /* localStorage 不可用或 JSON 损坏：用空数组兜底 */
    }
    return []
  })
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // 自增 localId 计数器（用 ref 持有，避免闭包陈旧）
  const idRef = useRef<number>(0)
  const nextId = (): number => {
    idRef.current += 1
    return idRef.current
  }

  // 用 ref 持有最新 messages，避免 sendQuestion 闭包中读取到陈旧历史
  const messagesRef = useRef<ChatMessage[]>([])
  messagesRef.current = messages

  // 用 ref 持有回调，避免外部传入内联函数时导致 sendQuestion 依赖频繁变化
  const onThinkingChangeRef = useRef(options?.onThinkingChange)
  onThinkingChangeRef.current = options?.onThinkingChange

  const onEmotionChangeRef = useRef(options?.onEmotionChange)
  onEmotionChangeRef.current = options?.onEmotionChange

  // 持久化 key 用 ref 持有，避免 effect 依赖变化导致重复读写
  const storageKeyRef = useRef(storageKey)
  storageKeyRef.current = storageKey

  // TTS 配置用 ref 持有，避免 sendQuestion 依赖频繁变化
  const ttsEnabledRef = useRef(options?.ttsEnabled ?? false)
  ttsEnabledRef.current = options?.ttsEnabled ?? false
  const ttsVoiceRef = useRef(options?.ttsVoice ?? 'zh-CN-XiaoyiNeural')
  ttsVoiceRef.current = options?.ttsVoice ?? 'zh-CN-XiaoyiNeural'

  // 挂载后：若从 localStorage 加载了消息，把 idRef 推进到已用 localId 之后，
  // 避免新消息 id 与历史消息冲突。effect 仅在挂载时执行一次。
  useEffect(() => {
    if (messages.length > 0) {
      const maxId = messages.reduce((mx, m) => Math.max(mx, m.localId), 0)
      if (idRef.current <= maxId) {
        idRef.current = maxId + 1
      }
    }
    // 仅挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // messages 变化时持久化到 localStorage（仅当指定了 storageKey）
  useEffect(() => {
    const key = storageKeyRef.current
    if (!key) return
    try {
      localStorage.setItem(key, JSON.stringify(messages))
    } catch {
      /* 写入失败（配额满 / 隐私模式）静默处理 */
    }
  }, [messages])

  /**
   * 设置思考状态并通知外部回调（如 App.tsx 切换 Live2D 表情）。
   */
  const setThinking = useCallback((thinking: boolean): void => {
    try {
      onThinkingChangeRef.current?.(thinking)
    } catch {
      /* 外部回调失败静默，不影响聊天主流程 */
    }
  }, [])

  /**
   * 发送问题（流式版本）：
   * 1. 立即追加用户消息 + 占位 Nito 消息（pending=true，面板渲染"思考中..."）
   * 2. 触发 onThinkingChange(true) 让 App 切换 Live2D thinking 表情
   * 3. 调用 chatStream，逐块更新消息内容
   *    - chunk 事件：逐字追加 content，切换到 streaming 状态
   *    - sources 事件：更新 sources
   *    - done 事件：标记完成，设置最终 sources
   *    - error 事件：显示错误消息
   * 4. 网络/解析错误时用 error 消息替换占位
   * 5. 无论成功失败都触发 onThinkingChange(false) 恢复表情
   */
  const sendQuestion = useCallback(
    async (question: string, searchMode?: string): Promise<void> => {
      const trimmed = question.trim()
      if (!trimmed) return

      if (loading) return

      const userMsg: ChatMessage = {
        role: 'user',
        content: trimmed,
        localId: nextId()
      }
      const pendingMsg: ChatMessage = {
        role: 'nito',
        content: '',
        pending: true,
        streaming: false,
        localId: nextId()
      }

      setMessages((prev) => [...prev, userMsg, pendingMsg])
      setLoading(true)
      setError(null)
      setThinking(true)

      const currentMessages = messagesRef.current
      const historyForApi = currentMessages
        .filter(m => !m.pending && !m.error && !m.streaming)
        .map(m => ({
          role: m.role === 'nito' ? 'assistant' as const : 'user' as const,
          content: m.content
        }))

      let accumulatedContent = ''
      let finalSources: ChatSource[] = []
      let finalSuccess = true
      let finalMessage = ''

      try {
        for await (const event of chatStream(trimmed, searchMode, historyForApi)) {
          switch (event.type) {
            case 'status':
              break
            case 'chunk':
              accumulatedContent += event.content
              setMessages((prev) =>
                prev.map((m) =>
                  m.localId === pendingMsg.localId
                    ? { ...m, content: accumulatedContent, pending: false, streaming: true }
                    : m
                )
              )
              break
            case 'sources':
              finalSources = event.sources
              setMessages((prev) =>
                prev.map((m) =>
                  m.localId === pendingMsg.localId
                    ? { ...m, sources: event.sources }
                    : m
                )
              )
              break
            case 'error':
              finalSuccess = false
              finalMessage = event.message
              break
            case 'done':
              // done 事件：{type:'done', answer, sources, pipeline_info, emotion}
              // 如果已有 chunk 累积的内容，使用累积内容；否则用 done 中的 answer
              if (!accumulatedContent && event.answer) {
                accumulatedContent = event.answer
              }
              if (event.sources && event.sources.length > 0) {
                finalSources = event.sources
              }
              finalSuccess = true
              // 触发Live2D表情变化
              if (event.emotion) {
                try { onEmotionChangeRef.current?.(event.emotion) } catch { /* ignore */ }
              }
              break
          }
        }

        const answerMsg: ChatMessage = {
          role: 'nito',
          content: accumulatedContent || (finalSuccess ? '' : finalMessage || '回答失败'),
          sources: finalSources.length > 0 ? finalSources : undefined,
          error: finalSuccess ? false : true,
          pending: false,
          streaming: false,
          localId: pendingMsg.localId
        }

        setMessages((prev) =>
          prev.map((m) => (m.localId === pendingMsg.localId ? answerMsg : m))
        )

        if (finalSuccess && accumulatedContent) {
          // 卸载守卫：组件已卸载则不触发音效/TTS 等副作用
          if (!mountedRef.current) return
          playMessageSound()
          // TTS 语音播报（仅当用户开启时调用，不阻塞主流程）
          if (ttsEnabledRef.current) {
            void speakText(accumulatedContent, ttsVoiceRef.current)
          }
        } else if (!finalSuccess) {
          if (!mountedRef.current) return
          playErrorSound()
          setError(finalMessage || '回答失败')
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const errorMsg: ChatMessage = {
          role: 'nito',
          content: `出错了：${errMsg}`,
          error: true,
          pending: false,
          streaming: false,
          localId: pendingMsg.localId
        }
        setMessages((prev) =>
          prev.map((m) => (m.localId === pendingMsg.localId ? errorMsg : m))
        )
        setError(errMsg)
        playErrorSound()
      } finally {
        setLoading(false)
        setThinking(false)
      }
    },
    [loading, setThinking]
  )

  /** 清空对话历史与错误状态（同时清除 localStorage 持久化） */
  const clearMessages = useCallback((): void => {
    setMessages([])
    setError(null)
    const key = storageKeyRef.current
    if (key) {
      try {
        localStorage.removeItem(key)
      } catch {
        /* 静默 */
      }
    }
  }, [])

  // 卸载守卫：避免流式回调在组件卸载后触发 TTS / 表情 / 音效等副作用
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  return { messages, loading, error, sendQuestion, clearMessages, mountedRef }
}
