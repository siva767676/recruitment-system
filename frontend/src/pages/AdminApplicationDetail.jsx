import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  adminApplicationDetail, adminOverrideStatus, adminProctor, adminRescreen,
  adminResume, adminSnapshotUrl, adminTerminate,
} from '../lib/api.js'
import { Alert, Card, ScoreBadge, Spinner, StatusBadge } from '../components/ui.jsx'

const ALL_STATUSES = [
  'applied', 'screening', 'screen_rejected', 'shortlisted', 'exam_in_progress',
  'exam_completed', 'exam_passed', 'exam_failed', 'interview_in_progress',
  'interview_completed', 'selected', 'rejected',
]

export default function AdminApplicationDetail() {
  const { id } = useParams()
  const [app, setApp] = useState(null)
  const [resume, setResume] = useState('')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [newStatus, setNewStatus] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const [proctor, setProctor] = useState(null)

  const load = () => {
    adminApplicationDetail(id).then((d) => { setApp(d); setNewStatus(d.status); setNote(d.admin_note || '') }).catch((e) => setError(e.message))
    adminResume(id).then(setResume).catch(() => {})
    adminProctor(id).then(setProctor).catch(() => {})
  }
  useEffect(load, [id])

  // Live-ish monitoring: while a stage is running, refresh the proctor report
  // every 10s so new violations and snapshots appear without a manual reload.
  useEffect(() => {
    if (!app?.status?.endsWith('in_progress')) return
    const t = setInterval(() => adminProctor(id).then(setProctor).catch(() => {}), 10000)
    return () => clearInterval(t)
  }, [id, app?.status])

  const terminate = async (stage) => {
    if (!window.confirm(`Terminate this candidate's ${stage} now?`)) return
    setBusy(true); setError(''); setMsg('')
    try {
      await adminTerminate(id, stage, 'Terminated manually by admin.')
      setMsg(`${stage} terminated.`)
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const override = async () => {
    setBusy(true); setError(''); setMsg('')
    try {
      await adminOverrideStatus(id, newStatus, note)
      setMsg('Status updated.')
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const rescreen = async () => {
    setBusy(true); setError(''); setMsg('')
    try { await adminRescreen(id); setMsg('Re-screened.'); load() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (error && !app) return <Alert>{error}</Alert>
  if (!app) return <p className="text-slate-500"><Spinner /> Loading…</p>

  const sd = app.screening_details || {}
  const exam = app.exam
  const report = app.interview?.report

  return (
    <div className="space-y-6">
      <Link to="/admin/applications" className="text-sm text-indigo-600">← Applications</Link>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{app.candidate_name}</h1>
          <p className="text-slate-500">{app.candidate_email} · applied for {app.job_title}</p>
        </div>
        <StatusBadge status={app.status} />
      </div>

      <Alert>{error}</Alert>
      {msg && <Alert kind="success">{msg}</Alert>}
      {app.flagged && (
        <div className="border border-rose-300 bg-rose-50 text-rose-700 rounded-xl px-4 py-3 text-sm">
          🚩 <b>Flagged for review:</b> {app.flag_reason || 'proctoring violations'}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: scores + admin controls */}
        <div className="space-y-6">
          <Card className="p-5 space-y-3">
            <h3 className="font-semibold">Stage scores</h3>
            <Row label="Screening" v={app.screening_score} />
            <Row label="Assessment" v={app.exam_score} />
            <Row label="Interview" v={app.interview_score} />
            <button onClick={rescreen} disabled={busy}
              className="w-full mt-2 text-sm border border-slate-300 hover:border-indigo-400 rounded-lg py-2">
              ↻ Re-run screening
            </button>
          </Card>

          <Card className="p-5 space-y-3">
            <h3 className="font-semibold">Manual decision</h3>
            <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              {ALL_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <textarea rows="3" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Admin note (optional)"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={override} disabled={busy}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold py-2 rounded-lg">
              {busy ? <Spinner /> : 'Apply override'}
            </button>
            {app.manual_override && <p className="text-xs text-amber-600">⚠ Manually overridden — auto-transitions are paused.</p>}
          </Card>

          {proctor && (
            <Card className="p-5 space-y-3">
              <h3 className="font-semibold">Proctoring</h3>
              <Row label={`Exam violations (limit ${proctor.threshold})`} v={proctor.exam_score} />
              <Row label={`Interview violations (limit ${proctor.threshold})`} v={proctor.interview_score} />
              {proctor.exam_terminated && <p className="text-xs text-rose-600">Exam was terminated.</p>}
              {proctor.interview_terminated && <p className="text-xs text-rose-600">Interview was terminated.</p>}
              {app.status === 'exam_in_progress' && !proctor.exam_terminated && (
                <button onClick={() => terminate('exam')} disabled={busy}
                  className="w-full text-sm border border-rose-300 text-rose-600 hover:bg-rose-50 rounded-lg py-2">
                  ■ Terminate exam now
                </button>
              )}
              {app.status === 'interview_in_progress' && !proctor.interview_terminated && (
                <button onClick={() => terminate('interview')} disabled={busy}
                  className="w-full text-sm border border-rose-300 text-rose-600 hover:bg-rose-50 rounded-lg py-2">
                  ■ Terminate interview now
                </button>
              )}
              {app.status?.endsWith('in_progress') && (
                <p className="text-xs text-slate-400">Live: refreshes every 10s.</p>
              )}
            </Card>
          )}
        </div>

        {/* Right: details */}
        <div className="lg:col-span-2 space-y-6">
          {sd.matched_skills && (
            <Card className="p-5 space-y-2">
              <h3 className="font-semibold">Screening breakdown</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-sm">
                <Mini label="Skill" v={sd.skill_score} />
                <Mini label="Experience" v={sd.experience_score} />
                <Mini label="Education" v={sd.education_score} />
                <Mini label="Keyword" v={sd.keyword_score} />
              </div>
              <p className="text-xs text-slate-500 mt-2">Matched: {(sd.matched_skills || []).join(', ') || '—'}</p>
              <p className="text-xs text-rose-500">Missing: {(sd.missing_skills || []).join(', ') || '—'}</p>
            </Card>
          )}

          {exam && exam.submitted && (
            <Card className="p-5 space-y-3">
              <h3 className="font-semibold">Assessment — {exam.score}/100</h3>
              {(exam.questions || []).map((q, i) => {
                const ev = (exam.evaluation || [])[i] || {}
                const ans = (exam.answers || {})[String(i)]
                return (
                  <div key={i} className="border-b border-slate-100 pb-2 text-sm">
                    <p className="font-medium">{q.question}</p>
                    {q.type === 'mcq' ? (
                      <p className="text-xs">
                        Answer: option {ans} ·{' '}
                        <span className={ev.correct ? 'text-emerald-600' : 'text-rose-600'}>
                          {ev.correct ? 'correct' : `wrong (correct: ${q.correct_index})`}
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500">Answer: {ans || '(none)'} — scored {ev.score_10}/10</p>
                    )}
                  </div>
                )
              })}
            </Card>
          )}

          {report && (
            <Card className="p-5 space-y-3">
              <h3 className="font-semibold">AI Interview report — {report.overall_score}/100 · {report.recommendation}</h3>
              <p className="text-sm text-slate-600">{report.summary}</p>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <Mini label="Tech" v={report.technical_skills} of10 />
                <Mini label="Comm" v={report.communication} of10 />
                <Mini label="Confidence" v={report.confidence} of10 />
                <Mini label="Problem" v={report.problem_solving} of10 />
              </div>
              <div className="grid md:grid-cols-2 gap-3 text-sm">
                <div><p className="font-medium text-emerald-700">Strengths</p>
                  <ul className="list-disc list-inside text-slate-600">{report.strengths.map((s) => <li key={s}>{s}</li>)}</ul></div>
                <div><p className="font-medium text-rose-700">Weaknesses</p>
                  <ul className="list-disc list-inside text-slate-600">{report.weaknesses.map((s) => <li key={s}>{s}</li>)}</ul></div>
              </div>
            </Card>
          )}

          {app.interview?.transcript?.length > 0 && (
            <Card className="p-5 space-y-3">
              <h3 className="font-semibold">Interview transcript</h3>
              {app.interview.transcript.map((t, i) => (
                <div key={i} className="border-b border-slate-100 pb-2 text-sm">
                  <p className="font-medium">Q{i + 1} [{t.question.round}]: {t.question.question}</p>
                  <p className="text-slate-600 mt-1"><b>A:</b> {t.answer || '(no answer)'}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    tech {t.evaluation.technical_score} · comm {t.evaluation.communication_score} ·
                    confidence {t.evaluation.confidence_score} · problem {t.evaluation.problem_solving_score}
                  </p>
                </div>
              ))}
            </Card>
          )}

          {proctor && proctor.events?.length > 0 && (
            <Card className="p-5 space-y-3">
              <h3 className="font-semibold">Violation timeline ({proctor.events.length} events)</h3>
              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                {proctor.events.map((e) => (
                  <div key={e.id} className="flex items-center justify-between text-sm border-b border-slate-100 pb-1.5">
                    <span>
                      <span className={`font-medium ${e.points >= 15 ? 'text-rose-600' : e.points > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                        {e.type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-slate-400"> · {e.stage}</span>
                      {e.detail && <span className="text-slate-400 text-xs"> — {e.detail}</span>}
                    </span>
                    <span className="text-xs text-slate-400 whitespace-nowrap ml-2">
                      +{e.points} · {e.created_at ? new Date(e.created_at).toLocaleTimeString() : ''}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {proctor && proctor.snapshots?.length > 0 && (
            <Card className="p-5 space-y-3">
              <h3 className="font-semibold">Camera snapshots ({proctor.snapshots.length})</h3>
              <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                {proctor.snapshots.slice(0, 12).map((name) => (
                  <Snapshot key={name} appId={id} name={name} />
                ))}
              </div>
            </Card>
          )}

          <Card className="p-5">
            <h3 className="font-semibold mb-2">Resume ({app.resume_filename})</h3>
            <pre className="text-xs text-slate-600 whitespace-pre-wrap max-h-96 overflow-auto bg-slate-50 rounded-lg p-3">
              {resume || '(loading…)'}
            </pre>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Row({ label, v }) {
  return <div className="flex justify-between text-sm"><span className="text-slate-500">{label}</span><ScoreBadge score={v} /></div>
}

// Snapshots are behind admin auth, so <img src> can't load them directly —
// fetch with the bearer token and render the blob.
function Snapshot({ appId, name }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let revoked = false
    let objectUrl = null
    adminSnapshotUrl(appId, name)
      .then((u) => { objectUrl = u; if (!revoked) setUrl(u) })
      .catch(() => {})
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [appId, name])
  if (!url) return <div className="aspect-video bg-slate-100 rounded animate-pulse" />
  return (
    <a href={url} target="_blank" rel="noreferrer" title={name}>
      <img src={url} alt={name} className="aspect-video object-cover rounded border border-slate-200" />
    </a>
  )
}
function Mini({ label, v, of10 }) {
  return (
    <div className="bg-slate-50 rounded-lg p-2">
      <p className="text-slate-400">{label}</p>
      <p className="font-bold text-slate-700">{v ?? '—'}{of10 ? '/10' : ''}</p>
    </div>
  )
}
