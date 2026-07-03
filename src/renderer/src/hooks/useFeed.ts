import { useCallback, useRef, useState } from 'react'
import {
  feedFileStreaming,
  feedUrlStreaming,
  type FeedResponse,
  type FeedStageEvent,
  type TripleItem
} from '../services/feedService'
import { useBubble } from './useBubble'
import { playFeedStartSound, playFeedSuccessSound, playErrorSound } from '../services/soundService'

// P1-C：喂食成功后返回三元组预览数据，供 App.tsx 弹出预览卡片
export interface FeedResultPreview {
  fileName: string
  triples: TripleItem[]
  entityCount: number
  tripleCount: number
}

// 喂食 Hook（Task 14 + Task 15 + Task 17 + P0-C 四阶段进度）
//
// 封装文件/URL 喂食的统一状态管理：
// - feeding：消化中标记，供 Live2D 表情 / 对话框禁用等联动使用
// - feedFile / feedUrl：单次喂食（拖拽文件 / URL 对话框），内部自动处理消化中气泡与结果气泡
//   P0-C：改用 SSE 流式 API，气泡实时显示四阶段进度（解析→准备→抽取→入库）
// - feedFileBatch：批量喂食（Task 15 右键菜单），不弹气泡，通过 onProgress 更新进度对话框
//   P0-C：onProgress 回调扩展 stage/progress 字段，FeedProgressDialog 展示每文件四阶段进度条

/** 批量喂食进度回调参数（P0-C 扩展 stage/progress） */
export interface FeedBatchProgress {
  /** 文件在队列中的索引 */
  index: number
  /** 当前状态 */
  status: 'feeding' | 'success' | 'failed'
  /** 结果消息（success/failed 时） */
  message?: string
  /** 当前阶段（feeding 时）：parsing/preparing/extracting/finalizing */
  stage?: string
  /** 进度百分比 0-100（feeding 时） */
  progress?: number
  /** 阶段消息（feeding 时） */
  stageMessage?: string
}

/** 批量喂食结果汇总 */
export interface FeedBatchSummary {
  /** 成功数 */
  success: number
  /** 失败数 */
  failed: number
}

/** useFeed 选项：通过回调让外部控制 Live2D 表情 */
export interface UseFeedOptions {
  /** 喂食开始回调（如触发 Live2D 张嘴表情） */
  onFeedStart?: () => void
  /** 喂食结束回调（成功时恢复正常表情，失败时触发"呕"表情） */
  onFeedEnd?: (success: boolean) => void
}

// 文件大小分流阈值（前端用 File.size 估算，与后端 estimated_pages 互补）
// <500KB → small（秒过）/ 500KB~5MB → medium（进度条）/ >5MB → large（后台）
const SMALL_FILE_THRESHOLD = 500 * 1024 // 500KB
const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024 // 5MB

/**
 * 从文件路径提取文件名（兼容 Windows 反斜杠与 POSIX 正斜杠）。
 */
function getFileName(filePath: string): string {
  const sep = filePath.includes('\\') ? '\\' : '/'
  return filePath.split(sep).pop() ?? filePath
}

/**
 * 根据文件大小生成分流提示气泡文案（喂食开始时显示）。
 */
function getInitialBubbleMessage(filePath: string, fileSize?: number): string {
  if (fileSize === undefined) {
    return '消化中...'
  }
  const fileName = getFileName(filePath)
  if (fileSize < SMALL_FILE_THRESHOLD) {
    return `在吃《${fileName}》...`
  }
  if (fileSize < LARGE_FILE_THRESHOLD) {
    return '正在消化...'
  }
  return '这个文件比较大，慢慢吃...'
}

/**
 * 根据后端响应生成完成反馈气泡文案（Task 17 优化）。
 */
function getResultMessage(result: FeedResponse): string {
  if (result.success && result.error === 'already_fed') {
    return '上次吃过啦，要不要再消化一次？'
  }
  if (result.success && result.entity_count > 0) {
    return result.message
  }
  if (result.success) {
    return '吃完了但没记住什么...'
  }
  return `吃不下：${result.error ?? result.message}`
}

/** 阶段中文标签（用于气泡和进度展示） */
const STAGE_LABEL: Record<string, string> = {
  parsing: '解析文档',
  preparing: '准备图谱',
  extracting: '抽取知识',
  finalizing: '入库统计'
}

/**
 * 把 SSE 阶段事件格式化为气泡文案。
 * 格式：基础文案（阶段标签）+ 进度百分比 + 阶段消息
 */
function formatStageBubble(baseMsg: string, event: FeedStageEvent): string {
  const label = STAGE_LABEL[event.stage] ?? event.stage
  const pct = Math.round(event.progress)
  return `${baseMsg} [${label} ${pct}%] ${event.message}`
}

