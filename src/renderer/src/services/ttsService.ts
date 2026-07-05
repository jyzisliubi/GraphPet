/**
 * TTS 语音合成服务（多 provider 后端集成）
 *
 * 支持的 provider：
 * - edge：微软免费 TTS（在线，1-2s 延迟，中文音色丰富）
 * - piper：本地离线 TTS（首启下载模型，零延迟，隐私友好）
 *
 * 调用后端 POST /tts 端点，返回音频流，前端用 Audio API 播放。
 * 默认语音 zh-CN-XiaoyiNeural（晓伊，年轻女声，适合桌宠角色）。
 *
 * 口型同步：播放音频时驱动 Live2D ParamMouthOpenY 参数（在 Live2DCanvas 里订阅）。
 */

const API_BASE = 'http://127.0.0.1:8765'

let currentAudio: HTMLAudioElement | null = null
let mouthAnimFrame: number | null = null
let mouthCallback: ((open: number) => void) | null = null
/** 当前播放的结束回调（speakText 设置，stopSpeaking 触发） */
let currentOnEnded: (() => void) | null = null
/** 模块级单例 AudioContext（避免每次 speakText new 一个，Chromium 限 6 个上限） */
let audioCtxSingleton: AudioContext | null = null
/** 当前音频的 Blob URL（stopSpeaking 时需要 revoke 避免泄漏） */
let currentBlobUrl: string | null = null
/** 当前音频的 MediaElementSource 节点（stopSpeaking 时 disconnect 避免累积） */
let currentSource: MediaElementAudioSourceNode | null = null
/** 当前音频的 AnalyserNode（stopSpeaking 时 disconnect 避免累积） */
let currentAnalyser: AnalyserNode | null = null

/** 获取/创建单例 AudioContext */
function getAudioCtx(): AudioContext {
  if (!audioCtxSingleton) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audioCtxSingleton = new Ctor()
  }
  if (audioCtxSingleton.state === 'suspended') {
    void audioCtxSingleton.resume()
  }
  return audioCtxSingleton
}

/** 设置口型回调（Live2DCanvas 订阅，音频播放时驱动嘴部） */
export function setMouthCallback(cb: ((open: number) => void) | null): void {
  mouthCallback = cb
}

/** 停止当前正在播放的 TTS 音频（同时触发当前 onEnded 回调通知 UI） */
export function stopSpeaking(): void {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
  // 释放 Blob URL（pause 不触发 ended 事件，必须手动 revoke 避免内存泄漏）
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl)
    currentBlobUrl = null
  }
  // 断开音频图节点（避免 MediaElementSource/Analyser 累积，旧节点持有旧 audio 引用阻止 GC）
  if (currentSource) {
    try { currentSource.disconnect() } catch { /* ignore */ }
    currentSource = null
  }
  if (currentAnalyser) {
    try { currentAnalyser.disconnect() } catch { /* ignore */ }
    currentAnalyser = null
  }
  if (mouthAnimFrame) {
    cancelAnimationFrame(mouthAnimFrame)
    mouthAnimFrame = null
  }
  if (mouthCallback) {
    mouthCallback(0)
  }
  // 通知 UI 播放已停止（无论是自然结束还是被中断）
  if (currentOnEnded) {
    const cb = currentOnEnded
    currentOnEnded = null
    try { cb() } catch { /* ignore */ }
  }
}

/** 是否正在播放 TTS 音频 */
export function isSpeaking(): boolean {
  return currentAudio !== null && !currentAudio.paused
}

/**
 * 朗读文本（调用后端 /tts 合成音频并播放，支持多 provider）。
 *
 * @param text 要合成的文本（≤500字符）
 * @param voice 语音角色（edge: ShortName；piper: 模型名）
 * @param onEnded 播放结束/被中断回调（用于 UI 更新播放状态）
 * @param provider TTS provider：'edge'（默认）/ 'piper'
 * @returns 是否成功播放
 */
export async function speakText(
  text: string,
  voice: string = 'zh-CN-XiaoyiNeural',
  onEnded?: () => void,
  provider: 'edge' | 'piper' = 'edge'
): Promise<boolean> {
  if (!text || !text.trim()) return false

  // 停止上一个音频（会触发上一个 onEnded 回调通知旧 UI）
  stopSpeaking()
  // 记录本次 onEnded 回调（用于自然结束/中断时通知 UI）
  currentOnEnded = onEnded ?? null

  try {
    const resp = await fetch(`${API_BASE}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 500), voice, provider }),
    })

    if (!resp.ok) {
      // 后端失败时返回 JSON（content-type: application/json），解析错误信息便于排查
      let errMsg = `HTTP ${resp.status}`
      try {
        const ct = resp.headers.get('content-type') || ''
        if (ct.includes('application/json')) {
          const data = await resp.json()
          if (data?.error) errMsg = data.error
        }
      } catch { /* ignore */ }
      console.error('[TTS] 请求失败:', errMsg)
      currentOnEnded = null
      onEnded?.()
      return false
    }

    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    currentAudio = audio
    currentBlobUrl = url

    // 口型同步：用 AnalyserNode 读取音量驱动嘴部（复用单例 AudioContext 避免 6 个上限泄漏）
    try {
      const audioCtx = getAudioCtx()
      const source = audioCtx.createMediaElementSource(audio)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyser.connect(audioCtx.destination)
      // 保存引用以便 stopSpeaking 时 disconnect
      currentSource = source
      currentAnalyser = analyser

      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const updateMouth = (): void => {
        if (!currentAudio || currentAudio.paused) {
          if (mouthCallback) mouthCallback(0)
          if (mouthAnimFrame) cancelAnimationFrame(mouthAnimFrame)
          mouthAnimFrame = null
          return
        }
        analyser.getByteFrequencyData(dataArray)
        // 计算平均音量（0-255）映射到 0-1
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        const open = Math.min(1, (avg / 128) * 1.5)
        if (mouthCallback) mouthCallback(open)
        mouthAnimFrame = requestAnimationFrame(updateMouth)
      }
      audio.addEventListener('play', () => {
        updateMouth()
      })
    } catch (err) {
      console.warn('[TTS] 口型同步初始化失败（音频仍可播放）:', err)
    }

    audio.addEventListener('ended', () => {
      // stopSpeaking 已包含 URL.revokeObjectURL + disconnect，不重复调用
      stopSpeaking()
    })

    await audio.play()
    return true
  } catch (err) {
    // P1-I 修复：失败时清理已创建的音频图节点/Blob URL，避免 MediaElementSource 持有
    // 旧 audio 引用阻止 GC（原代码只清 currentOnEnded，节点泄漏累积到 AudioContext 6 上限后 TTS 完全失效）
    stopSpeaking()
    console.error('[TTS] 播放失败:', err)
    currentOnEnded = null
    onEnded?.()
    return false
  }
}
