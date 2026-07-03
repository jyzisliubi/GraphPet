/**
 * TTS 语音合成服务（edge-tts 后端集成）
 *
 * 调用后端 POST /tts 端点，返回 mp3 音频流，前端用 Audio API 播放。
 * 默认语音 zh-CN-XiaoyiNeural（晓伊，年轻女声，适合桌宠角色）。
 *
 * 口型同步：播放音频时驱动 Live2D ParamMouthOpenY 参数（在 Live2DCanvas 里订阅）。
 */

const API_BASE = 'http://127.0.0.1:8765'

let currentAudio: HTMLAudioElement | null = null
let mouthAnimFrame: number | null = null
let mouthCallback: ((open: number) => void) | null = null

/** 设置口型回调（Live2DCanvas 订阅，音频播放时驱动嘴部） */
export function setMouthCallback(cb: ((open: number) => void) | null): void {
  mouthCallback = cb
}

/** 停止当前正在播放的 TTS 音频 */
export function stopSpeaking(): void {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
  if (mouthAnimFrame) {
    cancelAnimationFrame(mouthAnimFrame)
    mouthAnimFrame = null
  }
  if (mouthCallback) {
    mouthCallback(0)
  }
}

/** 是否正在播放 TTS 音频 */
export function isSpeaking(): boolean {
  return currentAudio !== null && !currentAudio.paused
}

/**
 * 朗读文本（调用后端 /tts 合成 mp3 并播放）。
 *
 * @param text 要合成的文本（≤500字符）
 * @param voice edge-tts 语音角色，默认 zh-CN-XiaoyiNeural
 * @returns 是否成功播放
 */
export async function speakText(
  text: string,
  voice: string = 'zh-CN-XiaoyiNeural'
): Promise<boolean> {
  if (!text || !text.trim()) return false

  // 停止上一个音频
  stopSpeaking()

  try {
    const resp = await fetch(`${API_BASE}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 500), voice }),
    })

    if (!resp.ok) {
      console.error('[TTS] 请求失败:', resp.status)
      return false
    }

    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    currentAudio = audio

    // 口型同步：用 AnalyserNode 读取音量驱动嘴部
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const source = audioCtx.createMediaElementSource(audio)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyser.connect(audioCtx.destination)

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
      stopSpeaking()
      URL.revokeObjectURL(url)
    })

    await audio.play()
    return true
  } catch (err) {
    console.error('[TTS] 播放失败:', err)
    return false
  }
}
