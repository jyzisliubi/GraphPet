import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * VAD（Voice Activity Detection）Hook - 基于音量阈值的简单语音活动检测。
 *
 * 工作原理：
 * 1. 通过麦克风 + AnalyserNode 实时读取音量（RMS）
 * 2. 音量超过阈值且持续 N ms → 触发 onVoiceStart（用于停止 TTS）
 * 3. 音量低于阈值持续 N ms → 触发 onVoiceEnd
 *
 * 用途：用户在 Nito 说话时开口打断 TTS（参考 Open-LLM-VTuber 的语音打断）
 *
 * 兼容性：Chromium 内核原生支持 getUserMedia + AudioContext
 * 权限：Electron 渲染进程默认有麦克风权限（已在 webPreferences 中开启）
 */

interface VADOptions {
  /** 音量阈值（0-1，超过则认为有声音），默认 0.05 */
  threshold?: number
  /** 触发 onVoiceStart 需要持续时长（ms），默认 200 */
  startDebounceMs?: number
  /** 触发 onVoiceEnd 需要静默持续时长（ms），默认 800 */
  endDebounceMs?: number
  /** 用户开始说话回调 */
  onVoiceStart?: () => void
  /** 用户停止说话回调 */
  onVoiceEnd?: () => void
  /** 错误回调 */
  onError?: (err: string) => void
}

interface UseVADResult {
  /** 是否已激活（在监听麦克风） */
  active: boolean
  /** 当前是否检测到用户说话 */
  speaking: boolean
  /** 当前音量（0-1） */
  volume: number
  /** 开始监听 */
  start: () => Promise<void>
  /** 停止监听 */
  stop: () => void
}

export function useVAD(options: VADOptions = {}): UseVADResult {
  const {
    threshold = 0.05,
    startDebounceMs = 200,
    endDebounceMs = 800,
    onVoiceStart,
    onVoiceEnd,
    onError,
  } = options

  const [active, setActive] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [volume, setVolume] = useState(0)

  // 用 ref 持有回调，避免外部内联函数导致 start 依赖变化
  const onVoiceStartRef = useRef(onVoiceStart)
  onVoiceStartRef.current = onVoiceStart
  const onVoiceEndRef = useRef(onVoiceEnd)
  onVoiceEndRef.current = onVoiceEnd
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const speakingRef = useRef(false)
  const startTimerRef = useRef<number | null>(null)
  const endTimerRef = useRef<number | null>(null)
  // 标记组件是否已卸载：getUserMedia 是异步的，await 后需检查避免泄漏麦克风
  const mountedRef = useRef(true)

  const cleanup = useCallback((): void => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current)
      startTimerRef.current = null
    }
    if (endTimerRef.current) {
      clearTimeout(endTimerRef.current)
      endTimerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      try { audioCtxRef.current.close() } catch { /* ignore */ }
    }
    audioCtxRef.current = null
    analyserRef.current = null
    speakingRef.current = false
    setActive(false)
    setSpeaking(false)
    setVolume(0)
  }, [])

  const start = useCallback(async (): Promise<void> => {
    if (active) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      // getUserMedia 是异步的，await 期间组件可能已卸载 → 立即释放麦克风避免泄漏
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream

      const AudioCtxCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const audioCtx = new AudioCtxCtor()
      audioCtxRef.current = audioCtx

      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)
      analyserRef.current = analyser

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const tick = (): void => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(dataArray)
        // 计算 RMS 音量（0-1）
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          const v = dataArray[i] / 255
          sum += v * v
        }
        const rms = Math.sqrt(sum / dataArray.length)
        setVolume(rms)

        // 阈值检测 + 防抖
        if (rms > threshold) {
          // 有声音：清除 end 计时器，启动 start 计时器
          if (endTimerRef.current) {
            clearTimeout(endTimerRef.current)
            endTimerRef.current = null
          }
          if (!speakingRef.current && !startTimerRef.current) {
            startTimerRef.current = window.setTimeout(() => {
              speakingRef.current = true
              setSpeaking(true)
              try { onVoiceStartRef.current?.() } catch { /* ignore */ }
            }, startDebounceMs)
          }
        } else {
          // 静默：清除 start 计时器，启动 end 计时器
          if (startTimerRef.current) {
            clearTimeout(startTimerRef.current)
            startTimerRef.current = null
          }
          if (speakingRef.current && !endTimerRef.current) {
            endTimerRef.current = window.setTimeout(() => {
              speakingRef.current = false
              setSpeaking(false)
              try { onVoiceEndRef.current?.() } catch { /* ignore */ }
            }, endDebounceMs)
          }
        }

        animFrameRef.current = requestAnimationFrame(tick)
      }

      setActive(true)
      tick()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onErrorRef.current?.(msg)
    }
  }, [active, threshold, startDebounceMs, endDebounceMs])

  const stop = useCallback((): void => {
    cleanup()
  }, [cleanup])

  // 卸载时清理
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cleanup()
    }
  }, [cleanup])

  return { active, speaking, volume, start, stop }
}
