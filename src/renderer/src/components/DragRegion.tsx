import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, MouseEvent, ReactNode } from 'react'

// 拖拽区域组件
// 覆盖在 Live2D 模型上层的透明 div，用于：
// 1. 拖拽移动窗口（mousedown/mousemove/mouseup 计算偏移，IPC 通知主进程 setPosition）
// 2. 在该区域内接收鼠标事件（不穿透），离开区域时由 App 层逻辑切换为穿透
// 3. 接收 OS 文件拖拽并触发喂食（Task 14）：dragover/drop 事件，与窗口拖拽互不冲突
//
// 关键区分：
// - 窗口拖拽：mousedown + mousemove + mouseup（鼠标事件流）
// - 文件拖拽：dragstart + dragover + drop（HTML5 拖拽事件流）
// 两套事件流独立，不会互相干扰。

interface DragRegionProps {
  // 拖拽开始的回调（用于通知父组件临时禁用穿透）
  onDragStart?: () => void
  // 拖拽结束的回调（用于通知父组件恢复穿透检测）
  onDragEnd?: () => void
  // 文件拖拽喂食回调（Task 14）：传入文件的本地绝对路径
  onFeedFile?: (filePath: string, fileSize?: number) => void
  // 鼠标进入回调
  onMouseEnter?: () => void
  // 鼠标离开回调
  onMouseLeave?: () => void
  // 点击宠物回调（短按点击，不是拖拽）
  onPetClick?: (x: number, y: number) => void
  // 子节点（后续 Task 5 可放 Live2D Canvas）
  children?: ReactNode
}

const containerStyle: CSSProperties = {
  position: 'absolute',
  width: '100%',
  height: '100%',
  top: 0,
  left: 0,
  background: 'transparent',
  cursor: 'grab',
  userSelect: 'none'
}

// 文件拖入时的视觉反馈样式（虚线高亮边框）
const dragOverStyle: CSSProperties = {
  outline: '2px dashed #ff9a3c',
  outlineOffset: '-8px',
  borderRadius: '12px',
  boxShadow: 'inset 0 0 24px rgba(255, 154, 60, 0.25)'
}

