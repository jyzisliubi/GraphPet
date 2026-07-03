import { useEffect, useState } from 'react'
import { getGrowthSummary, getMemoryStats } from '../services/feedService'
import type { GrowthSummary, MemoryStats } from '../services/feedService'
import NitoIcon from '../components/NitoIcon'

// 智力等级展示页（Task 27）
//
// 可视化 Nito 的成长状态：
// - 智力等级 + 经验值进度条（实体数 → 懵懂/入门/聪慧/博学/学神）
// - 亲密度进度条（互动次数 → 陌生/熟悉/亲近/挚友）
// - 性格标签
// - 统计卡片：已吃文件数 / 实体数 / 三元组数 / 互动次数 / chunk 数

/** 智力等级阈值（与 personality.py 保持一致） */
const INTELLIGENCE_THRESHOLDS: Array<{ threshold: number; label: string }> = [
  { threshold: 0, label: '懵懂' },
  { threshold: 50, label: '入门' },
  { threshold: 200, label: '聪慧' },
  { threshold: 500, label: '博学' },
  { threshold: 1000, label: '学神' }
]

/** 亲密度等级阈值（与 personality.py 保持一致） */
const INTIMACY_THRESHOLDS: Array<{ threshold: number; label: string }> = [
  { threshold: 0, label: '陌生' },
  { threshold: 10, label: '熟悉' },
  { threshold: 30, label: '亲近' },
  { threshold: 60, label: '挚友' }
]

/** 性格标签颜色映射 */
const PERSONALITY_COLORS: Record<string, string> = {
  好奇: '#10b981',
  活泼: '#f59e0b',
  稳重: '#6366f1',
  博学: '#6366f1'
}

/** 计算智力等级进度信息 */
function getIntelligenceProgress(xp: number): {
  current: { threshold: number; label: string }
  next: { threshold: number; label: string } | null
  percent: number
} {
  let current = INTELLIGENCE_THRESHOLDS[0]
  let next: { threshold: number; label: string } | null = null
  for (let i = 0; i < INTELLIGENCE_THRESHOLDS.length; i++) {
    if (xp >= INTELLIGENCE_THRESHOLDS[i].threshold) {
      current = INTELLIGENCE_THRESHOLDS[i]
      next = INTELLIGENCE_THRESHOLDS[i + 1] ?? null
    }
  }
  let percent = 100
  if (next) {
    percent = Math.min(
      100,
      Math.round(
        ((xp - current.threshold) / (next.threshold - current.threshold)) * 100
      )
    )
  }
  return { current, next, percent }
}

/** 计算亲密度进度信息 */
function getIntimacyProgress(xp: number): {
  current: { threshold: number; label: string }
  next: { threshold: number; label: string } | null
  percent: number
} {
  let current = INTIMACY_THRESHOLDS[0]
  let next: { threshold: number; label: string } | null = null
  for (let i = 0; i < INTIMACY_THRESHOLDS.length; i++) {
    if (xp >= INTIMACY_THRESHOLDS[i].threshold) {
      current = INTIMACY_THRESHOLDS[i]
      next = INTIMACY_THRESHOLDS[i + 1] ?? null
    }
  }
  let percent = 100
  if (next) {
    percent = Math.min(
      100,
      Math.round(
        ((xp - current.threshold) / (next.threshold - current.threshold)) * 100
      )
    )
  }
  return { current, next, percent }
}

