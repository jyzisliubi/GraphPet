import { useCallback, useEffect, useState } from 'react'

// 自定义 Hook：通过 IPC 获取 Live2D Nito 模型的差分角色（皮肤）列表
//
// 主进程会扫描 assets/live2d/nito/*.model3.json，读取每个文件的 "Name"
// 字段作为角色名（缺失则用文件名），返回 [{ name, path }] 数组。
// 若模型未就绪（目录不存在或无 .model3.json），返回空数组。
//
// 使用方式：
//   const { skins, loading, error, refresh } = useLive2DSkins()
//   if (loading) // 加载中
//   if (skins.length === 0) // 无可用皮肤，提示下载模型
//   else // 渲染皮肤列表，调用 onSelect(skin.path) 切换

/** 单个皮肤项 */
export interface Live2DSkin {
  /** 差分角色显示名称 */
  name: string
  /** .model.json/.model3.json 的 file:// URL */
  path: string
  /** 模型格式：cubism2 或 cubism4 */
  format: 'cubism2' | 'cubism4'
}

export interface UseLive2DSkinsResult {
  /** 皮肤列表 */
  skins: Live2DSkin[]
  /** 是否正在加载（IPC 调用期间） */
  loading: boolean
  /** 错误信息（IPC 调用失败时） */
  error: string | null
  /** 重新获取皮肤列表 */
  refresh: () => void
}

/**
 * 通过 IPC 获取 Live2D Nito 模型的差分角色（皮肤）列表
 */
export function useLive2DSkins(): UseLive2DSkinsResult {
  const [skins, setSkins] = useState<Live2DSkin[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  // refresh 自增计数器，每次调用触发 useEffect 重新拉取
  const [tick, setTick] = useState<number>(0)

  const refresh = useCallback((): void => {
    setTick((t) => t + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    window.api
      .getLive2DSkins()
      .then((list: Live2DSkin[]) => {
        if (cancelled) return
        setSkins(list)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[useLive2DSkins] 获取皮肤列表失败:', err)
        setError(msg)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [tick])

  return { skins, loading, error, refresh }
}
