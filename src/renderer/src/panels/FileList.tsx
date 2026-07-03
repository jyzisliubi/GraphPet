import { Fragment, useEffect, useState } from 'react'
import {
  getMemoryFiles,
  deleteMemoryFile,
  exportMemory,
  getFileTriples
} from '../services/memoryService'
import type { FedFile, Triple } from '../services/memoryService'

// 文件清单面板（Task 26）
//
// 展示已吃文件列表（文件名 / 吃下时间 / 实体数），
// 支持单文件删除（DELETE /memory/file/{fingerprint}）与导出记忆为 JSON。

/** 文件清单样式 */
const FILELIST_CSS = `
.gp-fl-toolbar { display: flex; gap: 10px; margin-bottom: 16px; align-items: center; }
.gp-fl-toolbar-text { font-size: 13px; color: var(--gp-text-secondary); flex: 1; }
.gp-fl-table { background: var(--gp-bg-card); border-radius: 12px; border: 1px solid var(--gp-border); overflow: hidden; }
.gp-fl-row { display: flex; align-items: center; gap: 12px; padding: 12px 18px; border-bottom: 1px solid var(--gp-border); transition: background 0.15s; }
.gp-fl-row:last-child { border-bottom: none; }
.gp-fl-row:hover { background: var(--gp-bg-subtle); }
.gp-fl-row--header { background: var(--gp-bg-subtle); font-size: 12px; font-weight: 700; color: var(--gp-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.gp-fl-row--clickable { cursor: pointer; }
.gp-fl-name { flex: 1; font-size: 14px; color: var(--gp-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gp-fl-time { font-size: 12px; color: var(--gp-text-muted); width: 150px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.gp-fl-count { font-size: 13px; color: var(--gp-brand); font-weight: 600; width: 65px; flex-shrink: 0; text-align: right; }
.gp-fl-tcount { font-size: 13px; color: #10b981; font-weight: 600; width: 65px; flex-shrink: 0; text-align: right; }
.gp-fl-actions { width: 80px; flex-shrink: 0; display: flex; justify-content: flex-end; gap: 6px; }
.gp-fl-delete { padding: 4px 10px; font-size: 12px; border-radius: 6px; border: 1px solid rgba(248,113,113,0.3); background: var(--gp-bg-card); color: #f87171; cursor: pointer; transition: all 0.15s; font-family: inherit; }
.gp-fl-delete:hover { background: rgba(248,113,113,0.1); border-color: rgba(248,113,113,0.5); }
.gp-fl-delete:disabled { opacity: 0.5; cursor: not-allowed; }
.gp-fl-expand-btn { padding: 4px 8px; font-size: 12px; border-radius: 6px; border: 1px solid var(--gp-border); background: var(--gp-bg-card); color: var(--gp-text-secondary); cursor: pointer; transition: all 0.15s; font-family: inherit; }
.gp-fl-expand-btn:hover { background: var(--gp-bg-subtle); border-color: var(--gp-bg-hover); }
.gp-fl-detail { background: var(--gp-bg); border-bottom: 1px solid var(--gp-border); padding: 12px 18px; }
.gp-fl-detail-title { font-size: 12px; color: var(--gp-text-secondary); margin-bottom: 8px; font-weight: 600; }
.gp-fl-triples { max-height: 280px; overflow-y: auto; border: 1px solid var(--gp-border); border-radius: 8px; background: var(--gp-bg-card); }
.gp-fl-triple { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--gp-border); font-size: 13px; line-height: 1.5; }
.gp-fl-triple:last-child { border-bottom: none; }
.gp-fl-triple-head { color: var(--gp-text); font-weight: 600; }
.gp-fl-triple-rel { color: var(--gp-brand); background: rgba(99,102,241,0.15); padding: 1px 8px; border-radius: 10px; font-size: 12px; white-space: nowrap; }
.gp-fl-triple-tail { color: var(--gp-text-secondary); }
.gp-fl-triples-empty { padding: 16px; text-align: center; color: var(--gp-text-muted); font-size: 13px; }
.gp-fl-triples-loading { padding: 16px; text-align: center; color: var(--gp-text-secondary); font-size: 13px; }
.gp-fl-triples-foot { font-size: 11px; color: var(--gp-text-muted); margin-top: 6px; text-align: right; }
`