export default function Profile(): JSX.Element {
  const [growth, setGrowth] = useState<GrowthSummary | null>(null)
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([getGrowthSummary(), getMemoryStats()])
      .then(([g, s]) => {
        if (cancelled) return
        setGrowth(g)
        setStats(s)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return <div className="gp-loading">📊 正在加载成长状态...</div>
  }

  if (error) {
    return <div className="gp-error">❌ {error}</div>
  }

  if (!growth) {
    return <div className="gp-empty">暂无成长数据</div>
  }

  const intProgress = getIntelligenceProgress(growth.intelligence_xp)
  const intimProgress = getIntimacyProgress(growth.total_interactions)
  const personalityColor =
    PERSONALITY_COLORS[growth.personality] ?? '#6366f1'

  return (
    <div>
      {/* 等级总览卡片 */}
      <div
        className="gp-card"
        style={{
          marginBottom: 16,
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          color: '#fff',
          border: 'none'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginBottom: 16
          }}
        >
          <span style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.2)', borderRadius: 12, overflow: 'hidden' }}><NitoIcon size={48} /></span>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              Nito · {growth.intelligence_level}
            </div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
              智力经验值 {growth.intelligence_xp} · 亲密度{' '}
              {growth.intimacy_level}（{growth.intimacy}/100）
            </div>
          </div>
          <span
            className="gp-tag"
            style={{
              marginLeft: 'auto',
              background: 'rgba(255,255,255,0.2)',
              color: '#fff',
              fontSize: 14
            }}
          >
            {growth.personality}
          </span>
        </div>

        {/* 智力进度条 */}
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              marginBottom: 6,
              opacity: 0.9
            }}
          >
            <span>🧠 智力 · {intProgress.current.label}</span>
            <span>
              {growth.intelligence_xp}
              {intProgress.next
                ? ` / ${intProgress.next.threshold}（→${intProgress.next.label}）`
                : ' · 已满级'}
            </span>
          </div>
          <div
            className="gp-progress"
            style={{ background: 'rgba(255,255,255,0.2)' }}
          >
            <div
              className="gp-progress-bar"
              style={{
                width: `${intProgress.percent}%`,
                background: '#fbbf24'
              }}
            />
          </div>
        </div>

        {/* 亲密度进度条 */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              marginBottom: 6,
              opacity: 0.9
            }}
          >
            <span>💛 亲密度 · {intimProgress.current.label}</span>
            <span>
              {growth.total_interactions} 次互动
              {intimProgress.next
                ? `（→${intimProgress.next.label}需 ${intimProgress.next.threshold} 次）`
                : ' · 已满级'}
            </span>
          </div>
          <div
            className="gp-progress"
            style={{ background: 'rgba(255,255,255,0.2)' }}
          >
            <div
              className="gp-progress-bar"
              style={{
                width: `${intimProgress.percent}%`,
                background: '#f472b6'
              }}
            />
          </div>
        </div>
      </div>

      {/* 性格倾向卡片 */}
      <div className="gp-card" style={{ marginBottom: 16 }}>
        <h3 className="gp-card-title">🎭 性格倾向</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {['好奇', '活泼', '稳重', '博学'].map((p) => (
            <span
              key={p}
              className="gp-tag"
              style={{
                background:
                  p === growth.personality
                    ? personalityColor
                    : 'var(--gp-bg-subtle)',
                color: p === growth.personality ? '#fff' : 'var(--gp-text-secondary)',
                fontSize: 13,
                padding: '5px 14px'
              }}
            >
              {p === growth.personality ? '✓ ' : ''}
              {p}
            </span>
          ))}
        </div>
        <p
          style={{
            fontSize: 12,
            color: 'var(--gp-text-muted)',
            margin: '10px 0 0',
            lineHeight: 1.6
          }}
        >
          性格随喂养内容演化：实体数 &gt; 500 时变为「博学」，喂食次数 &gt; 10
          时变为「活泼」，默认为「好奇」。
        </p>
      </div>

      {/* 统计卡片网格 */}
      <div className="gp-stat-grid">
        <div className="gp-stat-card">
          <div className="gp-stat-label">已吃文件</div>
          <div className="gp-stat-value">
            {growth.fed_file_count}
            <span className="gp-stat-unit">个</span>
          </div>
        </div>
        <div className="gp-stat-card">
          <div className="gp-stat-label">实体总数</div>
          <div className="gp-stat-value">
            {stats?.entity_count ?? growth.intelligence_xp}
            <span className="gp-stat-unit">个</span>
          </div>
        </div>
        <div className="gp-stat-card">
          <div className="gp-stat-label">三元组数</div>
          <div className="gp-stat-value">
            {stats?.triple_count ?? 0}
            <span className="gp-stat-unit">条</span>
          </div>
        </div>
        <div className="gp-stat-card">
          <div className="gp-stat-label">Chunk 数</div>
          <div className="gp-stat-value">
            {stats?.chunk_count ?? 0}
            <span className="gp-stat-unit">块</span>
          </div>
        </div>
        <div className="gp-stat-card">
          <div className="gp-stat-label">总互动次数</div>
          <div className="gp-stat-value">
            {growth.total_interactions}
            <span className="gp-stat-unit">次</span>
          </div>
        </div>
        <div className="gp-stat-card">
          <div className="gp-stat-label">关系种类</div>
          <div className="gp-stat-value">
            {stats?.relation_count ?? 0}
            <span className="gp-stat-unit">种</span>
          </div>
        </div>
      </div>

      {/* 最后互动时间 */}
      {growth.last_interaction_at && (
        <div
          style={{
            marginTop: 16,
            fontSize: 12,
            color: 'var(--gp-text-muted)',
            textAlign: 'center'
          }}
        >
          最后互动时间：{growth.last_interaction_at}
        </div>
      )}
    </div>
  )
}
