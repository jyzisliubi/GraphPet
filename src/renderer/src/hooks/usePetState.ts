import { useCallback, useEffect, useRef, useState } from 'react'

// 桌宠心情/行为状态系统 Hook
//
// 参考 AIRI (moeru-ai/airi) 的 behavior system 设计：
// - mood：长时间持久化（跨会话保存到 localStorage），代表"当前情绪基调"
// - activity：短期行为状态（5~30 秒自动回 idle），代表"现在正在做什么"
// - 自动衰减：长时间无互动 → mood 由 excited/happy 衰减为 neutral → bored → sleepy
// - 互动事件触发 mood/activity 变化，影响 idle motion 选择 + 内心独白内容
//
// 持久化策略：
// - mood + lastInteractionAt 写入 localStorage（key: graphpet_pet_state）
// - activity 不持久化（重启即回到 idle）
//
// 与现有 hook 协作：
// - useIdleThoughts(mood)：按 mood 过滤内心独白库
// - Live2DCanvas.idleMotion：按 mood 倾向选择动作组（happy→tap_body, sleepy→sleep, thinking→thinking）
// - App.tsx 在事件点调用 recordInteraction / setActivity / setMood

/** 心情枚举（中文注释用于内心独白分组） */
export type PetMood =
  | 'happy' // 开心：被喂食、被摸头、回答成功
  | 'curious' // 好奇：用户提问、看到截屏
  | 'excited' // 兴奋：刚被点击、连续互动
  | 'bored' // 无聊：长时间无互动
  | 'sleepy' // 困倦：极长时间无互动
  | 'sad' // 难过：喂食失败、被频繁戳
  | 'neutral' // 中性：默认状态

/** 行为状态枚举 */
export type PetActivity =
  | 'idle' // 闲置
  | 'eating' // 喂食中
  | 'thinking' // 思考中（等待 LLM 回复）
  | 'talking' // 说话中（回复气泡显示中）
  | 'sleeping' // 睡眠中（长闲置触发，未来扩展）

/** 互动事件类型 */
export type InteractionType =
  | 'feed-start'
  | 'feed-success'
  | 'feed-fail'
  | 'pet-head'
  | 'tap-body'
  | 'chat-ask'
  | 'chat-reply'
  | 'chat-error'
  | 'screenshot'
  | 'spit'

/** 持久化到 localStorage 的状态 */
interface PersistedState {
  mood: PetMood
  lastInteractionAt: number
}

/** localStorage key */
const STORAGE_KEY = 'graphpet_pet_state'

/** 默认持久化状态 */
const DEFAULT_PERSISTED: PersistedState = {
  mood: 'neutral',
  lastInteractionAt: Date.now()
}

/** 心情自动衰减时间表（毫秒） */
const MOOD_DECAY_SCHEDULE: Array<{ afterMs: number; mood: PetMood }> = [
  { afterMs: 2 * 60_000, mood: 'neutral' }, // 2 分钟无互动 → 中性
  { afterMs: 8 * 60_000, mood: 'bored' }, // 8 分钟 → 无聊
  { afterMs: 20 * 60_000, mood: 'sleepy' } // 20 分钟 → 困倦
]

/** 衰减检查间隔 */
const DECAY_CHECK_INTERVAL_MS = 30_000

/** 互动事件 → mood 映射 */
const INTERACTION_MOOD_MAP: Record<InteractionType, PetMood> = {
  'feed-start': 'excited',
  'feed-success': 'happy',
  'feed-fail': 'sad',
  'pet-head': 'happy',
  'tap-body': 'excited',
  'chat-ask': 'curious',
  'chat-reply': 'happy',
  'chat-error': 'sad',
  screenshot: 'curious',
  spit: 'sad'
}

/** 读取 localStorage 持久化状态（失败回退默认） */
function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PERSISTED }
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    if (!parsed.mood) return { ...DEFAULT_PERSISTED }
    return {
      mood: parsed.mood as PetMood,
      lastInteractionAt:
        typeof parsed.lastInteractionAt === 'number' ? parsed.lastInteractionAt : Date.now()
    }
  } catch {
    return { ...DEFAULT_PERSISTED }
  }
}

/** 写入 localStorage 持久化状态（失败静默） */
function savePersisted(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* 静默：无 localStorage 或配额满 */
  }
}

export interface UsePetStateResult {
  /** 当前心情（持久化） */
  mood: PetMood
  /** 当前行为状态（短期） */
  activity: PetActivity
  /** 上次互动时间戳（ms） */
  lastInteractionAt: number
  /** 记录一次互动事件，自动更新 mood + activity + lastInteractionAt */
  recordInteraction: (type: InteractionType) => void
  /** 直接设置 mood（持久化） */
  setMood: (mood: PetMood) => void
  /** 临时切换 activity，durationMs 后自动回 idle（默认 5s） */
  setActivity: (activity: PetActivity, durationMs?: number) => void
  /** 重置为默认状态 */
  resetState: () => void
}

