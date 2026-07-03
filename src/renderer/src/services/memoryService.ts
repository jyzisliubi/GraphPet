// 记忆管理服务（Task 25 / 26 / 28）
//
// 封装对 Python 后端记忆管理端点的 HTTP 调用：
// - GET  /memory/graph          ：获取三元组列表（图谱可视化）
// - GET  /memory/files          ：获取已吃文件列表
// - DELETE /memory/file/{fp}    ：删除指定文件记忆
// - GET  /memory/export         ：导出记忆为 JSON
// - POST /memory/spit-last      ：吐掉最近吃的文件记忆
//
// 设计与 chatService / feedService 一致：不引入额外依赖，用 fetch + AbortController。

/** Python 后端基础地址 */
const PYTHON_BASE_URL = 'http://127.0.0.1:8765'

/** 默认请求超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 30_000

/** 三元组（用于图谱可视化） */
export interface Triple {
  head: string
  relation: string
  tail: string
}

/** /memory/graph 响应体 */
export interface MemoryGraphResponse {
  triples: Triple[]
  count: number
}

/** 已吃文件记录 */
export interface FedFile {
  name: string
  fingerprint: string
  entity_count: number
  triples_count?: number
  fed_at: string
}

/** /memory/files 响应体 */
export interface MemoryFilesResponse {
  files: FedFile[]
}

/** /memory/file/{fp}/triples 响应体（文件清单详情展开） */
export interface FileTriplesResponse {
  fingerprint: string
  triples: Triple[]
  count: number
}

/** 删除 / 吐掉操作的响应体 */
export interface MemoryActionResponse {
  success: boolean
  name: string
  entity_count: number
  message: string
}

/** 时间线事件 */
export interface TimelineEvent {
  timestamp: string
  event: string
  file_name: string | null
}

/** /memory/export 响应体（部分字段） */
export interface MemoryExportResponse {
  stats: Record<string, unknown>
  triples: Triple[]
  fed_files: FedFile[]
  memory_timeline: TimelineEvent[]
  growth: Record<string, unknown>
}

/**
 * 带超时的 fetch 封装。
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMS: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 获取知识图谱三元组列表（Task 25 图谱可视化）。
 *
 * @returns MemoryGraphResponse，包含三元组列表与数量
 * @throws 网络错误 / 超时 / HTTP 非 2xx 时抛 Error
 */
export async function getMemoryGraph(): Promise<MemoryGraphResponse> {
  let res: Response
  try {
    res = await fetchWithTimeout(`${PYTHON_BASE_URL}/memory/graph`, {
      method: 'GET'
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('获取记忆图谱超时')
    }
    throw new Error(
      `无法连接 Python 后端：${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!res.ok) {
    throw new Error(`获取记忆图谱失败：HTTP ${res.status}`)
  }

  const raw = (await res.json()) as Partial<MemoryGraphResponse>
  return {
    triples: Array.isArray(raw.triples) ? (raw.triples as Triple[]) : [],
    count: Number(raw.count ?? 0)
  }
}

/**
 * 获取已吃文件列表（Task 26 文件清单页）。
 *
 * @returns MemoryFilesResponse
 * @throws 网络错误 / 超时 / HTTP 非 2xx 时抛 Error
 */
export async function getMemoryFiles(): Promise<MemoryFilesResponse> {
  let res: Response
  try {
    res = await fetchWithTimeout(`${PYTHON_BASE_URL}/memory/files`, {
      method: 'GET'
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('获取文件列表超时')
    }
    throw new Error(
      `无法连接 Python 后端：${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!res.ok) {
    throw new Error(`获取文件列表失败：HTTP ${res.status}`)
  }

  const raw = (await res.json()) as Partial<MemoryFilesResponse>
  return {
    files: Array.isArray(raw.files) ? (raw.files as FedFile[]) : []
  }
}

/**
 * 删除指定文件的记忆（Task 26 文件清单删除按钮）。
 *
 * @param fingerprint 文件 MD5 指纹
 * @returns MemoryActionResponse
 * @throws 网络错误 / 超时 / HTTP 非 2xx 时抛 Error
 */
export async function deleteMemoryFile(
  fingerprint: string
): Promise<MemoryActionResponse> {
  let res: Response
  try {
    res = await fetchWithTimeout(
      `${PYTHON_BASE_URL}/memory/file/${encodeURIComponent(fingerprint)}`,
      { method: 'DELETE' }
    )
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('删除文件记忆超时')
    }
    throw new Error(
      `无法连接 Python 后端：${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!res.ok) {
    throw new Error(`删除文件记忆失败：HTTP ${res.status}`)
  }

  return (await res.json()) as MemoryActionResponse
}

/**
 * 获取指定文件抽取的三元组列表（文件清单详情展开）。
 *
 * @param fingerprint 文件 MD5 指纹
 * @returns FileTriplesResponse
 * @throws 网络错误 / 超时 / HTTP 非 2xx 时抛 Error
 */
export async function getFileTriples(
  fingerprint: string
): Promise<FileTriplesResponse> {
  let res: Response
  try {
    res = await fetchWithTimeout(
      `${PYTHON_BASE_URL}/memory/file/${encodeURIComponent(fingerprint)}/triples`,
      { method: 'GET' }
    )
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('获取文件三元组超时')
    }
    throw new Error(
      `无法连接 Python 后端：${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!res.ok) {
    throw new Error(`获取文件三元组失败：HTTP ${res.status}`)
  }

  const raw = (await res.json()) as Partial<FileTriplesResponse>
  return {
    fingerprint: String(raw.fingerprint ?? fingerprint),
    triples: Array.isArray(raw.triples) ? (raw.triples as Triple[]) : [],
    count: Number(raw.count ?? 0)
  }
}

/**
 * 导出记忆为 JSON（Task 26 导出按钮）。
 *
 * @returns MemoryExportResponse，包含统计 / 三元组 / 文件列表 / 时间线 / 成长状态
 * @throws 网络错误 / 超时 / HTTP 非 2xx 时抛 Error
 */
export async function exportMemory(): Promise<MemoryExportResponse> {
  let res: Response
  try {
    res = await fetchWithTimeout(`${PYTHON_BASE_URL}/memory/export`, {
      method: 'GET'
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('导出记忆超时')
    }
    throw new Error(
      `无法连接 Python 后端：${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!res.ok) {
    throw new Error(`导出记忆失败：HTTP ${res.status}`)
  }

  return (await res.json()) as MemoryExportResponse
}

/**
 * 吐掉最近吃的文件记忆（Task 28 快捷撤回）。
 *
 * @returns MemoryActionResponse
 * @throws 网络错误 / 超时 / HTTP 非 2xx 时抛 Error
 */
export async function spitLast(): Promise<MemoryActionResponse> {
  let res: Response
  try {
    res = await fetchWithTimeout(`${PYTHON_BASE_URL}/memory/spit-last`, {
      method: 'POST'
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('吐掉操作超时')
    }
    throw new Error(
      `无法连接 Python 后端：${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!res.ok) {
    throw new Error(`吐掉操作失败：HTTP ${res.status}`)
  }

  return (await res.json()) as MemoryActionResponse
}
