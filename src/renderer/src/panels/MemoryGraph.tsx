import { useEffect, useMemo, useRef, useState } from 'react'
import { getMemoryGraph } from '../services/memoryService'
import type { Triple } from '../services/memoryService'

// 记忆图谱可视化（Task 25）
//
// 用纯 SVG 绘制力导向节点-边图（不引入 ECharts 依赖）：
// - 节点 = 实体，边 = 三元组关系
// - 简化力导向布局：节点间排斥 + 边吸引 + 中心重力，迭代固定次数
// - 点击节点高亮并展示相关三元组
// - 节点数超过上限时按连接度采样，避免性能问题

/** 图谱样式 */
const GRAPH_CSS = `
.gp-mg-container { display: flex; height: calc(100vh - 120px); min-height: 500px; gap: 16px; }
.gp-mg-canvas-wrap { flex: 1; background: var(--gp-bg-card); border-radius: 12px; border: 1px solid var(--gp-border); overflow: hidden; position: relative; min-width: 0; min-height: 400px; }
.gp-mg-svg { width: 100%; height: 100%; display: block; background: var(--gp-bg-card); }
.gp-mg-node-circle { cursor: pointer; transition: fill 0.15s, r 0.15s; }
.gp-mg-node-circle:hover { fill: var(--gp-brand-hover); }
.gp-mg-node-label { font-size: 13px; fill: var(--gp-text); pointer-events: none; user-select: none; font-family: inherit; text-anchor: middle; font-weight: 500; }
.gp-mg-edge { stroke: #52525b; stroke-width: 1.5; fill: none; transition: stroke 0.15s, stroke-width 0.15s; }
.gp-mg-edge--active { stroke: #fbbf24; stroke-width: 2.5; }
.gp-mg-node--active circle { fill: #fbbf24 !important; r: 14; }
.gp-mg-toolbar { position: absolute; top: 12px; left: 12px; display: flex; gap: 8px; z-index: 2; }
.gp-mg-zoom { position: absolute; bottom: 12px; left: 12px; display: flex; gap: 6px; z-index: 2; }
.gp-mg-zoom-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid var(--gp-border); background: var(--gp-bg-card); color: var(--gp-text); font-size: 16px; cursor: pointer; transition: all 0.12s; font-family: inherit; }
.gp-mg-zoom-btn:hover { background: var(--gp-bg-subtle); border-color: var(--gp-bg-hover); }
.gp-mg-zoom-label { font-size: 11px; color: var(--gp-text-muted); display: flex; align-items: center; padding: 0 4px; }
.gp-mg-info { position: absolute; top: 12px; right: 12px; background: rgba(24, 24, 27, 0.9); padding: 6px 12px; border-radius: 8px; font-size: 12px; color: var(--gp-text-secondary); border: 1px solid var(--gp-border); z-index: 2; }
.gp-mg-detail { width: 300px; flex-shrink: 0; background: var(--gp-bg-card); border-radius: 12px; border: 1px solid var(--gp-border); display: flex; flex-direction: column; overflow: hidden; }
.gp-mg-detail-header { padding: 12px 16px; border-bottom: 1px solid var(--gp-border); font-size: 13px; font-weight: 700; color: var(--gp-text); }
.gp-mg-detail-body { flex: 1; overflow-y: auto; padding: 10px 12px; }
.gp-mg-detail-body::-webkit-scrollbar { width: 5px; }
.gp-mg-detail-body::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
.gp-mg-triple-item { padding: 8px 10px; border-radius: 6px; background: var(--gp-bg); font-size: 12px; line-height: 1.5; color: var(--gp-text-secondary); margin-bottom: 6px; border-left: 3px solid var(--gp-border); }
.gp-mg-triple-rel { color: var(--gp-brand); font-weight: 600; margin: 0 4px; }
.gp-mg-detail-empty { padding: 30px 16px; text-align: center; color: var(--gp-text-muted); font-size: 13px; }
.gp-mg-detail-empty-icon { font-size: 32px; display: block; margin-bottom: 8px; opacity: 0.5; }
@media (max-width: 900px) { .gp-mg-detail { display: none; } }
`

