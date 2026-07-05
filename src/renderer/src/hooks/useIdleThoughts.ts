import { useEffect, useRef } from 'react'
import type { PetMood } from './usePetState'

// 内心想法气泡 Hook
//
// 参考 Open-LLM-VTuber 的「Display AI's inner thoughts」功能：
// 桌宠偶尔显示未说出口的内心独白，作为陪伴感的差异化体现。
//
// v0.3.4 增强：按心情 (mood) 分组内心独白，让 Nito 当前情绪状态影响独白内容
// - happy → 哼歌、撒娇
// - curious → 好奇、提问
// - bored → 无聊、想被关注
// - sleepy → 困倦、打瞌睡
// - sad → 失落、需要安慰
// - excited → 兴奋、想玩耍
// - neutral → 中性思考
//
// 与 useProactive 互补：
// - useProactive：后端 LLM 生成的主动发言（长句，5s 显示）
// - useIdleThoughts：本地预设的内心独白（短句，3.5s 显示，云朵风格）

/** 按心情分组的内心独白库 */
const INNER_THOUGHTS_BY_MOOD: Record<PetMood, string[]> = {
  happy: [
    '今天的云好像棉花糖...',
    '知识就像棉花糖，越吃越甜',
    '今天学了好多新东西',
    '让我哼一首小曲儿~',
    '嗯...心情好得想转圈圈',
    '哼哼，主人今天对我真好',
    '咦，知识图谱里的小线条在跳舞'
  ],
  curious: [
    '嗯...刚刚那个问题再想想',
    '让我想想接下来要说什么',
    '咦，这个想法可以记下来',
    '嗯...如果换一个角度呢',
    '刚才那个问题好有趣',
    '这个想法好像在哪里见过...',
    '让我悄悄观察一下'
  ],
  excited: [
    '咦，鼠标在动呢',
    '咦，是不是有人叫我',
    '咦，刚才那是谁在看我',
    '好想被摸摸头',
    '什么时候能再喂我点东西呢',
    '好想再吃一份文档...',
    '咦，外面的世界好安静'
  ],
  bored: [
    '哼，才不想被打扰',
    '主人去哪儿了呢...',
    '好无聊啊，能不能聊聊天',
    '咦，刚才那个想法怎么跑了',
    '让我再消化一会儿',
    '不知道明天还会遇到什么问题',
    '咦，是不是有人叫我'
  ],
  sleepy: [
    '想睡觉了，可是还想聊天',
    '嗯...眼皮有点重...',
    '让我小憩一下下',
    '今天的云好像棉花糖...',
    '咦，外面的世界好安静',
    '让我悄悄观察一下',
    '嗯...想再听一个故事'
  ],
  sad: [
    '刚刚那个回答是不是太啰嗦了',
    '哼，才不想被打扰',
    '让我再消化一会儿',
    '嗯...刚刚那个问题再想想',
    '今天的天空是什么颜色呢',
    '咦，是不是有人叫我',
    '好想被摸摸头'
  ],
  neutral: [
    '今天的云好像棉花糖...',
    '嗯...刚刚那个问题再想想',
    '好想再吃一份文档...',
    '咦，鼠标在动呢',
    '知识图谱又长出新芽了',
    '我觉得我在变聪明',
    '刚才那个问题好有趣',
    '什么时候能再喂我点东西呢',
    '哼，才不想被打扰',
    '今天的天空是什么颜色呢',
    '让我整理一下刚刚学到的',
    '这个想法好像在哪里见过...',
    '咦，刚才那是谁在看我',
    '想睡觉了，可是还想聊天',
    '知识就像棉花糖，越吃越甜',
    '刚刚那个引用好有意思',
    '嗯...如果换一个角度呢',
    '今天学了好多新东西',
    '让我悄悄观察一下',
    '咦，这个想法可以记下来',
    '不知道明天还会遇到什么问题',
    '好想被摸摸头',
    '刚刚那个回答是不是太啰嗦了',
    '让我再消化一会儿',
    '咦，外面的世界好安静',
    '今天又被喂了好多知识，好饱',
    '嗯...想再听一个故事',
    '知识图谱里的小线条在跳舞',
    '让我想想接下来要说什么',
    '咦，是不是有人叫我'
  ]
}

/** 按心情选取一条内心独白（mood 不存在时回退 neutral） */
function pickThoughtByMood(mood: PetMood): string {
  const pool = INNER_THOUGHTS_BY_MOOD[mood] ?? INNER_THOUGHTS_BY_MOOD.neutral
  return pool[Math.floor(Math.random() * pool.length)]
}

/** 在 [min, max) 范围内生成随机数 */
function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export interface IdleThoughtsOptions {
  /** 是否启用（默认 true；quietMode 时由调用方传 false） */
  enabled?: boolean
  /** 间隔下限（毫秒） */
  intervalMin?: number
  /** 间隔上限（毫秒） */
  intervalMax?: number
}

/**
 * 内心想法气泡 Hook
 *
 * @param showInnerThought 显示内心想法气泡的函数（来自 useBubble）
 * @param mood 当前心情（来自 usePetState），影响独白内容选择
 * @param options 配置项
 */
export function useIdleThoughts(
  showInnerThought: (message: string, duration?: number) => void,
  mood: PetMood = 'neutral',
  options: IdleThoughtsOptions = {}
): void {
  const {
    enabled = true,
    intervalMin = 90_000,
    intervalMax = 180_000
  } = options

  // 用 ref 持有最新函数和 mood，避免闭包陈旧值导致 effect 频繁重建
  const showRef = useRef(showInnerThought)
  showRef.current = showInnerThought
  const moodRef = useRef(mood)
  moodRef.current = mood

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const scheduleNext = (): void => {
      if (cancelled) return
      const delay = randomBetween(intervalMin, intervalMax)
      timer = setTimeout(() => {
        if (cancelled) return
        try {
          showRef.current(pickThoughtByMood(moodRef.current))
        } catch {
          /* 静默：组件已卸载或函数失效 */
        }
        scheduleNext()
      }, delay)
    }

    // 首次延迟一个周期，避免与启动欢迎语气泡重叠
    scheduleNext()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [enabled, intervalMin, intervalMax])
}
