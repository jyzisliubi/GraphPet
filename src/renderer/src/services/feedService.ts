// 喂食服务（对应 Task 14）
//
// 封装对 Python 后端 /feed 与 /memory/stats 端点的 HTTP 调用。
// 渲染进程通过本模块与本地 Python 服务（http://127.0.0.1:8765）通信，
// 把拖拽进来的文件 / URL 喂给桌宠，触发知识图谱增量索引。
//
// 设计要点：
// - 同源 localhost 调用，无 CORS 问题
// - 默认超时 120 秒（大文件抽取三元组较慢），可通过参数覆盖
// - 网络错误 / 超时 / 非 2xx 响应统一抛 Error，调用方 try/catch 处理
// - 不引入 axios 等依赖，直接用浏览器 fetch + AbortController

/** Python 后端基础地址（与 main 进程保持一致） */
const PYTHON_BASE_URL = 'http://127.0.0.1:8765'

/** 默认请求超时（毫秒）：大文件抽取三元组较慢，留 180 秒 */
const DEFAULT_TIMEOUT_MS = 180_000

/** 单条三元组（P1-C：喂食后预览用） */
export interface TripleItem {
  head: string
  relation: string
  tail: string
}

/** /feed 响应体（与 Python 端 FeedResponse 模型一致） */
export interface FeedResponse {
  /** 是否成功 */
  success: boolean
  /** 文件名 / URL（用于气泡展示） */
  file_name: string
  /** 抽取到的实体数 */
  entity_count: number
  /** chunk 总数（索引库累计） */
  chunk_count: number
  /** 文件指纹（用于去重） */
  file_fingerprint: string
  /** 友好提示信息 */
  message: string
  /** 预估页数（后端基于文件大小/类型估算，用于前端分流提示） */
  estimated_pages: number
  /** 文件大小分类：small(<5页) / medium(5~50页) / large(>50页) */
  size_category: 'small' | 'medium' | 'large'
  /** 错误信息（成功时为 null；重复喂食时为 'already_fed'） */
  error: string | null
  /** 本次喂食新增的三元组列表（P1-C：喂食后预览卡片用） */
  new_triples?: TripleItem[]
}

/** /memory/stats 响应体（与 Python 端 get_memory_stats 返回结构一致） */
export interface MemoryStats {
  /** 实体总数 */
  entity_count: number
  /** 三元组总数 */
  triple_count: number
  /** 已吃文件数 */
  fed_file_count: number
  /** chunk 总数 */
  chunk_count: number
  /** rice_rag 索引是否可用 */
  available: boolean
  /** 关系种类数（Python 端返回，前端统计用） */
  relation_count?: number
}

/** /growth/summary 响应体（与 Python 端 get_growth_summary 返回结构一致） */
export interface GrowthSummary {
  /** 智力等级名称：懵懂/入门/聪慧/博学/学神 */
  intelligence_level: string
  /** 智力经验值（=知识图谱实体数） */
  intelligence_xp: number
  /** 亲密度（0-100，由互动频次映射） */
  intimacy: number
  /** 亲密度等级：陌生/熟悉/亲近/挚友 */
  intimacy_level: string
  /** 性格倾向：好奇/活泼/稳重/博学 */
  personality: string
  /** 已吃文件数 */
  fed_file_count: number
  /** 总互动次数（喂食+对话+点击） */
  total_interactions: number
  /** 最后互动时间（ISO 8601 字符串） */
  last_interaction_at?: string
}

/** /proactive/message 响应体（与 Python 端 proactive_message 返回结构一致） */
export interface ProactiveResponse {
  /** 是否该主动说话 */
  should_speak: boolean
  /** 主动消息文案（should_speak=false 时为空字符串） */
  message: string
  /** 触发类型：'scheduled' / 'long_no_feed' / 'late_night'；未触发时为空字符串 */
  trigger_type: string
}

/**
 * 带超时的 fetch 封装。
 *
 * 用 AbortController 实现超时；超时后中止请求并抛 TimeoutError。
 * 其他错误（网络断开、HTTP 非 2xx）按原生 fetch 行为处理后再统一抛 Error。
 *
 * @param url 请求地址
 * @param init fetch 配置（可包含自定义 timeoutMS）
 * @param timeoutMS 超时毫秒，默认 120 秒
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMS: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    return res
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 喂文件：将本地文件路径提交给 Python /feed，触发三元组抽取与增量索引。
 *
 * @param filePath 本地文件绝对路径
 * @returns FeedResponse，包含抽取统计与友好提示
 * @throws 网络错误 / 超时 / HTTP 非 2xx 时抛 Error
 */
export async function feedFile(filePath: string): Promise<FeedResponse> {
  return postFeed({ file_path: filePath, url: null })
}

/**
 * 喂 URL：将网页 URL 提交给 Python /feed，抓取并抽取知识。
 *
 * @param url 网页 URL
 * @returns FeedResponse
 * @throws 网络错误 / 超时 / HTTP 非 2xx 时抛 Error
 */
export async function feedUrl(url: string): Promise<FeedResponse> {
  return postFeed({ file_path: null, url })
}