export function useFeed(options?: UseFeedOptions): {
  feeding: boolean
  feedFile: (filePath: string, fileSize?: number) => Promise<FeedResultPreview | null>
  feedUrl: (url: string) => Promise<FeedResultPreview | null>
  feedFileBatch: (
    filePaths: string[],
    onProgress: (progress: FeedBatchProgress) => void,
    isCancelled: () => boolean
  ) => Promise<FeedBatchSummary>
  cancelCurrentFeed: () => void
} {
  const [feeding, setFeeding] = useState<boolean>(false)
  const { showMessage } = useBubble()
  const abortControllerRef = useRef<AbortController | null>(null)

  // 用 ref 持有回调，避免外部传入内联函数时导致 useCallback 依赖频繁变化
  const onFeedStartRef = useRef(options?.onFeedStart)
  const onFeedEndRef = useRef(options?.onFeedEnd)
  onFeedStartRef.current = options?.onFeedStart
  onFeedEndRef.current = options?.onFeedEnd

  const cancelCurrentFeed = useCallback((): void => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  // 单次喂食文件：消化中气泡 → SSE 流式进度 → 结果气泡（P0-C）
  // fileSize 来自拖拽时 File.size，用于前端文件大小分流提示
  // P1-C：成功后返回三元组预览数据
  const feedFile = useCallback(
    async (filePath: string, fileSize?: number): Promise<FeedResultPreview | null> => {
      setFeeding(true)
      playFeedStartSound()
      onFeedStartRef.current?.()
      const baseMsg = getInitialBubbleMessage(filePath, fileSize)
      showMessage(baseMsg, 0)
      try {
        const result = await feedFileStreaming(filePath, (event) => {
          if (event.stage !== 'done' && event.stage !== 'error') {
            showMessage(formatStageBubble(baseMsg, event), 0)
          }
        })
        showMessage(getResultMessage(result))
        if (result.success) {
          playFeedSuccessSound()
        } else {
          playErrorSound()
        }
        onFeedEndRef.current?.(result.success)
        // P1-C：返回预览数据（仅成功且有新三元组时）
        if (result.success && result.new_triples && result.new_triples.length > 0) {
          return {
            fileName: result.file_name,
            triples: result.new_triples,
            entityCount: result.entity_count,
            tripleCount: result.entity_count // entity_count 已是图谱总数
          }
        }
        return null
      } catch (err) {
        showMessage(`吃不下：${err instanceof Error ? err.message : String(err)}`)
        playErrorSound()
        onFeedEndRef.current?.(false)
        return null
      } finally {
        setFeeding(false)
      }
    },
    [showMessage]
  )

  // 单次喂食 URL：消化中气泡 → SSE 流式进度 → 结果气泡（P0-C）
  // P1-C：成功后返回三元组预览数据
  const feedUrl = useCallback(
    async (url: string): Promise<FeedResultPreview | null> => {
      setFeeding(true)
      playFeedStartSound()
      onFeedStartRef.current?.()
      const baseMsg = '消化中...'
      showMessage(baseMsg, 0)
      try {
        const result = await feedUrlStreaming(url, (event) => {
          if (event.stage !== 'done' && event.stage !== 'error') {
            showMessage(formatStageBubble(baseMsg, event), 0)
          }
        })
        showMessage(getResultMessage(result))
        if (result.success) {
          playFeedSuccessSound()
        } else {
          playErrorSound()
        }
        onFeedEndRef.current?.(result.success)
        // P1-C：返回预览数据
        if (result.success && result.new_triples && result.new_triples.length > 0) {
          return {
            fileName: result.file_name,
            triples: result.new_triples,
            entityCount: result.entity_count,
            tripleCount: result.entity_count
          }
        }
        return null
      } catch (err) {
        showMessage(`吃不下：${err instanceof Error ? err.message : String(err)}`)
        playErrorSound()
        onFeedEndRef.current?.(false)
        return null
      } finally {
        setFeeding(false)
      }
    },
    [showMessage]
  )

  // 批量喂食（Task 15 + P0-C）：顺序处理多个文件，通过 onProgress 回调报告四阶段进度
  // 一次只处理一个文件（避免 LightRAG 索引冲突），失败不中断后续
  const feedFileBatch = useCallback(
    async (
      filePaths: string[],
      onProgress: (progress: FeedBatchProgress) => void,
      isCancelled: () => boolean
    ): Promise<FeedBatchSummary> => {
      setFeeding(true)
      onFeedStartRef.current?.()
      let success = 0
      let failed = 0

      for (let i = 0; i < filePaths.length; i++) {
        if (isCancelled()) break

        onProgress({ index: i, status: 'feeding', stage: 'parsing', progress: 0, stageMessage: '准备中...' })

        const controller = new AbortController()
        abortControllerRef.current = controller

        try {
          const result = await feedFileStreaming(filePaths[i], (event) => {
            if (event.stage !== 'done' && event.stage !== 'error') {
              onProgress({
                index: i,
                status: 'feeding',
                stage: event.stage,
                progress: event.progress,
                stageMessage: event.message
              })
            }
          }, controller.signal)
          if (result.success) {
            success++
            onProgress({ index: i, status: 'success', message: result.message })
          } else {
            failed++
            onProgress({ index: i, status: 'failed', message: result.message })
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            onProgress({ index: i, status: 'failed', message: '已取消' })
          } else {
            failed++
            onProgress({
              index: i,
              status: 'failed',
              message: err instanceof Error ? err.message : String(err)
            })
          }
        } finally {
          abortControllerRef.current = null
        }
      }

      onFeedEndRef.current?.(failed === 0)
      setFeeding(false)
      return { success, failed }
    },
    []
  )

  return { feeding, feedFile, feedUrl, feedFileBatch, cancelCurrentFeed }
}