let mgStyleInjected = false

function injectGraphStyle(): void {
  if (mgStyleInjected) return
  if (typeof document === 'undefined') return
  const el = document.createElement('style')
  el.textContent = GRAPH_CSS
  document.head.appendChild(el)
  mgStyleInjected = true
}

/** 节点最大数量（超过按连接度采样） */
const MAX_NODES = 60

interface SimNode {
  id: string
  x: number
  y: number
  degree: number
}

interface SimEdge {
  source: string
  target: string
  relation: string
}

/**
 * 简化力导向布局：迭代计算节点位置。
 * - 节点间排斥（库仑力简化）
 * - 边吸引（胡克定律简化）
 * - 中心重力
 */
function forceLayout(
  nodes: SimNode[],
  edges: SimEdge[],
  width: number,
  height: number,
  iterations: number = 300
): void {
  if (nodes.length === 0) return
  const cx = width / 2
  const cy = height / 2
  const kRep = 6000 // 排斥力系数
  const kAttr = 0.04 // 吸引力系数
  const kGrav = 0.008 // 中心重力系数
  const damping = 0.85

  const fx = new Map<string, number>()
  const fy = new Map<string, number>()
  // 节点 id -> 节点引用 的映射，加速边遍历时的查找（避免 O(N) find）
  const nodeById = new Map<string, SimNode>()
  for (const n of nodes) nodeById.set(n.id, n)

  for (let iter = 0; iter < iterations; iter++) {
    // 初始化力
    for (const n of nodes) {
      fx.set(n.id, 0)
      fy.set(n.id, 0)
    }

    // 排斥力（O(N^2)）
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x
        const dy = nodes[i].y - nodes[j].y
        let dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 1) dist = 1
        const force = kRep / (dist * dist)
        const fxv = (dx / dist) * force
        const fyv = (dy / dist) * force
        fx.set(nodes[i].id, fx.get(nodes[i].id)! + fxv)
        fy.set(nodes[i].id, fy.get(nodes[i].id)! + fyv)
        fx.set(nodes[j].id, fx.get(nodes[j].id)! - fxv)
        fy.set(nodes[j].id, fy.get(nodes[j].id)! - fyv)
      }
    }

    // 吸引力（沿边）
    for (const e of edges) {
      const sn = nodeById.get(e.source)
      const tn = nodeById.get(e.target)
      if (!sn || !tn) continue
      const dx = tn.x - sn.x
      const dy = tn.y - sn.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const force = kAttr * dist
      const fxv = (dx / dist) * force
      const fyv = (dy / dist) * force
      fx.set(sn.id, fx.get(sn.id)! + fxv)
      fy.set(sn.id, fy.get(sn.id)! + fyv)
      fx.set(tn.id, fx.get(tn.id)! - fxv)
      fy.set(tn.id, fy.get(tn.id)! - fyv)
    }

    // 中心重力 + 应用位移
    for (const n of nodes) {
      const gfx = (cx - n.x) * kGrav
      const gfy = (cy - n.y) * kGrav
      n.x += (fx.get(n.id)! + gfx) * damping
      n.y += (fy.get(n.id)! + gfy) * damping
      // 边界约束
      const margin = 30
      n.x = Math.max(margin, Math.min(width - margin, n.x))
      n.y = Math.max(margin, Math.min(height - margin, n.y))
    }
  }
}

interface ProcessedGraph {
  nodes: SimNode[]
  edges: SimEdge[]
  nodeMap: Map<string, SimNode>
}