// ========================
// SSE 流式喂食（P0-C：四阶段进度反馈）
// ========================

/** 喂食阶段类型 */
export type FeedStage = 'parsing' | 'preparing' | 'extracting' | 'finalizing' | 'done' | 'error'

/** SSE 推送的进度事件 */
export interface FeedStageEvent {
  stage: FeedStage
  progress: number
  message: string
  // done 事件携带完整 FeedResponse 字段；error 事件携带 error 字段
  [key: string]: unknown
}

/**
 * SSE 流式喂食：POST /feed/stream，解析 text/event-stream 推送四阶段进度。
 *
 * 前端用 fetch + ReadableStream 手动解析 SSE（EventSource 不支持 POST）。
 * onStage 回调在每个 stage 事件触发时调用；done 事件触发后 resolve FeedResponse。
 *
 * @param body 请求体 { file_path, url }
 * @param onStage 进度回调 (event: FeedStageEvent) => void
 * @param signal 可选 AbortSignal，用于取消
 * @returns FeedResponse（done 事件携带的完整响应）
 * @throws 网络错误 / error 事件 / 流解析失败时抛 Error
 */
async function postFeedStream(
  body: { file_path: string | null; url: string | null },
  onStage: (event: FeedStageEvent) => void,
  signal?: AbortSignal
): Promise<FeedResponse> {
  let res: Response
  try {
    res = await fetch(`${PYTHON_BASE_URL}/feed/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('喂食已取消')
    }
    throw new Error(
      `无法连接 Python 后端：${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const text = await res.text()
      if (text) detail = `${detail} - ${text}`
    } catch {
      /* 忽略 */
    }
    throw new Error(`喂食请求失败：${detail}`)
  }

  if (!res.body) {
    throw new Error('后端未返回流式响应')
  }

  // 手动解析 SSE：按 \n\n 分割事件块，每块内按行解析 event: / data:
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let result: FeedResponse | null = null
  let errorMessage: string | null = null

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // 按 \n\n 分割事件块（SSE 标准分隔符）
      let sepIdx: number
      while ((sepIdx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, sepIdx)
        buffer = buffer.slice(sepIdx + 2)
        const parsed = parseSseBlock(block)
        if (!parsed) continue

        const eventData = parsed.data as FeedStageEvent
        onStage(eventData)

        if (parsed.event === 'done') {
          // done 事件携带完整 FeedResponse 字段
          result = {
            success: Boolean(eventData.success),
            file_name: String(eventData.file_name ?? ''),
            entity_count: Number(eventData.entity_count ?? 0),
            chunk_count: Number(eventData.chunk_count ?? 0),
            file_fingerprint: String(eventData.file_fingerprint ?? ''),
            message: String(eventData.message ?? ''),
            estimated_pages: Number(eventData.estimated_pages ?? 0),
            size_category: (eventData.size_category as 'small' | 'medium' | 'large') ?? 'small',
            error: (eventData.error as string | null) ?? null,
            // P1-C：传递本次新增的三元组列表
            new_triples: (eventData.new_triples as TripleItem[] | undefined) ?? undefined
          }
        } else if (parsed.event === 'error') {
          errorMessage = String(eventData.error ?? eventData.message ?? '喂食失败')
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* 忽略 */
    }
  }

  if (errorMessage) {
    throw new Error(errorMessage)
  }
  if (result) {
    return result
  }
  throw new Error('喂食流意外结束（未收到 done 事件）')
}

/** 解析单个 SSE 事件块，返回 { event, data }。 */
function parseSseBlock(block: string): { event: string; data: Record<string, unknown> } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }
  if (dataLines.length === 0) return null
  try {
    const data = JSON.parse(dataLines.join('\n')) as Record<string, unknown>
    return { event, data }
  } catch {
    return null
  }
}

/**
 * 流式喂文件：推送四阶段进度，完成后返回 FeedResponse。
 *
 * @param filePath 本地文件绝对路径
 * @param onStage 进度回调
 * @param signal 可选取消信号
 */
export async function feedFileStreaming(
  filePath: string,
  onStage: (event: FeedStageEvent) => void,
  signal?: AbortSignal
): Promise<FeedResponse> {
  return postFeedStream({ file_path: filePath, url: null }, onStage, signal)
}

/**
 * 流式喂 URL：推送四阶段进度，完成后返回 FeedResponse。
 *
 * @param url 网页 URL
 * @param onStage 进度回调
 * @param signal 可选取消信号
 */
export async function feedUrlStreaming(
  url: string,
  onStage: (event: FeedStageEvent) => void,
  signal?: AbortSignal
): Promise<FeedResponse> {
  return postFeedStream({ file_path: null, url }, onStage, signal)
}

/**
 * /feed 端点的统一 POST 调用。
 *
 * @param body 请求体 { file_path, url }
 * @returns FeedResponse
 */
