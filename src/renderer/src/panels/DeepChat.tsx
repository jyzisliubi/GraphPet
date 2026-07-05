import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent, ReactNode } from 'react'
import { useChat } from '../hooks/useChat'
import type { ChatMessage } from '../hooks/useChat'
import type { ChatSource } from '../services/chatService'
import { useSettings } from '../stores/settingsStore'
import NitoIcon from '../components/NitoIcon'

const DEEP_CHAT_CSS = `
.gp-dc-layout { display: flex; height: 100%; gap: 14px; min-height: 0; }
.gp-dc-main { flex: 1; display: flex; flex-direction: column; position: relative; background: var(--gp-bg-card); border-radius: 12px; border: 1px solid var(--gp-border); overflow: hidden; min-width: 0; }
.gp-dc-messages { flex: 1; overflow-y: auto; padding: 20px 20px; display: flex; flex-direction: column; gap: 14px; background: var(--gp-bg); }
.gp-dc-messages::-webkit-scrollbar { width: 6px; }
.gp-dc-messages::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
.gp-dc-messages::-webkit-scrollbar-track { background: transparent; }
.gp-dc-row { display: flex; width: 100%; align-items: flex-end; gap: 8px; }
.gp-dc-row--user { justify-content: flex-end; }
.gp-dc-row--nito { justify-content: flex-start; }
.gp-dc-avatar {
  width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.gp-dc-avatar--nito {
  background: var(--gp-bg-subtle);
}
.gp-dc-bubble { max-width: 72%; padding: 10px 14px; border-radius: 14px; font-size: 13.5px; line-height: 1.65; word-break: break-word; white-space: pre-wrap; }
.gp-dc-bubble--user {
  background: var(--gp-brand); color: #fff;
  border-bottom-right-radius: 4px;
}
.gp-dc-bubble--nito {
  background: var(--gp-bg-card); color: var(--gp-text);
  border: 1px solid var(--gp-border);
  border-bottom-left-radius: 4px;
}
.gp-dc-bubble--error { background: rgba(248, 113, 113, 0.1); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.3); }
.gp-dc-thinking { display: inline-flex; align-items: center; gap: 5px; padding: 2px 0; }
.gp-dc-thinking span { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--gp-text-muted); animation: gp-dc-bounce 1.2s infinite ease-in-out; }
.gp-dc-thinking span:nth-child(2) { animation-delay: 0.2s; }
.gp-dc-thinking span:nth-child(3) { animation-delay: 0.4s; }
@keyframes gp-dc-bounce { 0%,60%,100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-5px); opacity: 1; } }
.gp-dc-cite {
  display: inline-flex; align-items: center; justify-content: center;
  vertical-align: super; font-size: 10px; font-weight: 600; line-height: 1;
  min-width: 16px; height: 16px; padding: 0 4px;
  margin: 0 2px; border-radius: 4px;
  background: rgba(99, 102, 241, 0.2); color: var(--gp-brand-hover); cursor: pointer;
  transition: all 0.12s; user-select: none;
}
.gp-dc-cite:hover { background: rgba(99, 102, 241, 0.3); }
.gp-dc-cite--active { background: var(--gp-brand); color: #fff; }
.gp-dc-empty { margin: auto; text-align: center; color: var(--gp-text-secondary); font-size: 14px; line-height: 1.8; padding: 40px 20px; }
.gp-dc-empty-icon {
  width: 64px; height: 64px; margin: 0 auto 14px;
  display: flex; align-items: center; justify-content: center;
  background: var(--gp-bg-subtle); border-radius: 14px;
  overflow: hidden;
}
.gp-dc-empty-hint { font-size: 12px; color: var(--gp-text-muted); margin-top: 8px; }
.gp-dc-input-area {
  flex-shrink: 0; padding: 12px 16px 14px;
  background: var(--gp-bg-card); border-top: 1px solid var(--gp-border);
  display: flex; gap: 8px; align-items: flex-end;
}
.gp-dc-input {
  flex: 1; resize: none; max-height: 120px; min-height: 40px;
  padding: 9px 14px; font-size: 13.5px; font-family: inherit;
  color: var(--gp-text); background: var(--gp-bg-subtle);
  border: 1px solid transparent; border-radius: 8px;
  outline: none; transition: all 0.15s; line-height: 1.5;
}
.gp-dc-input::placeholder { color: var(--gp-text-muted); }
.gp-dc-input:focus { border-color: var(--gp-bg-hover); background: var(--gp-bg-subtle); }
.gp-dc-send {
  flex-shrink: 0; height: 40px; padding: 0 16px;
  font-size: 13px; font-weight: 600;
  color: #fff; background: var(--gp-brand);
  border: 1px solid var(--gp-brand); border-radius: 8px;
  cursor: pointer; transition: all 0.12s;
  display: flex; align-items: center; gap: 5px;
}
.gp-dc-send:hover:not(:disabled) { background: var(--gp-brand-hover); border-color: var(--gp-brand-hover); }
.gp-dc-send:active:not(:disabled) { transform: scale(0.97); }
.gp-dc-send:disabled { opacity: 0.35; cursor: not-allowed; }
.gp-dc-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: var(--gp-bg); border-bottom: 1px solid var(--gp-border); }
.gp-dc-toolbar-text { font-size: 11px; color: var(--gp-text-secondary); flex: 1; }
.gp-dc-toolbar-btn {
  font-size: 11px; padding: 3px 10px; border-radius: 6px;
  border: 1px solid var(--gp-border); background: var(--gp-bg-card); color: var(--gp-text-muted);
  cursor: pointer; transition: all 0.12s; font-family: inherit;
}
.gp-dc-toolbar-btn:hover { border-color: var(--gp-bg-hover); background: var(--gp-bg-subtle); color: var(--gp-text); }
.gp-dc-sources-panel {
  width: 280px; flex-shrink: 0; background: var(--gp-bg-card);
  border-radius: 12px; border: 1px solid var(--gp-border);
  display: flex; flex-direction: column; overflow: hidden;
}
.gp-dc-sources-header {
  padding: 14px 16px; border-bottom: 1px solid var(--gp-border);
  font-size: 12px; font-weight: 600; color: var(--gp-text-muted);
  display: flex; align-items: center; justify-content: space-between;
  text-transform: uppercase; letter-spacing: 0.03em;
}
.gp-dc-sources-list { flex: 1; overflow-y: auto; padding: 10px; }
.gp-dc-sources-list::-webkit-scrollbar { width: 5px; }
.gp-dc-sources-list::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
.gp-dc-source-item {
  padding: 10px 12px; border-radius: 8px;
  background: var(--gp-bg); font-size: 12px; line-height: 1.5;
  color: var(--gp-text-secondary); margin-bottom: 6px;
  border-left: 3px solid var(--gp-border);
  transition: all 0.15s; cursor: pointer;
}
.gp-dc-source-item:hover { background: var(--gp-bg-subtle); }
.gp-dc-source-item--highlight {
  background: rgba(99, 102, 241, 0.1); border-left-color: var(--gp-brand);
}
.gp-dc-source-id { font-weight: 700; color: var(--gp-brand); margin-right: 4px; }
.gp-dc-source-meta { color: var(--gp-text-muted); font-size: 10px; margin-top: 4px; display: flex; gap: 8px; }
.gp-dc-source-score { color: var(--gp-text-muted); font-size: 10px; float: right; }
.gp-dc-source-snippet {
  display: block; margin-top: 4px; font-size: 11px;
  color: var(--gp-text-muted); line-height: 1.5;
  overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.gp-dc-sources-empty { padding: 40px 16px; text-align: center; color: var(--gp-text-muted); font-size: 12px; }
.gp-dc-sources-empty-icon { font-size: 28px; display: block; margin-bottom: 8px; opacity: 0.5; }
@media (max-width: 900px) { .gp-dc-sources-panel { display: none; } }
.gp-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 9999;
  background: rgba(99, 102, 241, 0.15);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: 2px dashed var(--gp-brand);
  border-radius: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.gp-drop-overlay-inner { text-align: center; }
.gp-drop-overlay-icon { font-size: 48px; margin-bottom: 12px; }
.gp-drop-overlay-text { font-size: 16px; font-weight: 600; color: var(--gp-brand); }
`