let flStyleInjected = false

function injectFileListStyle(): void {
  if (flStyleInjected) return
  if (typeof document === 'undefined') return
  const el = document.createElement('style')
  el.textContent = FILELIST_CSS
  document.head.appendChild(el)
  flStyleInjected = true
}

/** 格式化 ISO 时间 */
function formatTime(iso: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

export default function FileList(): JSX.Element {
  const [files, setFiles] = useState<FedFile[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingFp, setDeletingFp] = useState<string | null>(null)
  const [exporting, setExporting] = useState<boolean>(false)
  const [toast, setToast] = useState<string | null>(null)
  // 展开查看三元组
  const [expandedFp, setExpandedFp] = useState<string | null>(null)
  const [triplesCache, setTriplesCache] = useState<Record<string, Triple[]>>({})
  const [loadingTriplesFp, setLoadingTriplesFp] = useState<string | null>(null)

  useEffect(() => {
    injectFileListStyle()
  }, [])

  const loadFiles = (): void => {
    setLoading(true)
    setError(null)
    getMemoryFiles()
      .then((res) => {
        setFiles(res.files)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }

  useEffect(() => {
    loadFiles()
  }, [])

  // 自动消失的提示
  const showToast = (msg: string): void => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // 点击行展开/收起，加载该文件的三元组
  const toggleExpand = async (file: FedFile): Promise<void> => {
    const fp = file.fingerprint
    if (expandedFp === fp) {
      setExpandedFp(null)
      return
    }
    setExpandedFp(fp)
    if (triplesCache[fp]) return // 已缓存
    setLoadingTriplesFp(fp)
    try {
      const res = await getFileTriples(fp)
      setTriplesCache((prev) => ({ ...prev, [fp]: res.triples }))
    } catch (err) {
      showToast(
        `✗ 加载三元组失败：${err instanceof Error ? err.message : String(err)}`
      )
      setTriplesCache((prev) => ({ ...prev, [fp]: [] }))
    } finally {
      setLoadingTriplesFp(null)
    }
  }

  // 删除单个文件记忆
  const handleDelete = async (file: FedFile): Promise<void> => {
    if (!window.confirm(`确定要吐掉「${file.name}」的记忆吗？此操作不可撤销。`)) {
      return
    }
    setDeletingFp(file.fingerprint)
    try {
      const res = await deleteMemoryFile(file.fingerprint)
      if (res.success) {
        showToast(`✓ ${res.message}`)
        // 清理缓存并收起
        setTriplesCache((prev) => {
          const next = { ...prev }
          delete next[file.fingerprint]
          return next
        })
        if (expandedFp === file.fingerprint) setExpandedFp(null)
        loadFiles()
      } else {
        showToast(`✗ ${res.message}`)
      }
    } catch (err) {
      showToast(`✗ 删除失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDeletingFp(null)
    }
  }

  // 导出记忆为 JSON 文件下载
  const handleExport = async (): Promise<void> => {
    setExporting(true)
    try {
      const data = await exportMemory()
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json'
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const now = new Date()
      const pad = (n: number): string => String(n).padStart(2, '0')
      a.download = `graphpet_memory_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast('✓ 记忆已导出')
    } catch (err) {
      showToast(`✗ 导出失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      {/* 工具栏 */}
      <div className="gp-fl-toolbar">
        <span className="gp-fl-toolbar-text">
          📁 已吃文件清单（{files.length} 个）
        </span>
        <button
          type="button"
          className="gp-btn"
          onClick={loadFiles}
          disabled={loading}
        >
          {loading ? '加载中...' : '🔄 刷新'}
        </button>
        <button
          type="button"
          className="gp-btn gp-btn--primary"
          onClick={handleExport}
          disabled={exporting || files.length === 0}
        >
          {exporting ? '导出中...' : '⬇ 导出记忆'}
        </button>
      </div>

      {/* 提示 */}
      {toast && (
        <div
          style={{
            padding: '8px 16px',
            marginBottom: 12,
            background: 'rgba(34, 197, 94, 0.1)',
            color: '#4ade80',
            fontSize: 13,
            borderRadius: 8,
            border: '1px solid rgba(34, 197, 94, 0.3)'
          }}
        >
          {toast}
        </div>
      )}

      {/* 文件表格 */}
      <div className="gp-fl-table">
        {/* 表头 */}
        <div className="gp-fl-row gp-fl-row--header">
          <span className="gp-fl-name">文件名</span>
          <span className="gp-fl-time">吃下时间</span>
          <span className="gp-fl-count">实体数</span>
          <span className="gp-fl-tcount">三元组</span>
          <span className="gp-fl-actions">操作</span>
        </div>

        {error ? (
          <div className="gp-error" style={{ margin: 20 }}>
            ❌ {error}
          </div>
        ) : loading ? (
          <div className="gp-loading">🔄 正在加载文件列表...</div>
        ) : files.length === 0 ? (
          <div className="gp-empty">
            <span className="gp-empty-icon">📁</span>
            还没有吃过的文件
            <br />
            右键桌宠选择"喂文件"开始喂养吧～
          </div>
        ) : (
          files.map((f, idx) => (
            <Fragment key={`${f.fingerprint}-${idx}`}>
              <div
                className="gp-fl-row gp-fl-row--clickable"
                onClick={() => toggleExpand(f)}
              >
                <span className="gp-fl-name" title={f.name}>
                  <span style={{ marginRight: 6, color: 'var(--gp-text-muted)' }}>
                    {expandedFp === f.fingerprint ? '▼' : '▶'}
                  </span>
                  {f.name}
                </span>
                <span className="gp-fl-time">{formatTime(f.fed_at)}</span>
                <span className="gp-fl-count">
                  {f.entity_count > 0 ? f.entity_count : '—'}
                </span>
                <span className="gp-fl-tcount">
                  {f.triples_count != null && f.triples_count > 0 ? f.triples_count : '—'}
                </span>
                <span className="gp-fl-actions">
                  <button
                    type="button"
                    className="gp-fl-delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(f)
                    }}
                    disabled={deletingFp === f.fingerprint}
                  >
                    {deletingFp === f.fingerprint ? '...' : '吐掉'}
                  </button>
                </span>
              </div>
              {expandedFp === f.fingerprint && (
                <div className="gp-fl-detail">
                  <div className="gp-fl-detail-title">📋 抽取的三元组</div>
                  {loadingTriplesFp === f.fingerprint ? (
                    <div className="gp-fl-triples-loading">
                      🔄 正在加载三元组...
                    </div>
                  ) : (triplesCache[f.fingerprint]?.length ?? 0) > 0 ? (
                    <>
                      <div className="gp-fl-triples">
                        {(triplesCache[f.fingerprint] ?? [])
                          .slice(0, 100)
                          .map((t, i) => (
                            <div key={i} className="gp-fl-triple">
                              <span className="gp-fl-triple-head">{t.head}</span>
                              <span className="gp-fl-triple-rel">
                                {t.relation}
                              </span>
                              <span className="gp-fl-triple-tail">{t.tail}</span>
                            </div>
                          ))}
                      </div>
                      <div className="gp-fl-triples-foot">
                        共 {triplesCache[f.fingerprint]?.length ?? 0} 条
                        {((triplesCache[f.fingerprint]?.length ?? 0) > 100)
                          ? '，仅显示前 100 条'
                          : ''}
                      </div>
                    </>
                  ) : (
                    <div className="gp-fl-triples-empty">
                      该文件未存储三元组（可能是旧版本喂食的文件，或抽取时未抽到三元组）
                    </div>
                  )}
                </div>
              )}
            </Fragment>
          ))
        )}
      </div>
    </div>
  )
}