async function postFeed(body: {
  file_path: string | null
  url: string | null
}): Promise<FeedResponse> {
  let res: Response
  try {
    res = await fetchWithTimeout(`${PYTHON_BASE_URL}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  } catch (err) {
    // AbortError 通常是超时
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('喂食超时：Python 后端响应超过 180 秒，可能是文件太大或 LLM 处理较慢')
    }
    throw new Error(
      `无法连接 Python 后端：${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!res.ok) {
    // 尝试从响应体解析错误信息，失败则用状态码兜底
    let detail = `HTTP ${res.status}`
    try {
      const text = await res.text()
      if (text) detail = `${detail} - ${text}`
    } catch {
      /* 忽略读体失败 */
    }
    throw new Error(`喂食请求失败：${detail}`)
  }

  try {
    return (await res.json()) as FeedResponse
  } catch (err) {
    throw new Error(
      `解析喂食响应失败：${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/**
 * 获取记忆统计：实体数 / 三元组数 / 已吃文件数 / chunk 数。
 *
 * 即使 rice_rag 未就绪，端点也返回 available=false 的安全空统计，
 * 不会抛错；仅在 HTTP / 网络层失败时抛 Error。
 *
 * @returns MemoryStats
 * @throws 网络错误 / 超时 / HTTP 非 2xx 时抛 Error
 */
export async function getMemoryStats(): Promise<MemoryStats> {
  let res: Response
  try {
    res = await fetchWithTimeout(`${PYTHON_BASE_URL}/memory/stats`, {
      method: 'GET'
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('获取记忆统计超时')
    }
    throw new Error(
      `无法连接 Python 后端：${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!res.ok) {
    throw new Error(`获取记忆统计失败：HTTP ${res.status}`)
  }

  const raw = (await res.json()) as Partial<MemoryStats> & {
    fed_files?: unknown
    relation_count?: number
    index_dir?: string
  }

  // 兼容 Python 端可能返回的额外字段，仅取本接口所需
  return {
    entity_count: Number(raw.entity_count ?? 0),
    triple_count: Number(raw.triple_count ?? 0),
    fed_file_count: Number(raw.fed_file_count ?? 0),
    chunk_count: Number(raw.chunk_count ?? 0),
    available: Boolean(raw.available ?? false),
    relation_count: Number(raw.relation_count ?? 0)
  }
}

/**
 * 获取养成状态摘要：智力等级 / 亲密度 / 性格 / 喂食 / 互动统计。
 *
 * 智力等级直接映射知识图谱实体规模，亲密度由互动频次映射，
 * 性格随喂养内容演化。供养成面板与桌宠气泡展示。
 *
 * 即使 rice_rag 未就绪，端点也返回安全默认值，不会抛错；
 * 仅在 HTTP / 网络层失败时抛 Error。
 *
 * @returns GrowthSummary
 * @throws 网络错误 / 超时 / HTTP 非 2xx 时抛 Error
 */
export async function getGrowthSummary(): Promise<GrowthSummary> {
  let res: Response
  try {
    res = await fetchWithTimeout(`${PYTHON_BASE_URL}/growth/summary`, {
      method: 'GET'
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('获取养成状态超时')
    }
    throw new Error(
      `无法连接 Python 后端：${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!res.ok) {
    throw new Error(`获取养成状态失败：HTTP ${res.status}`)
  }

  const raw = (await res.json()) as Partial<GrowthSummary> & {
    last_interaction_at?: string
  }

  return {
    intelligence_level: String(raw.intelligence_level ?? '懵懂'),
    intelligence_xp: Number(raw.intelligence_xp ?? 0),
    intimacy: Number(raw.intimacy ?? 0),
    intimacy_level: String(raw.intimacy_level ?? '陌生'),
    personality: String(raw.personality ?? '好奇'),
    fed_file_count: Number(raw.fed_file_count ?? 0),
    total_interactions: Number(raw.total_interactions ?? 0),
    last_interaction_at: String(raw.last_interaction_at ?? '')
  }
}

/**
 * 获取主动对话消息：轮询后端判断是否该主动说话（Task 21）。
 *
 * 后端根据 settings.proactiveIntervalMin / quietMode 评估：
 * - 安静模式或距上次互动未满间隔 -> should_speak=false
 * - 触发时按类型返回文案（scheduled / long_no_feed / late_night）
 *
 * 主动消息为轻量轮询，用 10 秒超时（远小于默认 120 秒），
 * 网络 / HTTP 错误时抛 Error，调用方静默处理即可。
 *
 * @returns ProactiveResponse
 * @throws 网络错误 / 超时 / HTTP 非 2xx 时抛 Error
 */
export async function getProactiveMessage(): Promise<ProactiveResponse> {
  let res: Response
  try {
    res = await fetchWithTimeout(
      `${PYTHON_BASE_URL}/proactive/message`,
      { method: 'GET' },
      10_000
    )
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('获取主动消息超时')
    }
    throw new Error(
      `无法连接 Python 后端：${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!res.ok) {
    throw new Error(`获取主动消息失败：HTTP ${res.status}`)
  }

  const raw = (await res.json()) as Partial<ProactiveResponse>
  return {
    should_speak: Boolean(raw.should_speak ?? false),
    message: String(raw.message ?? ''),
    trigger_type: String(raw.trigger_type ?? '')
  }
}
