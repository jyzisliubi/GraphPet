import { useEffect, useState } from 'react'
import { getMemoryFiles } from '../services/memoryService'
import type { FedFile } from '../services/memoryService'
import { getGrowthSummary } from '../services/feedService'
import type { GrowthSummary } from '../services/feedService'

// 时间线面板（Task 26）
//
// 按时间倒序展示喂食历史（文件名 + 时间 + 实体数），
// 顶部汇总统计卡片（总文件数 / 总实体数 / 互动次数）。

/** 时间线样式 */
const TIMELINE_CSS = `
.gp-tl-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 14px; margin-bottom: 20px; }
.gp-tl-list { background: var(--gp-bg-card); border-radius: 12px; border: 1px solid var(--gp-border); overflow: hidden; }
.gp-tl-item { display: flex; align-items: center; gap: 16px; padding: 14px 20px; border-bottom: 1px solid var(--gp-border); transition: background 0.15s; }
.gp-tl-item:last-child { border-bottom: none; }
.gp-tl-item:hover { background: var(--gp-bg-subtle); }
.gp-tl-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--gp-brand); flex-shrink: 0; box-shadow: 0 0 0 4px rgba(99,102,241,0.2); }
.gp-tl-dot--empty { background: #fbbf24; box-shadow: 0 0 0 4px rgba(251,191,36,0.2); }
.gp-tl-dot--fail { background: #f87171; box-shadow: 0 0 0 4px rgba(248,113,113,0.2); }
.gp-tl-time { font-size: 12px; color: var(--gp-text-muted); width: 160px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.gp-tl-name { flex: 1; font-size: 14px; color: var(--gp-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gp-tl-count { font-size: 13px; color: var(--gp-brand); font-weight: 600; flex-shrink: 0; }
.gp-tl-count--zero { color: var(--gp-text-muted); font-weight: 400; }
`

let tlStyleInjected = false

function injectTimelineStyle(): void {
  if (tlStyleInjected) return
  if (typeof document === 'undefined') return
  const el = document.createElement('style')
  el.textContent = TIMELINE_CSS
  document.head.appendChild(el)
  tlStyleInjected = true
}

/** 格式化 ISO 时间为可读字符串 */
function formatTime(iso: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

export default function Timeline(): JSX.Element {
  const [files, setFiles] = useState<FedFile[]>([])
  const [growth, setGrowth] = useState<GrowthSummary | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    injectTimelineStyle()
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([getMemoryFiles(), getGrowthSummary()])
      .then(([fileRes, growthRes]) => {
        if (cancelled) return
        setFiles(fileRes.files)
        setGrowth(growthRes)
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

  // 按时间倒序排列
  const sortedFiles = [...files].sort((a, b) => {
    return (b.fed_at || '').localeCompare(a.fed_at || '')
  })

  const totalEntities = files.reduce((sum, f) => sum + (f.entity_count || 0), 0)

  return (
    <div>
      {/* 统计卡片 */}
      <div className="gp-tl-stats">
        <div className="gp-stat-card">
          <div className="gp-stat-label">已吃文件</div>
          <div className="gp-stat-value">
            {files.length}
            <span className="gp-stat-unit">个</span>
          </div>
        </div>
        <div className="gp-stat-card">
          <div className="gp-stat-label">累计实体</div>
          <div className="gp-stat-value">
            {totalEntities}
            <span className="gp-stat-unit">个</span>
          </div>
        </div>
        <div className="gp-stat-card">
          <div className="gp-stat-label">总互动次数</div>
          <div className="gp-stat-value">
            {growth?.total_interactions ?? '—'}
            <span className="gp-stat-unit">次</span>
          </div>
        </div>
        <div className="gp-stat-card">
          <div className="gp-stat-label">智力等级</div>
          <div className="gp-stat-value" style={{ fontSize: 20 }}>
            {growth?.intelligence_level ?? '—'}
          </div>
        </div>
      </div>

      {/* 时间线列表 */}
      <div className="gp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gp-border)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--gp-text)' }}>
            📅 喂食时间线
          </span>
          <span style={{ fontSize: 12, color: 'var(--gp-text-muted)', marginLeft: 8 }}>
            （按时间倒序）
          </span>
        </div>

        {error ? (
          <div className="gp-error" style={{ margin: 20 }}>
            ❌ {error}
          </div>
        ) : loading ? (
          <div className="gp-loading">🔄 正在加载时间线...</div>
        ) : sortedFiles.length === 0 ? (
          <div className="gp-empty">
            <span className="gp-empty-icon">📅</span>
            还没有喂食记录
            <br />
            右键桌宠选择"喂文件"开始建立记忆吧～
          </div>
        ) : (
          <div className="gp-tl-list">
            {sortedFiles.map((f, idx) => {
              const isEmpty = f.entity_count === 0
              return (
                <div key={`${f.fingerprint}-${idx}`} className="gp-tl-item">
                  <span
                    className={`gp-tl-dot${isEmpty ? ' gp-tl-dot--empty' : ''}`}
                  />
                  <span className="gp-tl-time">{formatTime(f.fed_at)}</span>
                  <span className="gp-tl-name" title={f.name}>
                    {f.name}
                  </span>
                  <span
                    className={`gp-tl-count${isEmpty ? ' gp-tl-count--zero' : ''}`}
                  >
                    {isEmpty ? '无实体' : `${f.entity_count} 实体`}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
