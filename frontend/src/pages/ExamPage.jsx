import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { saveExamDraft, startExam, submitExam } from '../lib/api.js'
import { Alert, Card, Spinner } from '../components/ui.jsx'
import { useProctoring } from '../lib/proctor.js'

const AUTOSAVE_MS = 3000

export default function ExamPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  // phase: check -> exam -> result | terminated
  const [phase, setPhase] = useState('check')
  const [exam, setExam] = useState(null)
  const [answers, setAnswers] = useState({})
  const [error, setError] = useState('')
  const [warning, setWarning] = useState(null)   // last proctoring warning
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [endMessage, setEndMessage] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(null)
  const [savedAt, setSavedAt] = useState(null)
  const [ack, setAck] = useState(false)

  const videoRef = useRef(null)
  const answersRef = useRef(answers)
  answersRef.current = answers
  const submittingRef = useRef(false)

  const proctor = useProctoring({
    appId: id,
    stage: 'exam',
    enabled: phase === 'exam',
    audio: true,                       // mic monitored during a written exam
    videoRef,
    onWarning: (w) => setWarning(w),
    onTerminated: (msg) => { setEndMessage(msg); setPhase('terminated') },
  })

  // The same camera stream must survive the check -> exam transition; ask for
  // it as soon as the gate renders.
  useEffect(() => { proctor.startMedia() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // The <video> element remounts when the screen changes — re-point the stream.
  useEffect(() => { proctor.attach() }, [phase])  // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss warnings.
  useEffect(() => {
    if (!warning) return
    const t = setTimeout(() => setWarning(null), 6000)
    return () => clearTimeout(t)
  }, [warning])

  // Countdown driven by the server's remaining_seconds; auto-submit at zero.
  useEffect(() => {
    if (phase !== 'exam' || secondsLeft === null) return
    if (secondsLeft <= 0) { doSubmit(true); return }
    const t = setInterval(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, secondsLeft === null, secondsLeft <= 0])

  // Autosave (debounced) so answers survive reloads/disconnects.
  useEffect(() => {
    if (phase !== 'exam') return
    const t = setTimeout(() => {
      saveExamDraft(id, answersRef.current)
        .then(() => setSavedAt(new Date()))
        .catch(() => {})
    }, AUTOSAVE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, phase])

  const begin = async () => {
    setError('')
    setLoading(true)
    try {
      await proctor.enterFullscreen()
      const data = await startExam(id)
      setExam(data)
      if (data.draft && Object.keys(data.draft).length) setAnswers(data.draft)
      setSecondsLeft(data.remaining_seconds ?? data.duration_seconds ?? 1800)
      setPhase('exam')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const setAnswer = (idx, value) => setAnswers((a) => ({ ...a, [idx]: value }))

  const doSubmit = async (auto = false) => {
    if (submittingRef.current) return
    submittingRef.current = true
    setError('')
    setSubmitting(true)
    try {
      const res = await submitExam(id, answersRef.current)
      proctor.stopAll()
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
      setResult(res)
      setPhase('result')
    } catch (e) {
      setError(auto ? `Time expired — auto-submit failed: ${e.message}` : e.message)
      submittingRef.current = false
    } finally {
      setSubmitting(false)
    }
  }

  // ---------------------------------------------------------------- screens
  if (phase === 'terminated') {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="p-8 text-center space-y-4">
          <p className="text-4xl">🚫</p>
          <h1 className="text-2xl font-bold text-rose-600">Assessment terminated</h1>
          <p className="text-slate-600">{endMessage}</p>
          <p className="text-sm text-slate-500">
            Your application has been flagged for manual review. The recruitment
            team will look at your saved answers and the violation log.
          </p>
          <button onClick={() => navigate(`/applications/${id}`)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl">
            Back to application
          </button>
        </Card>
      </div>
    )
  }

  if (phase === 'result' && result) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="p-8 text-center space-y-4">
          <h1 className="text-2xl font-bold">Assessment submitted</h1>
          <p className="text-5xl font-extrabold text-indigo-600">{result.score}<span className="text-2xl text-slate-400">/100</span></p>
          {result.passed ? (
            <p className="text-emerald-600 font-medium">You passed the cutoff — the AI interview is now unlocked!</p>
          ) : (
            <p className="text-amber-600 font-medium">Your score has been recorded.</p>
          )}
          <button onClick={() => navigate(`/applications/${id}`)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl">
            Back to application
          </button>
        </Card>
      </div>
    )
  }

  if (phase === 'check') {
    const ready = proctor.camOn && ack
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Online Assessment — System Check</h1>
          <p className="text-sm text-slate-500">This is a proctored test. Complete the checks below to begin.</p>
        </div>
        <Alert>{error}</Alert>

        <Card className="p-6 space-y-5">
          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-900 aspect-video">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              </div>
              <p className={`mt-2 text-sm ${proctor.camOn ? 'text-emerald-600' : 'text-rose-600'}`}>
                {proctor.camOn ? '✓ Camera and microphone active' : (proctor.camError || 'Waiting for camera permission…')}
              </p>
            </div>
            <div className="text-sm text-slate-600 space-y-2">
              <p className="font-semibold text-slate-800">Exam rules</p>
              <ul className="list-disc list-inside space-y-1">
                <li>The exam runs in fullscreen. Leaving fullscreen is a violation.</li>
                <li>Switching tabs or windows is recorded.</li>
                <li>Copy, paste, and right-click are disabled.</li>
                <li>Your webcam and microphone stay on; periodic snapshots are taken.</li>
                <li>Accumulated violations end the exam automatically.</li>
                <li>The timer keeps running once the exam starts — answers autosave.</li>
              </ul>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)}
              className="mt-0.5 accent-indigo-600" />
            I understand and accept the proctoring rules above.
          </label>

          <button onClick={begin} disabled={!ready || loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold py-3 rounded-xl">
            {loading ? <><Spinner /> Generating your assessment…</> : 'Enter fullscreen & start the exam'}
          </button>
          {!proctor.camOn && !proctor.camError && (
            <p className="text-xs text-slate-400 text-center">Allow camera + microphone access when prompted.</p>
          )}
        </Card>
      </div>
    )
  }

  // ---------------------------------------------------------------- exam
  const questions = exam?.questions || []
  const allAnswered = questions.every((_, i) => answers[i] !== undefined && answers[i] !== '')
  const lowTime = secondsLeft !== null && secondsLeft <= 120

  return (
    <div className="max-w-3xl mx-auto space-y-6 select-none">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Online Assessment</h1>
          <p className="text-sm text-slate-500">
            {questions.length} questions · generated from your resume and the job description.
          </p>
        </div>
        <div className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold border ${lowTime ? 'border-rose-300 text-rose-600 bg-rose-50 animate-pulse' : 'border-slate-200 text-slate-700 bg-white'}`}>
          🕑 {fmt(secondsLeft)}
        </div>
      </div>

      {warning && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
          ⚠ Violation recorded (+{warning.points}): {warning.type.replace(/_/g, ' ')}.
          Score {warning.total}/{warning.threshold} — at {warning.threshold} the exam ends automatically.
        </div>
      )}
      <Alert>{error}</Alert>

      {questions.map((q, i) => (
        <Card key={i} className="p-6 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-indigo-600">
              {q.source} · {q.topic}{q.difficulty ? ` · ${q.difficulty}` : ''}
            </span>
            <span className="text-xs text-slate-400">Q{i + 1}</span>
          </div>
          <p className="font-medium">{q.question}</p>

          {q.type === 'mcq' ? (
            <div className="space-y-2">
              {q.options.map((opt, oi) => (
                <label key={oi}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition
                    ${String(answers[i]) === String(oi) ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <input type="radio" name={`q${i}`} checked={String(answers[i]) === String(oi)}
                    onChange={() => setAnswer(i, oi)} className="accent-indigo-600" />
                  <span className="text-sm">{opt}</span>
                </label>
              ))}
            </div>
          ) : (
            <textarea rows="4" value={answers[i] || ''} onChange={(e) => setAnswer(i, e.target.value)}
              placeholder="Type your answer…"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none select-text" />
          )}
        </Card>
      ))}

      <div className="flex items-center justify-between sticky bottom-4 bg-white/90 backdrop-blur border border-slate-200 rounded-xl p-4">
        <div className="text-sm text-slate-500">
          {Object.keys(answers).length}/{questions.length} answered
          {savedAt && <span className="text-emerald-600 ml-2">· saved {savedAt.toLocaleTimeString()}</span>}
          {proctor.score > 0 && (
            <span className="text-amber-600 ml-2">· violations {proctor.score}/{proctor.threshold ?? '—'}</span>
          )}
        </div>
        <button onClick={() => doSubmit(false)} disabled={submitting || !allAnswered}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold px-6 py-2.5 rounded-xl">
          {submitting ? <Spinner /> : 'Submit assessment'}
        </button>
      </div>

      {/* Webcam stays visible so the candidate knows monitoring is active */}
      <div className="fixed bottom-4 left-4 w-36 z-40">
        <div className="rounded-lg overflow-hidden border border-slate-300 shadow-lg bg-black aspect-video">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        </div>
        <span className={`mt-1 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${proctor.camOn ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${proctor.camOn ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          {proctor.camOn ? 'Monitoring' : 'Camera off'}
        </span>
      </div>
    </div>
  )
}

function fmt(s) {
  if (s === null || s === undefined) return '—:—'
  const m = Math.floor(Math.max(0, s) / 60)
  const sec = Math.max(0, s) % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}
