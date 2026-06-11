// Shared proctoring engine for the exam and interview pages.
//
// Watches the browser environment (tab switches, fullscreen, copy/paste,
// devtools shortcuts, extra monitors), the webcam (face presence via the
// FaceDetector API where available + periodic snapshots for admin review),
// and optionally the microphone (sustained speech during a written exam).
// Raw events are POSTed to the backend, which owns the scoring; when the
// server says "terminated", everything tears down and onTerminated fires.
//
// Not detectable from a browser (documented, not faked): remote-desktop tools
// (AnyDesk/TeamViewer), VMs, OS-level screen recording, true VPN detection.
// The server logs mid-stage IP changes as a network-identity signal instead.
import { useCallback, useEffect, useRef, useState } from 'react'
import { proctorEvent, proctorSnapshot } from './api.js'

const FACE_CHECK_MS = 5000
const SNAPSHOT_MS = 20000
const REPORT_COOLDOWN_MS = 15000   // per event type, for repeating detectors
const AUDIO_RMS_THRESHOLD = 0.045
const AUDIO_SUSTAIN_MS = 1500

export function useProctoring({
  appId, stage, enabled = false, audio = false, videoRef,
  onWarning, onTerminated,
}) {
  const [score, setScore] = useState(0)
  const [threshold, setThreshold] = useState(null)
  const [terminated, setTerminated] = useState(false)
  const [camOn, setCamOn] = useState(false)
  const [camError, setCamError] = useState('')
  const [micOn, setMicOn] = useState(false)
  const [faceStatus, setFaceStatus] = useState('unknown') // ok|no_face|multiple_faces|unsupported|unknown
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement)

  const streamRef = useRef(null)
  const detectorRef = useRef(null)
  const audioCtxRef = useRef(null)
  const timersRef = useRef([])
  const lastReportRef = useRef({})       // type -> timestamp, for cooldowns
  const terminatedRef = useRef(false)
  const speechStartRef = useRef(0)
  const cbRef = useRef({ onWarning, onTerminated })
  cbRef.current = { onWarning, onTerminated }

  // ------------------------------------------------------------ reporting
  const report = useCallback(async (type, detail = '', { cooldown = 0 } = {}) => {
    if (terminatedRef.current) return
    const now = Date.now()
    if (cooldown && now - (lastReportRef.current[type] || 0) < cooldown) return
    lastReportRef.current[type] = now
    try {
      const res = await proctorEvent(appId, stage, type, detail)
      setScore(res.total_score)
      setThreshold(res.threshold)
      if (res.terminated) {
        terminatedRef.current = true
        setTerminated(true)
        stopAll()
        cbRef.current.onTerminated?.(res.message || 'Session terminated due to violations.')
      } else if (res.points > 0) {
        cbRef.current.onWarning?.({
          type, points: res.points, total: res.total_score,
          threshold: res.threshold, message: res.message,
        })
      }
    } catch {
      /* never let proctoring errors break the exam itself */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, stage])

  // ------------------------------------------------------------ media
  const startMedia = useCallback(async () => {
    if (streamRef.current) return true
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('Camera not available in this browser.')
      return false
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio })
      streamRef.current = stream
      if (videoRef?.current) videoRef.current.srcObject = stream
      setCamOn(true)
      setMicOn(audio && stream.getAudioTracks().length > 0)
      return true
    } catch (e) {
      setCamError(`Camera/mic blocked: ${e.name || e.message}`)
      return false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio])

  // Re-point the live stream at the currently mounted <video>; needed when a
  // page swaps screens (system-check -> exam) and the element remounts.
  const attach = useCallback(() => {
    if (videoRef?.current && streamRef.current
        && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopAll = useCallback(() => {
    timersRef.current.forEach(clearInterval)
    timersRef.current = []
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    setCamOn(false)
    setMicOn(false)
  }, [])

  const enterFullscreen = useCallback((el) => {
    const target = el || document.documentElement
    return target.requestFullscreen?.().catch(() => {})
  }, [])

  // ------------------------------------------------------------ detectors
  useEffect(() => {
    if (!enabled || terminated) return

    // -- face presence (FaceDetector is Chromium-only; degrade to snapshots)
    let faceTimer = null
    if ('FaceDetector' in window) {
      try { detectorRef.current = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 4 }) }
      catch { detectorRef.current = null }
    }
    if (detectorRef.current) {
      faceTimer = setInterval(async () => {
        const video = videoRef?.current
        if (!video || video.readyState < 2 || !streamRef.current) return
        try {
          const faces = await detectorRef.current.detect(video)
          if (faces.length === 0) {
            setFaceStatus('no_face')
            report('no_face', 'No face visible in the webcam.', { cooldown: REPORT_COOLDOWN_MS })
          } else if (faces.length > 1) {
            setFaceStatus('multiple_faces')
            report('multiple_faces', `${faces.length} faces visible.`, { cooldown: REPORT_COOLDOWN_MS })
          } else {
            setFaceStatus('ok')
          }
        } catch { /* detector hiccup; snapshots still cover review */ }
      }, FACE_CHECK_MS)
    } else {
      setFaceStatus('unsupported')
      report('face_detection_unsupported',
        'FaceDetector API unavailable; admin review relies on snapshots.')
    }

    // -- periodic webcam snapshots for the admin timeline
    const snapTimer = setInterval(() => {
      const video = videoRef?.current
      if (!video || video.readyState < 2 || !streamRef.current) return
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = Math.round(320 * (video.videoHeight / video.videoWidth)) || 240
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (blob) proctorSnapshot(appId, stage, blob).catch(() => {})
      }, 'image/jpeg', 0.6)
    }, SNAPSHOT_MS)

    // -- microphone activity (written exam only: any sustained speech is logged)
    if (audio && streamRef.current?.getAudioTracks().length) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      audioCtxRef.current = ctx
      const src = ctx.createMediaStreamSource(streamRef.current)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      const audioTimer = setInterval(() => {
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i]
        const rms = Math.sqrt(sum / buf.length)
        const now = Date.now()
        if (rms > AUDIO_RMS_THRESHOLD) {
          if (!speechStartRef.current) speechStartRef.current = now
          if (now - speechStartRef.current > AUDIO_SUSTAIN_MS) {
            report('audio_activity', 'Sustained voice activity during the exam.',
              { cooldown: 20000 })
            speechStartRef.current = 0
          }
        } else {
          speechStartRef.current = 0
        }
      }, 300)
      timersRef.current.push(audioTimer)
    }

    timersRef.current.push(snapTimer)
    if (faceTimer) timersRef.current.push(faceTimer)

    // -- one-time environment checks
    if (window.screen?.isExtended) {
      report('multi_monitor', 'Multiple displays detected.')
    }

    return () => {
      timersRef.current.forEach(clearInterval)
      timersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, terminated])

  // ------------------------------------------------------------ browser events
  useEffect(() => {
    if (!enabled || terminated) return

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        report('tab_switch', 'Tab hidden / window minimized.')
      }
    }
    const onBlur = () => {
      // blur also fires alongside visibilitychange; only log standalone blurs
      if (document.visibilityState === 'visible') {
        report('focus_loss', 'Browser window lost focus.', { cooldown: 5000 })
      }
    }
    const onFsChange = () => {
      const fs = !!document.fullscreenElement
      setIsFullscreen(fs)
      if (!fs) report('fullscreen_exit', 'Left fullscreen mode.')
    }
    const block = (type) => (e) => {
      e.preventDefault()
      report(type, `${type} blocked.`, { cooldown: 3000 })
    }
    const onCopy = block('copy')
    const onCut = block('cut')
    const onPaste = block('paste')
    const onContext = block('context_menu')
    const onDrag = (e) => e.preventDefault()
    const onKeyDown = (e) => {
      const k = e.key?.toUpperCase()
      const devtools = k === 'F12'
        || (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(k))
        || (e.ctrlKey && k === 'U')
      if (devtools) {
        e.preventDefault()
        report('devtools', `Blocked shortcut: ${e.ctrlKey ? 'Ctrl+' : ''}${e.shiftKey ? 'Shift+' : ''}${k}`,
          { cooldown: 3000 })
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    document.addEventListener('contextmenu', onContext)
    document.addEventListener('dragstart', onDrag)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('contextmenu', onContext)
      document.removeEventListener('dragstart', onDrag)
      document.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, terminated])

  // Final cleanup on unmount.
  useEffect(() => stopAll, [stopAll])

  return {
    score, threshold, terminated, camOn, camError, micOn, faceStatus,
    isFullscreen, startMedia, attach, enterFullscreen, stopAll, report,
  }
}