/** 处理三元组数据：构建节点/边，采样超量节点 */
function processGraph(triples: Triple[]): ProcessedGraph {
  // 统计每个实体的连接度
  const degree = new Map<string, number>()
  for (const t of triples) {
    degree.set(t.head, (degree.get(t.head) ?? 0) + 1)
    degree.set(t.tail, (degree.get(t.tail) ?? 0) + 1)
  }

  // 按连接度排序，取前 MAX_NODES 个实体作为节点
  const sortedEntities = Array.from(degree.entries()).sort(
    (a, b) => b[1] - a[1]
  )
  const topEntities = new Set(
    sortedEntities.slice(0, MAX_NODES).map((e) => e[0])
  )

  // 构建节点
  const nodes: SimNode[] = []
  for (const [id, deg] of sortedEntities.slice(0, MAX_NODES)) {
    nodes.push({
      id,
      x: 0,
      y: 0,
      degree: deg
    })
  }

  // 构建边（仅保留两端都在 topEntities 中的三元组）
  const edges: SimEdge[] = []
  for (const t of triples) {
    if (topEntities.has(t.head) && topEntities.has(t.tail)) {
      edges.push({ source: t.head, target: t.tail, relation: t.relation })
    }
  }

  const nodeMap = new Map<string, SimNode>()
  for (const n of nodes) nodeMap.set(n.id, n)

  return { nodes, edges, nodeMap }
}

