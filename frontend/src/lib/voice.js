// Browser Web Speech API helpers (STT + TTS). Gracefully no-op where unsupported.

export function speechSupported() {
  return typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function ttsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function speak(text, { onEnd } = {}) {
  if (!ttsSupported() || !text) {
    onEnd && onEnd()
    return
  }
  window.speechSynthesis.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.rate = 1.0
  utter.pitch = 1.0
  if (onEnd) utter.onend = onEnd
  window.speechSynthesis.speak(utter)
}

export function stopSpeaking() {
  if (ttsSupported()) window.speechSynthesis.cancel()
}

// Returns a recognizer object: { start, stop }. Calls onResult(finalTranscript)
// and onPartial(interim) as speech is recognized.
export function createRecognizer({ onResult, onPartial, onError, onEnd } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) return null
  const rec = new SR()
  rec.lang = 'en-US'
  rec.continuous = true
  rec.interimResults = true

  let finalText = ''
  rec.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript
      if (event.results[i].isFinal) finalText += transcript + ' '
      else interim += transcript
    }
    if (interim && onPartial) onPartial(interim)
    if (onResult) onResult(finalText.trim())
  }
  rec.onerror = (e) => onError && onError(e.error)
  rec.onend = () => onEnd && onEnd()

  return {
    start: () => {
      finalText = ''
      try {
        rec.start()
      } catch {
        /* already started */
      }
    },
    stop: () => {
      try {
        rec.stop()
      } catch {
        /* not running */
      }
    },
  }
}
