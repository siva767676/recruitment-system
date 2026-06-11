import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { interviewAnswer, startInterview } from '../lib/api.js'
import { Spinner } from '../components/ui.jsx'
import {
  createRecognizer, speak, speechSupported, stopSpeaking, ttsSupported,
} from '../lib/voice.js'
import { useProctoring } from '../lib/proctor.js'

// Named interview rounds shown in the top stage bar. The backend only tags a
// question as "technical" or "hr"; we map those onto these display stages so
// the bar reflects real progress instead of being purely decorative.
const STAGES = ['Introduction', 'Technical', 'HR Round', 'Final']

// Which stage a given turn belongs to. The very first HR question is the
// "Introduction"; later HR questions are "HR Round"; technical questions are
// "Technical". "Final" lights up only when the report is ready.
function stageForTurn(round, index) {
  if (round === 'technical') return 'Technical'
  if (index === 0) return 'Introduction'
  return 'HR Round'
}

const TOTAL_SECONDS = 25 * 60 // 25:00 countdown, matches the mockup

export default function InterviewPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [session, setSession] = useState(null)     // {thread_id, question, role, candidate_name}
  const [answer, setAnswer] = useState('')
  const [partial, setPartial] = useState('')
  const [turns, setTurns] = useState([])
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [thinking, setThinking] = useState(false)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [voiceOn, setVoiceOn] = useState(true)
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS)
  const [proctorArmed, setProctorArmed] = useState(false)

  const recognizerRef = useRef(null)
  const startedRef = useRef(false)
  const videoRef = useRef(null)
  const endedRef = useRef(false)        // guard so auto-end fires once
  const stageRef = useRef(null)         // the element we request fullscreen on
  const voiceAvailable = speechSupported()

  // Shared proctoring engine (same scoring rules as the exam). audio:false —
  // the mic legitimately belongs to SpeechRecognition during an interview.
  const proctor = useProctoring({
    appId: id,
    stage: 'interview',
    enabled: proctorArmed && !report && !endedRef.current,
    audio: false,
    videoRef,
    onWarning: (w) => setNotice(
      `⚠ Violation recorded (+${w.points}): ${w.type.replace(/_/g, ' ')}. ` +
      `Score ${w.total}/${w.threshold} — at ${w.threshold} the interview ends.`),
    onTerminated: (msg) => autoEnd(msg),
  })

  // ---------------------------------------------------------------- lifecycle
  // Start interview on mount. Guard against React 18 StrictMode's double-invoked
  // effect (and any remount): each /interview/start replaces the server-side
  // session with a new thread_id, so firing it twice races the thread_id the UI
  // holds against the row the DB keeps — a mismatch then 404s on submit.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    startInterview(id)
      .then((data) => {
        setSession(data)
        announce(data.question)
        // Arm proctoring only once the interview is actually live, so the
        // initial camera/mic permission prompts don't trip the tab-switch guard.
        setTimeout(() => setProctorArmed(true), 1500)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
    return () => stopSpeaking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Webcam: owned by the proctoring engine (face checks + snapshots included).
  useEffect(() => { proctor.startMedia() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // The <video> remounts when loading finishes — re-point the stream at it.
  useEffect(() => { proctor.attach() })  // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown timer. Auto-submits/ends when it hits zero.
  useEffect(() => {
    if (loading || report) return
    if (secondsLeft <= 0) { autoEnd('Time is up. The interview has ended.'); return }
    const t = setInterval(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, loading, report])

  // ---------------------------------------------------------------- helpers
  function announce(q) {
    if (voiceOn && q && ttsSupported()) {
      setSpeaking(true)
      speak(q.question, { onEnd: () => setSpeaking(false) })
    }
  }

  function fmt(s) {
    const m = Math.floor(Math.max(0, s) / 60)
    const sec = Math.max(0, s) % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  function cleanupMedia() {
    recognizerRef.current?.stop()
    stopSpeaking()
    proctor.stopAll()
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }

  // End the interview early (server-side proctoring termination or timeout).
  // We can't force the LLM to grade a half-finished interview, so we lock the
  // UI with a clear message; the application is flagged for admin review.
  function autoEnd(message) {
    if (endedRef.current || report) return
    endedRef.current = true
    cleanupMedia()
    setListening(false)
    setNotice(message)
    setError(message)
  }

  // ---------------------------------------------------------------- voice in
  const toggleListen = () => {
    if (listening) {
      recognizerRef.current?.stop()
      setListening(false)
      return
    }
    stopSpeaking()
    setSpeaking(false)
    const rec = createRecognizer({
      onResult: (text) => setAnswer(text),
      onPartial: (text) => setPartial(text),
      onError: (err) => { setError(`Mic error: ${err}`); setListening(false) },
      onEnd: () => { setListening(false); setPartial('') },
    })
    if (!rec) {
      setError('Speech recognition is not supported in this browser. Use Chrome/Edge or type your answer.')
      return
    }
    recognizerRef.current = rec
    rec.start()
    setListening(true)
  }

  // ---------------------------------------------------------------- submit
  const submit = async () => {
    if (!session?.thread_id || endedRef.current) return
    recognizerRef.current?.stop()
    setListening(false)
    stopSpeaking()
    setSpeaking(false)
    setThinking(true)
    setError('')
    try {
      const res = await interviewAnswer(id, session.thread_id, answer)
      if (res.restarted) {
        // The server lost this interview (it was restarted) and planned a fresh
        // one. Adopt the new session and start over from question 1.
        setSession((s) => ({ ...s, thread_id: res.thread_id, question: res.question }))
        setTurns([])
        setAnswer('')
        setPartial('')
        setNotice('The interview was reset because the server restarted. Starting again from question 1.')
        announce(res.question)
        return
      }
      if (res.last_turn) setTurns((t) => [...t, res.last_turn])
      setAnswer('')
      setPartial('')
      if (res.done && res.report) {
        cleanupMedia()
        setReport(res.report)
        if (voiceOn) speak(`That concludes the interview. Your overall score is ${res.report.overall_score} out of 100.`)
      } else {
        setSession((s) => ({ ...s, question: res.question }))
        announce(res.question)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setThinking(false)
    }
  }

  // ---------------------------------------------------------------- render
  if (loading) {
    return (
      <p className="text-slate-500"><Spinner /> Connecting to the AI interviewer…</p>
    )
  }

  if (error && !session) {
    return <div className="border border-rose-200 bg-rose-50 text-rose-700 rounded-xl px-4 py-3 text-sm max-w-2xl mx-auto">{error}</div>
  }

  if (report) return <ReportView report={report} onBack={() => navigate(`/applications/${id}`)} />

  const q = session?.question
  const currentStage = q ? stageForTurn(q.round, turns.length) : 'Introduction'
  const lowTime = secondsLeft <= 60
  const botState = thinking || speaking ? 'speaking' : listening ? 'listening' : 'idle'

  return (
    <div ref={stageRef} className="min-h-screen -mx-4 -my-6 md:-mx-8 bg-[#0a0b14] text-slate-100">
      <BotStyles />
      <div className="max-w-7xl mx-auto px-5 py-5">
        {/* Top bar: title · stage nav · timer */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold tracking-tight">AI Interview</h1>
          <StageBar stages={STAGES} current={currentStage} done={turns.length} />
          <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium border ${lowTime ? 'border-rose-500/60 text-rose-300 bg-rose-500/10' : 'border-white/10 text-slate-300 bg-white/5'}`}>
            <span>🕑</span>{fmt(secondsLeft)}
          </div>
        </div>

        {(notice || error) && (
          <div className={`mb-4 rounded-xl px-4 py-2.5 text-sm border ${endedRef.current ? 'bg-rose-500/10 border-rose-500/40 text-rose-300' : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-200'}`}>
            {error || notice}
          </div>
        )}

        <div className="grid lg:grid-cols-[1fr_380px] gap-4">
          {/* Stage: floating bot + webcam + status pill */}
          <div className="relative rounded-2xl border border-white/10 bg-gradient-to-b from-[#0e1020] to-[#0a0b14] min-h-[460px] flex items-center justify-center overflow-hidden">
            <div className={`bot bot-${botState}`}>
              <div className="bot-core">
                {session?.candidate_name ? initials(session.candidate_name) : 'm.'}
              </div>
            </div>

            {/* Webcam, bottom-left */}
            <div className="absolute bottom-4 left-4 w-44">
              <div className="rounded-xl overflow-hidden border border-white/15 bg-black/60 aspect-video">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              </div>
              <span className={`mt-1.5 inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${proctor.camOn ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/20 text-slate-400'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${proctor.camOn ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                {proctor.camOn ? 'Camera Active' : (proctor.camError || 'Camera off')}
              </span>
            </div>

            {/* Status pill, bottom-center */}
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2">
              <div className="flex items-center gap-2 rounded-full bg-white/5 border border-white/10 px-4 py-2 text-sm text-slate-300">
                {botState === 'speaking' && <><span className="h-2 w-2 rounded-full bg-violet-400 animate-pulse" /> Speaking…</>}
                {botState === 'listening' && <><span className="h-2 w-2 rounded-full bg-rose-400 animate-pulse" /> Listening… <Wave /></>}
                {botState === 'idle' && <>🎙️ Ready</>}
              </div>
            </div>

            {!proctor.isFullscreen && (
              <button onClick={() => proctor.enterFullscreen(stageRef.current)}
                className="absolute top-3 right-3 text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10">
                ⛶ Fullscreen
              </button>
            )}
          </div>

          {/* Right panel: current question · transcript · status · controls */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex flex-col">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Current Question</p>
              <div className="flex items-center gap-2 text-[11px] mb-2">
                <span className="px-2 py-0.5 rounded bg-violet-500/20 text-violet-200 font-semibold uppercase">{q?.round}</span>
                <span className="px-2 py-0.5 rounded bg-white/10 text-slate-300">{q?.difficulty}</span>
                <span className="text-slate-500">{q?.topic}</span>
              </div>
              <p className="text-[15px] leading-relaxed text-slate-100">{q?.question}</p>
              {voiceOn && ttsSupported() && (
                <button onClick={() => announce(q)} className="mt-2 text-xs text-violet-300 hover:text-violet-200">🔊 Replay question</button>
              )}
            </div>

            {/* Transcript */}
            <div className="mt-4 border-t border-white/10 pt-3 flex-1 min-h-0">
              <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Transcript</p>
              <div className="space-y-3 overflow-y-auto max-h-56 pr-1">
                {turns.length === 0 && <p className="text-sm text-slate-500">The conversation will appear here.</p>}
                {turns.map((t, i) => (
                  <div key={i} className="text-sm">
                    <p className="text-violet-300 font-medium">AI Interviewer</p>
                    <p className="text-slate-300">{t.question.question}</p>
                    <p className="text-sky-300 font-medium mt-1">You</p>
                    <p className="text-slate-400">{t.answer || '(no answer)'}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      tech {t.evaluation.technical_score} · comm {t.evaluation.communication_score} · conf {t.evaluation.confidence_score}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Status */}
            <div className="mt-3 border-t border-white/10 pt-3">
              <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Interview Status</p>
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <span className={`h-2 w-2 rounded-full ${listening ? 'bg-rose-400 animate-pulse' : 'bg-emerald-400'}`} />
                {listening ? 'Recording…' : thinking ? 'Evaluating…' : `Question ${turns.length + 1}`}
                {proctor.score > 0 && (
                  <span className="text-amber-400 text-xs">· violations {proctor.score}/{proctor.threshold ?? '—'}</span>
                )}
                <label className="ml-auto flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={voiceOn}
                    onChange={(e) => { setVoiceOn(e.target.checked); if (!e.target.checked) { stopSpeaking(); setSpeaking(false) } }}
                    className="accent-violet-500" />
                  Voice
                </label>
              </div>
            </div>

            {/* Answer + controls */}
            <div className="mt-3 space-y-2">
              <textarea rows="3" value={listening ? `${answer} ${partial}`.trim() : answer}
                onChange={(e) => setAnswer(e.target.value)}
                disabled={endedRef.current}
                placeholder={voiceAvailable ? 'Click the mic and speak, or type…' : 'Type your answer…'}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-violet-500 outline-none disabled:opacity-50" />
              <div className="flex items-center gap-2">
                {voiceAvailable && (
                  <button onClick={toggleListen} disabled={endedRef.current}
                    className={`px-4 py-2.5 rounded-xl font-semibold text-white disabled:opacity-50 ${listening ? 'bg-rose-600 hover:bg-rose-700 animate-pulse' : 'bg-violet-600 hover:bg-violet-700'}`}>
                    {listening ? '⏹ Stop' : '🎤 Speak'}
                  </button>
                )}
                <button onClick={submit} disabled={thinking || endedRef.current || !answer.trim()}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-400 text-white font-semibold py-2.5 rounded-xl">
                  {thinking ? <><Spinner /> Evaluating…</> : 'Submit answer'}
                </button>
              </div>
              {endedRef.current && (
                <button onClick={() => navigate(`/applications/${id}`)}
                  className="w-full mt-1 bg-white/10 hover:bg-white/20 text-slate-200 font-semibold py-2.5 rounded-xl">
                  Back to application
                </button>
              )}
              {!voiceAvailable && (
                <p className="text-xs text-amber-300">Voice input isn't supported here — type your answers. (Chrome/Edge support speech.)</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- subcomponents
function StageBar({ stages, current }) {
  const activeIdx = stages.indexOf(current)
  return (
    <div className="hidden md:flex items-center gap-1.5 text-sm">
      {stages.map((s, i) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={i === activeIdx ? 'text-violet-300 font-semibold' : i < activeIdx ? 'text-slate-400' : 'text-slate-600'}>
            {s}
          </span>
          {i < stages.length - 1 && <span className="text-slate-700">›</span>}
        </span>
      ))}
    </div>
  )
}

function Wave() {
  return (
    <span className="inline-flex items-end gap-0.5 h-3">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="w-0.5 bg-rose-400 rounded-full wave-bar" style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  )
}

function ReportView({ report, onBack }) {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-5">
        <div className="text-center">
          <p className="text-xs uppercase text-slate-400">Interview complete</p>
          <p className="text-5xl font-extrabold text-violet-600 mt-2">
            {report.overall_score}<span className="text-2xl text-slate-400">/100</span>
          </p>
          <p className="mt-2 font-semibold text-slate-700">{report.recommendation}</p>
        </div>
        <p className="text-slate-600">{report.summary}</p>
        <div className="grid grid-cols-4 gap-3 text-center text-sm">
          <Metric label="Technical" v={report.technical_skills} />
          <Metric label="Communication" v={report.communication} />
          <Metric label="Confidence" v={report.confidence} />
          <Metric label="Problem solving" v={report.problem_solving} />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <h3 className="font-semibold text-emerald-700 mb-1">Strengths</h3>
            <ul className="list-disc list-inside text-sm text-slate-600">
              {report.strengths.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-rose-700 mb-1">Weaknesses</h3>
            <ul className="list-disc list-inside text-sm text-slate-600">
              {report.weaknesses.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
        </div>
        <button onClick={onBack}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl">
          Back to application
        </button>
      </div>
    </div>
  )
}

function Metric({ label, v }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <p className="text-slate-400 text-xs">{label}</p>
      <p className="font-bold text-slate-700">{v}/10</p>
    </div>
  )
}

function initials(name) {
  const parts = (name || '').trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'AI'
}

// Scoped animations for the floating bot + listening wave. Injected once.
function BotStyles() {
  return (
    <style>{`
      .bot { position: relative; width: 150px; height: 150px; display: grid; place-items: center; }
      .bot-core {
        width: 110px; height: 110px; border-radius: 9999px;
        display: grid; place-items: center; font-weight: 700; font-size: 26px; color: #1e1b4b;
        background: radial-gradient(circle at 35% 30%, #ffffff, #e9e6ff 60%, #c7c0ff);
        box-shadow: 0 0 60px 10px rgba(139,92,246,.55), inset 0 0 20px rgba(99,102,241,.4);
        z-index: 2;
      }
      .bot::before {
        content: ''; position: absolute; inset: -18px; border-radius: 9999px;
        background: radial-gradient(circle, rgba(139,92,246,.45), rgba(56,189,248,.25) 60%, transparent 70%);
        filter: blur(6px); z-index: 1;
      }
      .bot-idle::before { animation: pulse 3s ease-in-out infinite; }
      .bot-speaking::before { animation: pulse 1s ease-in-out infinite; }
      .bot-listening::after {
        content: ''; position: absolute; inset: -4px; border-radius: 9999px;
        border: 2px solid rgba(244,114,182,.7); animation: ring 1.4s ease-out infinite; z-index: 0;
      }
      @keyframes pulse { 0%,100% { transform: scale(1); opacity: .8 } 50% { transform: scale(1.12); opacity: 1 } }
      @keyframes ring { 0% { transform: scale(1); opacity: .8 } 100% { transform: scale(1.5); opacity: 0 } }
      .wave-bar { height: 40%; animation: wave .8s ease-in-out infinite; }
      @keyframes wave { 0%,100% { height: 30% } 50% { height: 100% } }
    `}</style>
  )
}