let dcStyleInjected = false

function injectDeepChatStyle(): void {
  if (dcStyleInjected) return
  if (typeof document === 'undefined') return
  const el = document.createElement('style')
  el.textContent = DEEP_CHAT_CSS
  document.head.appendChild(el)
  dcStyleInjected = true
}

type AnswerSegment = { type: 'text'; value: string } | { type: 'cite'; id: number }

function parseAnswer(text: string): AnswerSegment[] {
  const segments: AnswerSegment[] = []
  const regex = /\[(\d+)\]/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'cite', id: Number(match[1]) })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return segments
}

function renderAnswerContent(
  message: ChatMessage,
  activeCiteId: number | null,
  onCiteClick: (id: number) => void
): ReactNode[] {
  const segments = parseAnswer(message.content)
  return segments.map((seg, idx) => {
    if (seg.type === 'text') {
      return <span key={`t-${idx}`}>{seg.value}</span>
    }
    const isActive = activeCiteId === seg.id
    return (
      <span
        key={`c-${idx}`}
        className={`gp-dc-cite${isActive ? ' gp-dc-cite--active' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onCiteClick(seg.id)
        }}
        role="button"
        title={`查看来源 ${seg.id}`}
      >
        {seg.id}
      </span>
    )
  })
}

function DeepChatMessageItem({
  message,
  activeCiteId,
  onCiteClick
}: {
  message: ChatMessage
  activeCiteId: number | null
  onCiteClick: (id: number) => void
}): JSX.Element {
  const isUser = message.role === 'user'
  const isError = !!message.error
  const isPending = !!message.pending
  const rowClass = isUser ? 'gp-dc-row gp-dc-row--user' : 'gp-dc-row gp-dc-row--nito'
  const bubbleBase = isError
    ? 'gp-dc-bubble gp-dc-bubble--error'
    : isUser
      ? 'gp-dc-bubble gp-dc-bubble--user'
      : 'gp-dc-bubble gp-dc-bubble--nito'

  return (
    <div className={rowClass}>
      {!isUser && <div className="gp-dc-avatar gp-dc-avatar--nito"><NitoIcon size={28} /></div>}
      <div className={bubbleBase}>
        {isPending ? (
          <span className="gp-dc-thinking">
            <span />
            <span />
            <span />
          </span>
        ) : isError ? (
          <span>⚠️ {message.content}</span>
        ) : isUser ? (
          <span>{message.content}</span>
        ) : (
          renderAnswerContent(message, activeCiteId, onCiteClick)
        )}
      </div>
    </div>
  )
}

export default function DeepChat(): JSX.Element {
  const { settings } = useSettings()
  const { messages, loading, sendQuestion, clearMessages } = useChat({
    storageKey: 'graphpet_deepchat_v1',
    ttsEnabled: settings.ttsEnabled,
    ttsVoice: settings.ttsVoice,
    ttsProvider: settings.ttsProvider
  })
  const [input, setInput] = useState('')
  const [activeCiteId, setActiveCiteId] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const allSources = useMemo<ChatSource[]>(() => {
    const sourceMap = new Map<number, ChatSource>()
    messages.forEach(msg => {
      if (msg.sources) {
        msg.sources.forEach(s => sourceMap.set(s.id, s))
      }
    })
    return Array.from(sourceMap.values())
  }, [messages])

  useEffect(() => {
    injectDeepChatStyle()
    const splash = document.getElementById('graphpet-splash')
    if (splash) splash.remove()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const handleSend = (): void => {
    const text = input.trim()
    if (!text || loading) return
    void sendQuestion(text, 'smart')
    setInput('')
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (): void => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    if (e.currentTarget === e.target) {
      setIsDragging(false)
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setIsDragging(false)
  }

  const showSources = allSources.length > 0
  const empty = messages.length === 0 && !loading

  return (
    <div className="gp-dc-layout">
      <div
        className="gp-dc-main"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {isDragging && (
          <div className="gp-drop-overlay">
            <div className="gp-drop-overlay-inner">
              <div className="gp-drop-overlay-icon">📄</div>
              <div className="gp-drop-overlay-text">松开喂给 Nito</div>
            </div>
          </div>
        )}
        <div className="gp-dc-toolbar">
          <span className="gp-dc-toolbar-text">
            {loading ? 'Nito 正在思考...' : `${messages.length} 条消息 · ${allSources.length} 个引用来源`}
          </span>
          <button className="gp-dc-toolbar-btn" type="button" onClick={clearMessages} disabled={loading}>
            清空对话
          </button>
        </div>

        <div className="gp-dc-messages">
          {empty && (
            <div className="gp-dc-empty">
              <div className="gp-dc-empty-icon"><NitoIcon size={64} /></div>
              <div>和 Nito 开始对话吧</div>
              <div className="gp-dc-empty-hint">Shift+Enter 换行 · 引用文档编号可查看来源</div>
            </div>
          )}

          {messages.map((msg) => (
            <DeepChatMessageItem
              key={msg.localId}
              message={msg}
              activeCiteId={activeCiteId}
              onCiteClick={(id) => setActiveCiteId((prev) => (prev === id ? null : id))}
            />
          ))}

          <div ref={messagesEndRef} />
        </div>

        <div className="gp-dc-input-area">
          <textarea
            ref={textareaRef}
            className="gp-dc-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder="说点什么... (Enter发送, Shift+Enter换行)"
            rows={1}
          />
          <button
            className="gp-dc-send"
            type="button"
            onClick={handleSend}
            disabled={loading || !input.trim()}
          >
            发送
          </button>
        </div>
      </div>

      {showSources && (
        <aside className="gp-dc-sources-panel">
          <div className="gp-dc-sources-header">
            <span>引用来源</span>
            <span style={{ color: '#a1a1aa', fontWeight: 400 }}>{allSources.length}</span>
          </div>
          <div className="gp-dc-sources-list">
            {allSources.map((src) => {
              const cls = activeCiteId === src.id
                ? 'gp-dc-source-item gp-dc-source-item--highlight'
                : 'gp-dc-source-item'
              const scorePct = Math.round((src.score ?? 0) * 100)
              const sourceTitle = src.entity || src.source_file || `来源 ${src.id}`
              return (
                <div
                  key={src.id}
                  className={cls}
                  onClick={() => setActiveCiteId((prev) => (prev === src.id ? null : src.id))}
                >
                  <span className="gp-dc-source-id">[{src.id}]</span>
                  <span>{sourceTitle}</span>
                  <span className="gp-dc-source-score">{scorePct}%</span>
                  {src.text && (
                    <span className="gp-dc-source-snippet">{src.text.slice(0, 120)}...</span>
                  )}
                </div>
              )
            })}
          </div>
        </aside>
      )}
    </div>
  )
}
