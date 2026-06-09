import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { startExam, submitExam } from '../lib/api.js'
import { Alert, Card, Spinner } from '../components/ui.jsx'

export default function ExamPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [exam, setExam] = useState(null)
  const [answers, setAnswers] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    startExam(id)
      .then(setExam)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  const setAnswer = (idx, value) => setAnswers((a) => ({ ...a, [idx]: value }))

  const submit = async () => {
    setError('')
    setSubmitting(true)
    try {
      const res = await submitExam(id, answers)
      setResult(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="text-slate-500"><Spinner /> Generating your assessment…</p>
  if (error && !exam) return <Alert>{error}</Alert>

  if (result) {
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

  const questions = exam?.questions || []
  const allAnswered = questions.every((_, i) => answers[i] !== undefined && answers[i] !== '')

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Online Assessment</h1>
        <p className="text-sm text-slate-500">
          {questions.length} questions · generated from your resume and the job description.
        </p>
      </div>
      <Alert>{error}</Alert>

      {questions.map((q, i) => (
        <Card key={i} className="p-6 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-indigo-600">
              {q.source} · {q.topic}
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
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none" />
          )}
        </Card>
      ))}

      <div className="flex items-center justify-between sticky bottom-4 bg-white/90 backdrop-blur border border-slate-200 rounded-xl p-4">
        <span className="text-sm text-slate-500">
          {Object.keys(answers).length}/{questions.length} answered
        </span>
        <button onClick={submit} disabled={submitting || !allAnswered}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold px-6 py-2.5 rounded-xl">
          {submitting ? <Spinner /> : 'Submit assessment'}
        </button>
      </div>
    </div>
  )
}