export default function DragRegion({
  onDragStart,
  onDragEnd,
  onFeedFile,
  onMouseEnter,
  onMouseLeave,
  onPetClick,
  children
}: DragRegionProps): JSX.Element {
  // 拖拽状态：是否正在拖拽窗口
  const [isDragging, setIsDragging] = useState(false)
  // 文件拖入悬停状态（用于显示视觉反馈）
  const [isDragOver, setIsDragOver] = useState(false)

  // 拖拽起点（屏幕坐标，相对窗口左上角）+ 拖拽起点时窗口的屏幕坐标
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; winX: number; winY: number; time: number; clientX: number; clientY: number } | null>(
    null
  )
  // 标记是否真的开始了拖拽（移动超过阈值）
  const hasMovedRef = useRef(false)
  // 容器ref，用于计算点击相对坐标
  const containerRef = useRef<HTMLDivElement | null>(null)
  // 拖拽移动节流：避免每帧都发 IPC，减少主进程 setPosition 压力，缓解卡顿
  const lastMoveTimeRef = useRef(0)
  // 立绘物理：记录最近两次 mousemove 的位置和时间，松手时算速度
  // 参考 Shimeji-ee：拖拽中累积速度，松手后惯性滑行 + 边缘弹性反弹
  const lastMoveRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const prevMoveRef = useRef<{ x: number; y: number; t: number } | null>(null)

  // 全局 mousemove/mouseup 监听需要在 document 上注册，以便鼠标移出组件区域仍能持续拖拽
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: globalThis.MouseEvent): void => {
      const start = dragStartRef.current
      if (!start) return
      const dx = e.screenX - start.mouseX
      const dy = e.screenY - start.mouseY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMovedRef.current = true
      }
      // 只有移动超过阈值才真正拖拽窗口，避免点击时误触发
      if (hasMovedRef.current) {
        const newX = start.winX + dx
        const newY = start.winY + dy
        // 16ms 节流：约 60fps，避免 IPC 洪水导致主进程 setPosition 卡顿
        const now = Date.now()
        if (now - lastMoveTimeRef.current >= 16) {
          lastMoveTimeRef.current = now
          // 记录最近两帧位置用于松手时计算速度
          prevMoveRef.current = lastMoveRef.current
          lastMoveRef.current = { x: newX, y: newY, t: now }
          window.api.windowMove(newX, newY)
        }
      }
    }

    const handleMouseUp = (): void => {
      const start = dragStartRef.current
      const wasClick = !hasMovedRef.current && start && (Date.now() - start.time < 500)
      setIsDragging(false)
      dragStartRef.current = null

      // 立绘物理：松手时基于最近两帧位移计算速度，传给主进程做惯性滑行 + 边缘反弹
      // 只在真正拖拽过（hasMoved）且最近有移动数据时才触发
      if (hasMovedRef.current && lastMoveRef.current && prevMoveRef.current) {
        const dt = lastMoveRef.current.t - prevMoveRef.current.t
        // dt 在 16~32ms 之间是正常的（一帧到两帧），过小或过大都不准
        if (dt > 4 && dt < 100) {
          // 速度 = 位移差 / 时间差 * 16（归一化到一帧 16ms）
          // 阻尼放大系数 1.2 让初速度更明显（用户甩动更有感觉）
          const vx = ((lastMoveRef.current.x - prevMoveRef.current.x) / dt) * 16 * 1.2
          const vy = ((lastMoveRef.current.y - prevMoveRef.current.y) / dt) * 16 * 1.2
          // 速度阈值过滤：太小的速度不触发物理动画（避免抖动）
          if (Math.abs(vx) > 3 || Math.abs(vy) > 3) {
            try { window.api.applyPhysics(vx, vy) } catch { /* ignore */ }
          }
        }
      }
      // 清理移动记录
      lastMoveRef.current = null
      prevMoveRef.current = null

      onDragEnd?.()
      if (wasClick && onPetClick && containerRef.current && start) {
        const rect = containerRef.current.getBoundingClientRect()
        const clickX = start.clientX - rect.left
        const clickY = start.clientY - rect.top
        onPetClick(clickX, clickY)
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, onDragEnd, onPetClick])

  // 鼠标按下：开始拖拽窗口
  const handleMouseDown = (e: MouseEvent<HTMLDivElement>): void => {
    // 仅响应左键
    if (e.button !== 0) return
    hasMovedRef.current = false
    // 记录起点：鼠标屏幕坐标 + 当前窗口屏幕坐标 + 时间 + 客户区坐标
    dragStartRef.current = {
      mouseX: e.screenX,
      mouseY: e.screenY,
      winX: window.screenX,
      winY: window.screenY,
      time: Date.now(),
      clientX: e.clientX,
      clientY: e.clientY
    }
    setIsDragging(true)
    onDragStart?.()
  }

  // 文件拖入悬停：必须 preventDefault 才能触发后续 drop 事件
  // 仅当 dataTransfer.types 含 'Files' 时认为是文件拖拽（排除文本/链接等）
  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
      if (!isDragOver) setIsDragOver(true)
    }
  }

  // 文件拖入离开容器：清除视觉反馈
  // 用 relatedTarget 判断是否真的离开了容器（避免子元素切换导致闪烁）
  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    const related = e.relatedTarget as Node | null
    if (!related || !e.currentTarget.contains(related)) {
      setIsDragOver(false)
    }
  }

  // 文件拖放：取第一个文件的本地路径触发喂食
  // Electron 渲染进程的 File 对象附带 path 属性（本地绝对路径），
  // 但 TS 标准 File 类型没有 path，需要类型断言。
  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (!onFeedFile) return
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return
    const file = files[0]
    // Electron 31+ 推荐用 webUtils.getPathForFile；旧 file.path 在打包版本常失效，
    // 这也是用户反馈“喂东西为不了”的主要原因。
    const filePath = window.api.getPathForFile
      ? window.api.getPathForFile(file)
      : (file as File & { path?: string }).path
    if (filePath) {
      // file.size 用于前端文件大小分流提示（Task 17）
      onFeedFile(filePath, file.size)
    }
  }

  // 拖拽中光标变 grabbing；文件拖入时叠加高亮边框
  const dynamicStyle: CSSProperties = {
    ...containerStyle,
    cursor: isDragging ? 'grabbing' : 'grab',
    ...(isDragOver ? dragOverStyle : null)
  }

  return (
    <div
      ref={containerRef}
      style={dynamicStyle}
      onMouseDown={handleMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
    </div>
  )
}
