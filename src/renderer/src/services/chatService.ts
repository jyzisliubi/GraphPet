// 聊天服务（对应 Task 19）
//
// 封装对 Python 后端 /chat 端点的 HTTP 调用。
// 渲染进程通过本模块与本地 Python 服务（http://127.0.0.1:8765）通信，
// 把用户问题发给 PocketGraphRAG，拿到带 [1][2] 引用编号的答案与 sources 列表。
//
// 设计要点：
// - 同源 localhost 调用，无 CORS 问题
// - 默认超时 60 秒（多跳检索 + LLM 生成较慢），可通过参数覆盖
// - 网络错误 / 超时 / 非 2xx 响应统一抛 Error，调用方 try/catch 处理
// - 不引入 axios 等依赖，直接用浏览器 fetch + AbortController

/** Python 后端基础地址（与 feedService 保持一致） */
const PYTHON_BASE_URL = 'http://127.0.0.1:8765'

/** 默认请求超时（毫秒）：闲聊应在5秒内返回，RAG问答最多15秒 */
const DEFAULT_TIMEOUT_MS = 15_000

/** /chat 响应中的引用源（与 Python 端 sources 元素一致） */
export interface ChatSource {
  /** 引用编号，对应 answer 文本中的 [id] */
  id: number
  /** 来源文本片段 */
  text: string
  /** 相似度分数 */
  score: number
  /** 实体名称（如节点/关系名） */
  entity?: string
  /** 来源文件名 */
  source_file?: string
  /** 来源类型 */
  source_type?: string
}

/** 流式SSE事件类型（与后端 /chat/stream 端点格式一致） */
export type StreamEvent =
  | { type: 'status'; message: string }
  | { type: 'chunk'; content: string; full_answer: string }
  | { type: 'sources'; sources: ChatSource[] }
  | { type: 'done'; answer: string; sources: ChatSource[]; pipeline_info?: Record<string, unknown>; emotion?: string }
  | { type: 'error'; message: string }

/** 一条历史消息 */
export interface ChatHistoryMessage {
  role: 'user' | 'assistant' | 'nito'
  content: string
}

/** /chat 响应体（与 Python 端 ChatResponse 模型一致） */
export interface ChatResponse {
  /** 是否成功 */
  success: boolean
  /** 答案文本，可能含 [1][2] 形式的引用编号 */
  answer: string
  /** 引用源列表（id 与 answer 中的 [id] 对应） */
  sources: ChatSource[]
  /** 管线信息（检索模式、是否多跳、是否 HyDE、自检结果等，透传后端） */
  pipeline_info: Record<string, unknown>
  /** 友好提示信息 */
  message: string
  /** 错误信息（成功时为 null） */
  error: string | null
  /** 情感标签：happy/sad/angry/surprised/thinking/neutral */
  emotion?: string
}

/**
 * 带超时的 fetch 封装。
 *
 * 用 AbortController 实现超时；超时后中止请求并抛 TimeoutError。
 * 其他错误（网络断开、HTTP 非 2xx）按原生 fetch 行为处理后再统一抛 Error。
 *
 * @param url 请求地址
 * @param init fetch 配置
 * @param timeoutMS 超时毫秒，默认 60 秒
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
 * 发送聊天问题给 Python /chat 端点，获取带引用的答案。
 *
 * @param question 用户问题
 * @param searchMode 检索模式（可选，传给后端控制检索策略）
 * @param history 对话历史（可选，用于多轮上下文）
 * @returns ChatResponse，包含 answer、sources、pipeline_info 等
 * @throws 网络错误 / 超时 / HTTP 非 2xx 时抛 Error
 */
export async function chat(
  question: string,
  searchMode?: string,
  history?: ChatHistoryMessage[]
): Promise<ChatResponse> {
  const body: { question: string; search_mode: string | null; history?: ChatHistoryMessage[] } = {
    question,
    search_mode: searchMode ?? null
  }
  if (history && history.length > 0) {
    body.history = history.slice(-12)
  }

  let res: Response
  try {
    res = await fetchWithTimeout(`${PYTHON_BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  } catch (err) {
    // AbortError 通常是超时
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('聊天超时：Nito 好像在发呆，再试一次吧~')
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
    throw new Error(`聊天请求失败：${detail}`)
  }

  try {
    const raw = (await res.json()) as Partial<ChatResponse>
    // 兜底处理：sources 缺失时给空数组，避免后续渲染崩溃
    return {
      success: Boolean(raw.success ?? false),
      answer: raw.answer ?? '',
      sources: Array.isArray(raw.sources) ? (raw.sources as ChatSource[]) : [],
      pipeline_info: raw.pipeline_info ?? {},
      message: raw.message ?? '',
      error: raw.error ?? null,
      emotion: raw.emotion ?? 'neutral'
    }
  } catch (err) {
    throw new Error(
      `解析聊天响应失败：${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/**
 * 流式聊天：使用 SSE (text/event-stream) 与后端通信，逐块返回答案。
 *
 * SSE 格式：data: {json}\n\n
 * 事件类型：status/chunk/sources/done/error
 *
 * @param question 用户问题
 * @param searchMode 检索模式（可选）
 * @param history 对话历史（可选）
 * @yields StreamEvent 流式事件
 * @throws 网络错误 / 超时 / HTTP 非 2xx 时抛 Error
 */
export async function* chatStream(
  question: string,
  searchMode?: string,
  history?: ChatHistoryMessage[]
): AsyncGenerator<StreamEvent, void, unknown> {
  const body: { question: string; search_mode: string | null; history?: ChatHistoryMessage[] } = {
    question,
    search_mode: searchMode ?? null
  }
  if (history && history.length > 0) {
    body.history = history.slice(-12)
  }

  let res: Response
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)
    try {
      res = await fetch(`${PYTHON_BASE_URL}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('聊天超时：Nito 好像在发呆，再试一次吧~')
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
      /* ignore */
    }
    throw new Error(`聊天请求失败：${detail}`)
  }

  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error('无法读取响应流')
  }

  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      let lineEndIndex: number
      while ((lineEndIndex = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, lineEndIndex)
        buffer = buffer.slice(lineEndIndex + 2)

        const lines = rawEvent.split('\n')
        let dataStr = ''

        for (const line of lines) {
          if (line.startsWith('data:')) {
            dataStr += line.slice(5).trimStart()
          }
        }

        if (!dataStr || dataStr === '[DONE]') continue

        try {
          const event = JSON.parse(dataStr) as StreamEvent
          yield event
          if (event.type === 'done' || event.type === 'error') {
            return
          }
        } catch (parseErr) {
          console.warn('解析SSE事件失败:', dataStr, parseErr)
        }
      }
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* ignore */
    }
  }
}
