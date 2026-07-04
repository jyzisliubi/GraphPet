/**
 * STT 语音识别服务（浏览器原生 Web Speech API）
 *
 * 零依赖、零成本、无需后端：直接调用浏览器的 SpeechRecognition API。
 * Electron 31+ 内核基于 Chromium，原生支持。
 *
 * 工作流程：
 * 1. startListening(onInterim, onFinal) 启动识别
 * 2. 识别过程实时回调 onInterim（中间结果）
 * 3. 识别完成回调 onFinal（最终结果）
 * 4. stopListening() 主动停止
 *
 * 兼容性：Chromium 内核原生支持，lang='zh-CN' 中文识别准确率良好。
 * 麦克风权限：Electron 渲染进程默认有麦克风权限（已在 webPreferences 中开启）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpeechRecognition = any

interface SpeechRecognitionCallbacks {
  /** 中间结果回调（用户还在说话，实时显示） */
  onInterim?: (text: string) => void
  /** 最终结果回调（用户说完一句话） */
  onFinal?: (text: string) => void
  /** 错误回调 */
  onError?: (err: string) => void
  /** 识别结束回调（无论正常结束还是错误） */
  onEnd?: () => void
}

let recognition: AnySpeechRecognition | null = null
let isListening = false

/**
 * 浏览器是否支持 Web Speech API
 */
export function isSTTSupported(): boolean {
  if (typeof window === 'undefined') return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
}

/**
 * 当前是否正在识别
 */
export function getIsListening(): boolean {
  return isListening
}

/**
 * 启动语音识别。
 *
 * @param lang 识别语言，默认 'zh-CN'
 * @param callbacks 回调集合
 * @returns 是否成功启动（不支持或已在监听则返回 false）
 */
export function startListening(
  lang: string = 'zh-CN',
  callbacks: SpeechRecognitionCallbacks = {}
): boolean {
  if (!isSTTSupported()) {
    callbacks.onError?.('当前浏览器不支持语音识别（需要 Chromium 内核）')
    return false
  }
  if (isListening) {
    // 已在监听，先停止再重启
    stopListening()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  const rec = new SR()
  rec.lang = lang
  rec.continuous = true       // 持续识别，直到主动停止
  rec.interimResults = true   // 返回中间结果
  rec.maxAlternatives = 1

  rec.onresult = (event: AnySpeechRecognition): void => {
    let interim = ''
    let final = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      const transcript = result[0]?.transcript ?? ''
      if (result.isFinal) {
        final += transcript
      } else {
        interim += transcript
      }
    }
    if (interim) callbacks.onInterim?.(interim)
    if (final) callbacks.onFinal?.(final.trim())
  }

  rec.onerror = (event: AnySpeechRecognition): void => {
    const err = event.error || 'unknown'
    // 'no-speech' 是常见情况（用户暂停说话），不当作错误
    if (err === 'no-speech' || err === 'aborted') return
    let msg = err
    if (err === 'not-allowed') msg = '麦克风权限被拒绝'
    else if (err === 'network') msg = '网络错误'
    else if (err === 'audio-capture') msg = '麦克风硬件不可用'
    callbacks.onError?.(msg)
  }

  rec.onend = (): void => {
    isListening = false
    callbacks.onEnd?.()
  }

  try {
    rec.start()
    recognition = rec
    isListening = true
    return true
  } catch (err) {
    callbacks.onError?.(`启动识别失败: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/**
 * 停止语音识别。
 */
export function stopListening(): void {
  if (recognition) {
    try {
      recognition.stop()
    } catch {
      /* 已停止或异常，静默 */
    }
    recognition = null
    isListening = false
  }
}
