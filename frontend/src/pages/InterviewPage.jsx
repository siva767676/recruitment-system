import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { interviewAnswer, startInterview } from '../lib/api.js'
import { Alert, Card, Spinner } from '../components/ui.jsx'
import {
  createRecognizer, speak, speechSupported, stopSpeaking, ttsSupported,
} from '../lib/voice.js'

export default function InterviewPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [session, setSession] = useState(null)     // {thread_id, question, role, candidate_name}
  const [answer, setAnswer] = useState('')
  const [partial, setPartial] = useState('')
  const [turns, setTurns] = useState([])
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [thinking, setThinking] = useState(false)
  const [listening, setListening] = useState(false)
  const [voiceOn, setVoiceOn] = useState(true)

  const recognizerRef = useRef(null)
  const startedRef = useRef(false)
  const voiceAvailable = speechSupported()

  // Start interview on mount.
  // Guard against React 18 StrictMode's double-invoked effect (and any remount):
  // each /interview/start replaces the server-side session with a new thread_id,
  // so firing it twice races the thread_id the UI holds against the row the DB
  // keeps — a mismatch then 404s ("Interview session not found.") on submit.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    startInterview(id)
      .then((data) => {
        setSession(data)
        if (voiceOn && data.question) speak(questionSpeech(data.question))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
    return () => stopSpeaking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function questionSpeech(q) {
    return q ? `${q.question}` : ''
  }

  const toggleListen = () => {
    if (listening) {
      recognizerRef.current?.stop()
      setListening(false)
      return
    }
    stopSpeaking()
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

  const submit = async () => {
    if (!session?.thread_id) return
    recognizerRef.current?.stop()
    setListening(false)
    stopSpeaking()
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
        setError('The interview was reset because the server restarted. Starting again from question 1.')
        if (voiceOn && res.question) speak(questionSpeech(res.question))
        return
      }
      if (res.last_turn) setTurns((t) => [...t, res.last_turn])
      setAnswer('')
      setPartial('')
      if (res.done && res.report) {
        setReport(res.report)
        if (voiceOn) speak(`That concludes the interview. Your overall score is ${res.report.overall_score} out of 100.`)
      } else {
        setSession((s) => ({ ...s, question: res.question }))
        if (voiceOn && res.question) speak(questionSpeech(res.question))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setThinking(false)
    }
  }

  if (loading) return <p className="text-slate-500"><Spinner /> Connecting to the AI interviewer…</p>
  if (error && !session) return <Alert>{error}</Alert>

  if (report) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Card className="p-8 space-y-5">
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
          <button onClick={() => navigate(`/applications/${id}`)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl">
            Back to application
          </button>
        </Card>
      </div>
    )
  }

  const q = session?.question

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Interview</h1>
          <p className="text-sm text-slate-500">{session?.role} · Q{turns.length + 1}</p>
        </div>
        {ttsSupported() && (
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={voiceOn}
              onChange={(e) => { setVoiceOn(e.target.checked); if (!e.target.checked) stopSpeaking() }}
              className="accent-violet-600" />
            Voice
          </label>
        )}
      </div>

      <Alert>{error}</Alert>

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-0.5 rounded bg-violet-100 text-violet-700 font-semibold uppercase">{q?.round}</span>
          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600">{q?.difficulty}</span>
          <span className="text-slate-400">{q?.topic}</span>
        </div>
        <p className="text-lg font-medium">{q?.question}</p>
        {voiceOn && ttsSupported() && (
          <button onClick={() => speak(questionSpeech(q))} className="text-sm text-violet-600">🔊 Replay question</button>
        )}

        <div className="space-y-2">
          <textarea rows="5" value={listening ? `${answer} ${partial}`.trim() : answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={voiceAvailable ? 'Click the mic and speak, or type your answer…' : 'Type your answer…'}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-violet-500 outline-none" />

          <div className="flex items-center gap-3">
            {voiceAvailable && (
              <button onClick={toggleListen}
                className={`px-4 py-2.5 rounded-xl font-semibold text-white ${listening ? 'bg-rose-600 hover:bg-rose-700 animate-pulse' : 'bg-violet-600 hover:bg-violet-700'}`}>
                {listening ? '⏹ Stop' : '🎤 Speak'}
              </button>
            )}
            <button onClick={submit} disabled={thinking || (!answer.trim())}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold py-2.5 rounded-xl">
              {thinking ? <><Spinner /> Evaluating…</> : 'Submit answer'}
            </button>
          </div>
          {!voiceAvailable && (
            <p className="text-xs text-amber-600">
              Voice input isn't supported in this browser — type your answers. (Chrome/Edge support speech.)
            </p>
          )}
        </div>
      </Card>

      {turns.length > 0 && (
        <Card className="p-6">
          <h3 className="font-semibold mb-3">Progress</h3>
          <div className="space-y-2">
            {turns.map((t, i) => (
              <div key={i} className="text-sm flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-600">Q{i + 1}: {t.question.topic}</span>
                <span className="text-slate-400">
                  tech {t.evaluation.technical_score} · comm {t.evaluation.communication_score}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
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
