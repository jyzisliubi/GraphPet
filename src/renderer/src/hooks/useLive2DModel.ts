import { useEffect, useState } from 'react'

export interface UseLive2DModelResult {
  modelPath: string | null
  modelFormat: 'cubism2' | 'cubism4' | null
  loading: boolean
  error: string | null
}

export function useLive2DModel(): UseLive2DModelResult {
  const [modelPath, setModelPath] = useState<string | null>(null)
  const [modelFormat, setModelFormat] = useState<'cubism2' | 'cubism4' | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    window.api
      .getLive2DModelPath()
      .then((result) => {
        if (cancelled) return
        setModelPath(result.path)
        setModelFormat(result.format)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[useLive2DModel] 获取模型路径失败:', err)
        setError(msg)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { modelPath, modelFormat, loading, error }
}
