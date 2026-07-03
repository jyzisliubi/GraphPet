import { useEffect, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'

const PYTHON_BASE_URL = 'http://127.0.0.1:8765'
const POLL_INTERVAL_MS = 30_000

type LlmStatus = 'ok' | 'unavailable' | 'checking' | 'cloud' | 'freellm'

const bannerStyle: CSSProperties = {
  position: 'absolute',
  bottom: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 16px',
  background: 'rgba(30, 30, 46, 0.95)',
  border: '1px solid rgba(239, 68, 68, 0.3)',
  color: '#fca5a5',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 20,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(239, 68, 68, 0.1)',
  cursor: 'pointer',
  pointerEvents: 'auto',
  whiteSpace: 'nowrap',
  maxWidth: '92%',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
  userSelect: 'none',
  transition: 'opacity 0.3s ease, transform 0.3s ease',
  backdropFilter: 'blur(12px)'
}

const retryLinkStyle: CSSProperties = {
  textDecoration: 'underline',
  fontWeight: 700,
  marginLeft: 4,
  padding: '2px 6px',
  borderRadius: 4,
  background: 'rgba(239, 68, 68, 0.2)',
  color: '#fca5a5'
}

export default function ErrorBanner(): JSX.Element | null {
  const [llmStatus, setLlmStatus] = useState<LlmStatus>('checking')

  const checkHealth = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${PYTHON_BASE_URL}/health`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) {
        setLlmStatus('unavailable')
        return
      }
      const data = (await res.json()) as { llm_available: boolean | null; provider?: string }
      const provider = data.provider || ''

      if (provider === 'freellm') {
        setLlmStatus(data.llm_available === false ? 'freellm' : 'ok')
      } else if (provider === 'ollama') {
        setLlmStatus(data.llm_available === false ? 'unavailable' : 'ok')
      } else {
        setLlmStatus(data.llm_available === false ? 'cloud' : 'ok')
      }
    } catch {
      setLlmStatus('unavailable')
    }
  }, [])

  useEffect(() => {
    const initialTimer = setTimeout(() => void checkHealth(), 5000)
    const interval = setInterval(() => void checkHealth(), POLL_INTERVAL_MS)
    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
    }
  }, [checkHealth])

  if (llmStatus === 'ok' || llmStatus === 'checking') return null

  const getMessage = (): string => {
    if (llmStatus === 'freellm') return '免费网络服务暂时不可用，请检查网络'
    if (llmStatus === 'cloud') return '云端 API 暂时不可用'
    return 'Nito 的大脑 (Ollama) 没响应'
  }

  return (
    <div
      style={bannerStyle}
      onClick={() => {
        setLlmStatus('checking')
        void checkHealth()
      }}
      title="点击重新检测"
    >
      <span style={{ fontSize: 14 }}>⚠️</span>
      <span>{getMessage()}</span>
      <span style={retryLinkStyle}>重试</span>
    </div>
  )
}
