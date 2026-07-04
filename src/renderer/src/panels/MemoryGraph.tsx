import { useEffect, useMemo, useRef, useState } from 'react'
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, type Simulation } from 'd3-force'
import { getMemoryGraph } from '../services/memoryService'
import type { Triple } from '../services/memoryService'

// 记忆图谱可视化（v0.3.2 升级版）
//
// 用 d3-force 替换自实现力导向布局：
// - 节点排斥（forceManyBody）
// - 边吸引（forceLink）
// - 中心重力（forceCenter）
// - 节点碰撞检测（forceCollide，避免重叠）
// - 拖拽节点后自动重布局
// - 滚轮缩放 + 拖拽平移
// 依赖：d3-force（~30KB），无 ECharts / react-force-graph 重依赖

/** 图谱样式 */
const GRAPH_CSS = `
.gp-mg-container { display: flex; height: calc(100vh - 120px); min-height: 500px; gap: 16px; }
.gp-mg-canvas-wrap { flex: 1; background: var(--gp-bg-card); border-radius: 12px; border: 1px solid var(--gp-border); overflow: hidden; position: relative; min-width: 0; min-height: 400px; }
.gp-mg-svg { width: 100%; height: 100%; display: block; background: var(--gp-bg-card); cursor: grab; }
.gp-mg-svg:active { cursor: grabbing; }
.gp-mg-node-circle { cursor: pointer; transition: fill 0.15s; }
.gp-mg-node-circle:hover { fill: var(--gp-brand-hover); }
.gp-mg-node-label { font-size: 12px; fill: var(--gp-text); pointer-events: none; user-select: none; font-family: inherit; text-anchor: middle; font-weight: 500; }
.gp-mg-edge { stroke: #52525b; stroke-width: 1.5; fill: none; transition: stroke 0.15s, stroke-width 0.15s; }
.gp-mg-edge--active { stroke: #fbbf24; stroke-width: 2.5; }
.gp-mg-node--active circle { fill: #fbbf24 !important; }
.gp-mg-toolbar { position: absolute; top: 12px; left: 12px; display: flex; gap: 8px; z-index: 2; }
.gp-mg-zoom { position: absolute; bottom: 12px; left: 12px; display: flex; gap: 6px; z-index: 2; align-items: center; background: rgba(10,10,10,0.6); padding: 4px 6px; border-radius: 8px; border: 1px solid var(--gp-border); backdrop-filter: blur(8px); }
.gp-mg-zoom-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 6px; border: 1px solid var(--gp-border); background: var(--gp-bg-card); color: var(--gp-text); font-size: 14px; cursor: pointer; transition: all 0.12s; font-family: inherit; padding: 0; }
.gp-mg-zoom-btn:hover { background: var(--gp-bg-subtle); border-color: var(--gp-bg-hover); }
.gp-mg-zoom-label { font-size: 11px; color: var(--gp-text-secondary); padding: 0 6px; min-width: 40px; text-align: center; }
.gp-mg-info { position: absolute; top: 12px; right: 12px; background: rgba(10,10,10,0.6); padding: 6px 12px; border-radius: 8px; font-size: 12px; color: var(--gp-text-secondary); border: 1px solid var(--gp-border); backdrop-filter: blur(8px); z-index: 2; }
.gp-mg-detail { width: 300px; flex-shrink: 0; background: var(--gp-bg-card); border-radius: 12px; border: 1px solid var(--gp-border); display: flex; flex-direction: column; overflow: hidden; }
.gp-mg-detail-header { padding: 12px 16px; border-bottom: 1px solid var(--gp-border); font-size: 13px; font-weight: 700; color: var(--gp-text); }
.gp-mg-detail-body { flex: 1; overflow-y: auto; padding: 10px 12px; }
.gp-mg-detail-body::-webkit-scrollbar { width: 5px; }
.gp-mg-detail-body::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
.gp-mg-triple-item { padding: 8px 10px; border-radius: 6px; background: var(--gp-bg); font-size: 12px; line-height: 1.5; color: var(--gp-text-secondary); margin-bottom: 6px; border-left: 3px solid var(--gp-border); }
.gp-mg-triple-rel { color: var(--gp-brand); font-weight: 600; margin: 0 4px; }
.gp-mg-detail-empty { padding: 30px 16px; text-align: center; color: var(--gp-text-muted); font-size: 13px; }
.gp-mg-detail-empty-icon { font-size: 32px; display: block; margin-bottom: 8px; opacity: 0.5; }
.gp-mg-search { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 3; }
.gp-mg-search input { background: rgba(10,10,10,0.6); border: 1px solid var(--gp-border); color: var(--gp-text); padding: 6px 12px; border-radius: 8px; font-size: 12px; width: 220px; backdrop-filter: blur(8px); outline: none; font-family: inherit; }
.gp-mg-search input:focus { border-color: var(--gp-brand); }
.gp-mg-search input::placeholder { color: var(--gp-text-muted); }
@media (max-width: 900px) { .gp-mg-detail { display: none; } .gp-mg-search input { width: 140px; } }
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
const MAX_NODES = 80

interface GraphNode {
  id: string
  x: number
  y: number
  degree: number
  vx: number
  vy: number
  fx?: number
  fy?: number
}

interface GraphEdge {
  source: string
  target: string
  relation: string
}

interface ProcessedGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  nodeMap: Map<string, GraphNode>
}

/** 处理三元组数据：构建节点/边，采样超量节点 */
function processGraph(triples: Triple[]): ProcessedGraph {
  const degree = new Map<string, number>()
  for (const t of triples) {
    degree.set(t.head, (degree.get(t.head) ?? 0) + 1)
    degree.set(t.tail, (degree.get(t.tail) ?? 0) + 1)
  }

  const sortedEntities = Array.from(degree.entries()).sort(
    (a, b) => b[1] - a[1]
  )
  const topEntities = new Set(
    sortedEntities.slice(0, MAX_NODES).map((e) => e[0])
  )

  const nodes: GraphNode[] = []
  for (const [id, deg] of sortedEntities.slice(0, MAX_NODES)) {
    nodes.push({
      id,
      x: 0,
      y: 0,
      degree: deg,
      vx: 0,
      vy: 0,
    })
  }

  const edges: GraphEdge[] = []
  for (const t of triples) {
    if (topEntities.has(t.head) && topEntities.has(t.tail)) {
      edges.push({ source: t.head, target: t.tail, relation: t.relation })
    }
  }

  const nodeMap = new Map<string, GraphNode>()
  for (const n of nodes) nodeMap.set(n.id, n)

  return { nodes, edges, nodeMap }
}

export default function MemoryGraph(): JSX.Element {
  const [triples, setTriples] = useState<Triple[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [activeNode, setActiveNode] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [zoom, setZoom] = useState<number>(1)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [, setTick] = useState<number>(0)
  const isPanning = useRef(false)
  const isDraggingNode = useRef<string | null>(null)
  const lastMouse = useRef({ x: 0, y: 0 })
  const simulationRef = useRef<Simulation<GraphNode, GraphEdge> | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    injectGraphStyle()
  }, [])

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

  const graph = useMemo(() => processGraph(triples), [triples])

  // d3-force 布局：仅在图谱数据变化时重新构建 simulation
  useEffect(() => {
    if (graph.nodes.length === 0) return

    const width = 900
    const height = 640

    // 圆形初始化
    const cx = width / 2
    const cy = height / 2
    const radius = Math.min(width, height) / 3
    graph.nodes.forEach((n, i) => {
      const angle = (i / graph.nodes.length) * Math.PI * 2
      const r = radius * (0.5 + Math.random() * 0.5)
      n.x = cx + Math.cos(angle) * r
      n.y = cy + Math.sin(angle) * r
      n.vx = 0
      n.vy = 0
      n.fx = undefined
      n.fy = undefined
    })

    // 构建 d3-force simulation
    const sim = forceSimulation<GraphNode>(graph.nodes)
      .force(
        'link',
        forceLink<GraphNode, GraphEdge>(graph.edges)
          .id((d) => d.id)
          .distance(80)
          .strength(0.6)
      )
      .force('charge', forceManyBody().strength(-180))
      .force('center', forceCenter(cx, cy))
      .force(
        'collide',
        forceCollide<GraphNode>().radius((d) => 12 + Math.min(14, d.degree * 1.5))
      )
      .alpha(1)
      .alphaDecay(0.025)
      .on('tick', () => {
        // 触发 React 重渲染（保持 SVG 与 simulation 同步）
        setTick((t) => (t + 1) % 1_000_000)
      })

    simulationRef.current = sim

    return () => {
      sim.stop()
      simulationRef.current = null
    }
  }, [graph])

  // 当前选中节点的相关三元组
  const activeTriples = useMemo(() => {
    if (!activeNode) return []
    return triples.filter(
      (t) => t.head === activeNode || t.tail === activeNode
    )
  }, [activeNode, triples])

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

  // 搜索匹配节点（高亮）
  const matchedNodes = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>()
    const q = searchQuery.trim().toLowerCase()
    const s = new Set<string>()
    for (const n of graph.nodes) {
      if (n.id.toLowerCase().includes(q)) s.add(n.id)
    }
    return s
  }, [searchQuery, graph.nodes])

  const handleRefresh = (): void => {
    setLoading(true)
    setError(null)
    getMemoryGraph()
      .then((res) => {
        setTriples(res.triples)
        setActiveNode(null)
        setSearchQuery('')
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }

  // SVG 坐标 → 画布坐标（考虑 zoom + pan）
  const toCanvasCoords = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const scaleX = 900 / rect.width
    const scaleY = 640 / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  const handleNodeMouseDown = (id: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    isDraggingNode.current = id
    const node = graph.nodeMap.get(id)
    if (node && simulationRef.current) {
      simulationRef.current.alphaTarget(0.3).restart()
      node.fx = node.x
      node.fy = node.y
    }
    lastMouse.current = toCanvasCoords(e)
  }

  const handleNodeMouseMove = (e: React.MouseEvent): void => {
    if (!isDraggingNode.current) return
    const id = isDraggingNode.current
    const node = graph.nodeMap.get(id)
    if (!node) return
    const cur = toCanvasCoords(e)
    // 反推 zoom/pan 后的真实坐标
    const realX = (cur.x - 450 - pan.x) / zoom + 450
    const realY = (cur.y - 320 - pan.y) / zoom + 320
    node.fx = realX
    node.fy = realY
    lastMouse.current = cur
  }

  const handleNodeMouseUp = (): void => {
    if (isDraggingNode.current && simulationRef.current) {
      simulationRef.current.alphaTarget(0)
      const node = graph.nodeMap.get(isDraggingNode.current)
      if (node) {
        node.fx = undefined
        node.fy = undefined
      }
    }
    isDraggingNode.current = null
  }

  return (
    <div className="gp-mg-container">
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
        {graph.nodes.length > 0 && (
          <div className="gp-mg-search">
            <input
              type="text"
              placeholder="🔍 搜索节点..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}
        <div className="gp-mg-zoom">
          <button type="button" className="gp-mg-zoom-btn" onClick={() => setZoom((z) => Math.max(0.2, z - 0.2))} title="缩小">−</button>
          <span className="gp-mg-zoom-label">{Math.round(zoom * 100)}%</span>
          <button type="button" className="gp-mg-zoom-btn" onClick={() => setZoom((z) => Math.min(3, z + 0.2))} title="放大">+</button>
          <button type="button" className="gp-mg-zoom-btn" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} title="重置视图">⟲</button>
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
              setZoom((z) => Math.max(0.2, Math.min(3, z + delta)))
            }}
            onMouseDown={(e) => {
              if (isDraggingNode.current) return
              isPanning.current = true
              lastMouse.current = { x: e.clientX, y: e.clientY }
            }}
            onMouseMove={(e) => {
              if (isDraggingNode.current) {
                handleNodeMouseMove(e)
                return
              }
              if (isPanning.current) {
                const dx = e.clientX - lastMouse.current.x
                const dy = e.clientY - lastMouse.current.y
                setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
                lastMouse.current = { x: e.clientX, y: e.clientY }
              }
            }}
            onMouseUp={() => {
              isPanning.current = false
              handleNodeMouseUp()
            }}
            onMouseLeave={() => {
              isPanning.current = false
              handleNodeMouseUp()
            }}
          >
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              <rect x="-2000" y="-2000" width="4900" height="4640" fill="transparent" />
              {/* 边 */}
              {graph.edges.map((e, idx) => {
                const sn = graph.nodeMap.get(e.source as unknown as string) || graph.nodeMap.get((e.source as GraphNode).id)
                const tn = graph.nodeMap.get(e.target as unknown as string) || graph.nodeMap.get((e.target as GraphNode).id)
                if (!sn || !tn) return null
                const isActive = activeEdgeSet.has(`${sn.id}||${tn.id}`)
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
              {graph.nodes.map((n) => {
                const isActive = activeNode === n.id
                const isMatched = matchedNodes.has(n.id)
                const isDimmed = searchQuery.trim() && !isMatched
                const r = Math.min(22, Math.max(10, 10 + n.degree * 1.5))
                return (
                  <g
                    key={n.id}
                    className={`gp-mg-node${isActive ? ' gp-mg-node--active' : ''}`}
                    onMouseDown={(e) => handleNodeMouseDown(n.id, e)}
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveNode((prev) => (prev === n.id ? null : n.id))
                    }}
                    opacity={isDimmed ? 0.25 : 1}
                  >
                    <circle
                      className="gp-mg-node-circle"
                      cx={n.x}
                      cy={n.y}
                      r={r}
                      fill={isActive ? '#fbbf24' : isMatched ? '#22d3ee' : '#6366f1'}
                      opacity={0.9}
                      stroke={isMatched ? '#67e8f9' : 'transparent'}
                      strokeWidth={isMatched ? 2 : 0}
                    />
                    <text
                      className="gp-mg-node-label"
                      x={n.x}
                      y={n.y - r - 4}
                    >
                      {n.id.length > 10 ? n.id.slice(0, 10) + '…' : n.id}
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
        )}
      </div>

      <div className="gp-mg-detail">
        <div className="gp-mg-detail-header">
          {activeNode ? `🔗 ${activeNode.length > 18 ? activeNode.slice(0, 18) + '…' : activeNode} 的关系` : '📋 节点详情'}
        </div>
        <div className="gp-mg-detail-body">
          {!activeNode ? (
            <div className="gp-mg-detail-empty">
              <span className="gp-mg-detail-empty-icon">👈</span>
              点击图谱中的节点
              <br />
              查看该实体的所有三元组关系
              <br />
              <br />
              💡 支持：
              <br />
              • 拖拽节点重新布局
              <br />
              • 滚轮缩放 / 拖拽平移
              <br />
              • 搜索框过滤节点
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