export default function MemoryGraph(): JSX.Element {
  const [triples, setTriples] = useState<Triple[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [activeNode, setActiveNode] = useState<string | null>(null)
  // 缩放平移状态
  const [zoom, setZoom] = useState<number>(1)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })

  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    injectGraphStyle()
  }, [])

  // 加载三元组数据
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getMemoryGraph()
      .then((res) => {
        if (!cancelled) {
          setTriples(res.triples)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 处理图谱数据
  const graph = useMemo(() => processGraph(triples), [triples])

  // 计算力导向布局（仅在数据变化时计算一次）
  const layoutNodes = useMemo(() => {
    if (graph.nodes.length === 0) return []
    // 用固定画布尺寸计算布局
    const width = 900
    const height = 640
    // 随机初始化位置（圆形分布）
    const cx = width / 2
    const cy = height / 2
    const radius = Math.min(width, height) / 3
    for (let i = 0; i < graph.nodes.length; i++) {
      const angle = (i / graph.nodes.length) * Math.PI * 2
      const r = radius * (0.5 + Math.random() * 0.5)
      graph.nodes[i].x = cx + Math.cos(angle) * r
      graph.nodes[i].y = cy + Math.sin(angle) * r
    }
    forceLayout(graph.nodes, graph.edges, width, height, 300)
    return graph.nodes
  }, [graph])

  // 当前选中节点的相关三元组
  const activeTriples = useMemo(() => {
    if (!activeNode) return []
    return triples.filter(
      (t) => t.head === activeNode || t.tail === activeNode
    )
  }, [activeNode, triples])

  // 活跃边集合（与选中节点相连的边）
  const activeEdgeSet = useMemo(() => {
    if (!activeNode) return new Set<string>()
    const s = new Set<string>()
    for (const e of graph.edges) {
      if (e.source === activeNode || e.target === activeNode) {
        s.add(`${e.source}||${e.target}`)
      }
    }
    return s
  }, [activeNode, graph.edges])

  const handleRefresh = (): void => {
    setLoading(true)
    setError(null)
    getMemoryGraph()
      .then((res) => {
        setTriples(res.triples)
        setActiveNode(null)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }

  return (
    <div className="gp-mg-container">
      {/* 图谱画布 */}
      <div className="gp-mg-canvas-wrap">
        <div className="gp-mg-toolbar">
          <button
            type="button"
            className="gp-btn gp-btn--primary"
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading ? '加载中...' : '🔄 刷新'}
          </button>
        </div>
        {/* 缩放控制 */}
        <div className="gp-mg-zoom">
          <button type="button" className="gp-mg-zoom-btn" onClick={() => setZoom(z => Math.max(0.2, z - 0.2))}>−</button>
          <span className="gp-mg-zoom-label">{Math.round(zoom * 100)}%</span>
          <button type="button" className="gp-mg-zoom-btn" onClick={() => setZoom(z => Math.min(3, z + 0.2))}>+</button>
          <button type="button" className="gp-mg-zoom-btn" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} title="重置">⟲</button>
        </div>
        <div className="gp-mg-info">
          {graph.nodes.length} 节点 · {graph.edges.length} 边
          {triples.length > graph.edges.length && (
            <span>（共 {triples.length} 三元组，已采样）</span>
          )}
        </div>

        {error ? (
          <div className="gp-error" style={{ margin: 20 }}>
            ❌ {error}
          </div>
        ) : loading ? (
          <div className="gp-loading">🔄 正在加载知识图谱...</div>
        ) : graph.nodes.length === 0 ? (
          <div className="gp-empty">
            <span className="gp-empty-icon">🕸️</span>
            知识图谱为空
            <br />
            先喂 Nito 一些文件，建立知识图谱后再来查看吧～
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="gp-mg-svg"
            viewBox="0 0 900 640"
            preserveAspectRatio="xMidYMid meet"
            onWheel={(e) => {
              e.preventDefault()
              const delta = e.deltaY > 0 ? -0.1 : 0.1
              setZoom(z => Math.max(0.2, Math.min(3, z + delta)))
            }}
            onMouseDown={() => {}}
            onMouseMove={(e) => {
              if (isPanning.current) {
                const dx = e.clientX - lastMouse.current.x
                const dy = e.clientY - lastMouse.current.y
                setPan(p => ({ x: p.x + dx / zoom, y: p.y + dy / zoom }))
                lastMouse.current = { x: e.clientX, y: e.clientY }
              }
            }}
            onMouseUp={() => { isPanning.current = false }}
            onMouseLeave={() => { isPanning.current = false }}
          >
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* 背景矩形，用于捕获空白区域点击启动拖拽 */}
            <rect x="-500" y="-500" width="1900" height="1640" fill="transparent" style={{ cursor: isPanning.current ? 'grabbing' : 'grab' }}
              onMouseDown={(e) => { isPanning.current = true; lastMouse.current = { x: e.clientX, y: e.clientY }; e.stopPropagation() }}
            />
            {/* 边 */}
            {graph.edges.map((e, idx) => {
              const sn = graph.nodeMap.get(e.source)
              const tn = graph.nodeMap.get(e.target)
              if (!sn || !tn) return null
              const isActive = activeEdgeSet.has(`${e.source}||${e.target}`)
              return (
                <line
                  key={`e-${idx}`}
                  className={`gp-mg-edge${isActive ? ' gp-mg-edge--active' : ''}`}
                  x1={sn.x}
                  y1={sn.y}
                  x2={tn.x}
                  y2={tn.y}
                />
              )
            })}
            {/* 节点 */}
            {layoutNodes.map((n) => {
              const isActive = activeNode === n.id
              const r = Math.min(22, Math.max(10, 10 + n.degree * 1.5))
              return (
                <g
                  key={n.id}
                  className={`gp-mg-node${isActive ? ' gp-mg-node--active' : ''}`}
                  onClick={() =>
                    setActiveNode((prev) => (prev === n.id ? null : n.id))
                  }
                >
                  <circle
                    className="gp-mg-node-circle"
                    cx={n.x}
                    cy={n.y}
                    r={r}
                    fill={isActive ? '#fbbf24' : '#6366f1'}
                    opacity={0.85}
                  />
                  <text
                    className="gp-mg-node-label"
                    x={n.x}
                    y={n.y - r - 4}
                  >
                    {n.id.length > 8 ? n.id.slice(0, 8) + '…' : n.id}
                  </text>
                </g>
              )
            })}
            </g>
          </svg>
        )}
      </div>

      {/* 右侧详情面板 */}
      <div className="gp-mg-detail">
        <div className="gp-mg-detail-header">
          {activeNode ? `🔗 ${activeNode} 的关系` : '📋 节点详情'}
        </div>
        <div className="gp-mg-detail-body">
          {!activeNode ? (
            <div className="gp-mg-detail-empty">
              <span className="gp-mg-detail-empty-icon">👈</span>
              点击图谱中的节点
              <br />
              查看该实体的所有三元组关系
            </div>
          ) : activeTriples.length === 0 ? (
            <div className="gp-mg-detail-empty">暂无关系数据</div>
          ) : (
            activeTriples.map((t, idx) => (
              <div key={`t-${idx}`} className="gp-mg-triple-item">
                {t.head}
                <span className="gp-mg-triple-rel">—{t.relation}→</span>
                {t.tail}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