/**
 * 桌宠心情/行为状态系统 Hook
 *
 * - mood 持久化到 localStorage，跨会话保留
 * - activity 短期状态，到期自动回 idle
 * - 长时间无互动触发 mood 衰减（happy/curious/excited → neutral → bored → sleepy）
 * - 互动事件触发 mood/activity 变化
 */
export function usePetState(): UsePetStateResult {
  const [initial] = useState(loadPersisted)
  const [mood, setMoodState] = useState<PetMood>(initial.mood)
  const [activity, setActivityState] = useState<PetActivity>('idle')
  const lastInteractionAtRef = useRef<number>(initial.lastInteractionAt)
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 持久化 mood + lastInteractionAt（节流写入：每次 mood 变化或互动时写入）
  const persist = useCallback((nextMood: PetMood, at: number): void => {
    savePersisted({ mood: nextMood, lastInteractionAt: at })
  }, [])

  // 心情自动衰减：每 30s 检查一次
  useEffect(() => {
    const checkDecay = (): void => {
      const now = Date.now()
      const elapsed = now - lastInteractionAtRef.current
      // 从长到短检查，命中第一个匹配的衰减目标
      for (let i = MOOD_DECAY_SCHEDULE.length - 1; i >= 0; i--) {
        const rule = MOOD_DECAY_SCHEDULE[i]
        if (elapsed >= rule.afterMs) {
          setMoodState((prev) => {
            // 只在当前 mood 是"积极"或"中性"时衰减，避免打断 sad 等明确情绪
            const decayableMoods: PetMood[] = ['happy', 'curious', 'excited', 'neutral']
            if (!decayableMoods.includes(prev)) return prev
            if (prev === rule.mood) return prev
            return rule.mood
          })
          break
        }
      }
    }
    const id = setInterval(checkDecay, DECAY_CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // 临时 activity 自动回 idle
  const scheduleActivityReset = useCallback((durationMs: number): void => {
    if (activityTimerRef.current) clearTimeout(activityTimerRef.current)
    activityTimerRef.current = setTimeout(() => {
      setActivityState('idle')
      activityTimerRef.current = null
    }, durationMs)
  }, [])

  // 卸载时清理 timer
  useEffect(() => {
    return () => {
      if (activityTimerRef.current) clearTimeout(activityTimerRef.current)
    }
  }, [])

  /** 记录一次互动事件 */
  const recordInteraction = useCallback(
    (type: InteractionType): void => {
      const now = Date.now()
      lastInteractionAtRef.current = now
      const nextMood = INTERACTION_MOOD_MAP[type] ?? 'neutral'
      setMoodState(nextMood)
      persist(nextMood, now)

      // 同步设置 activity
      switch (type) {
        case 'feed-start':
        case 'screenshot':
          setActivityState('eating')
          scheduleActivityReset(8_000)
          break
        case 'chat-ask':
          setActivityState('thinking')
          scheduleActivityReset(30_000)
          break
        case 'chat-reply':
          setActivityState('talking')
          scheduleActivityReset(6_000)
          break
        case 'chat-error':
        case 'feed-fail':
        case 'spit':
          setActivityState('idle')
          break
        default:
          break
      }
    },
    [persist, scheduleActivityReset]
  )

  /** 直接设置 mood */
  const setMood = useCallback(
    (nextMood: PetMood): void => {
      const now = Date.now()
      lastInteractionAtRef.current = now
      setMoodState(nextMood)
      persist(nextMood, now)
    },
    [persist]
  )

  /** 临时切换 activity，到期自动回 idle */
  const setActivity = useCallback(
    (nextActivity: PetActivity, durationMs: number = 5_000): void => {
      setActivityState(nextActivity)
      scheduleActivityReset(durationMs)
    },
    [scheduleActivityReset]
  )

  /** 重置为默认状态 */
  const resetState = useCallback((): void => {
    const now = Date.now()
    lastInteractionAtRef.current = now
    setMoodState('neutral')
    setActivityState('idle')
    if (activityTimerRef.current) {
      clearTimeout(activityTimerRef.current)
      activityTimerRef.current = null
    }
    persist('neutral', now)
  }, [persist])

  return {
    mood,
    activity,
    lastInteractionAt: lastInteractionAtRef.current,
    recordInteraction,
    setMood,
    setActivity,
    resetState
  }
}
