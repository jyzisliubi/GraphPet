let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  try {
    if (!audioContext) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audioContext = new AC()
    }
    if (audioContext.state === 'suspended') {
      void audioContext.resume()
    }
    return audioContext
  } catch {
    return null
  }
}

function playTone(frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.15): void {
  const ctx = getAudioContext()
  if (!ctx) return

  try {
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)

    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime)

    gainNode.gain.setValueAtTime(0, ctx.currentTime)
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.02)
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + duration)
  } catch {
    // 音效失败静默处理
  }
}

export function playClickSound(): void {
  playTone(880, 0.08, 'sine', 0.08)
}

export function playFeedStartSound(): void {
  playTone(660, 0.1, 'sine', 0.1)
  setTimeout(() => playTone(880, 0.15, 'sine', 0.08), 80)
}

export function playFeedSuccessSound(): void {
  playTone(523, 0.1, 'sine', 0.1)
  setTimeout(() => playTone(659, 0.1, 'sine', 0.08), 100)
  setTimeout(() => playTone(784, 0.2, 'sine', 0.06), 200)
}

export function playMessageSound(): void {
  playTone(587, 0.12, 'sine', 0.08)
}

export function playErrorSound(): void {
  playTone(200, 0.2, 'square', 0.06)
}

export function playPopupSound(): void {
  playTone(523, 0.08, 'sine', 0.07)
  setTimeout(() => playTone(784, 0.12, 'sine', 0.05), 60)
}
