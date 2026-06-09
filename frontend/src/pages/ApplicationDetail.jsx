import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getApplication } from '../lib/api.js'
import { Alert, Card, ScoreBadge, Spinner, StatusBadge } from '../components/ui.jsx'

const STAGES = [
  { key: 'screening', label: 'Resume Screening' },
  { key: 'exam', label: 'Online Assessment' },
  { key: 'interview', label: 'AI Interview' },
  { key: 'decision', label: 'Decision' },
]

function stageState(status) {
  const order = {
    applied: 0, screening: 0, screen_rejected: 0,
    shortlisted: 1, exam_in_progress: 1, exam_completed: 1, exam_failed: 1,
    exam_passed: 2, interview_in_progress: 2, interview_completed: 2,
    selected: 3, rejected: 3,
  }
  return order[status] ?? 0
}

export default function ApplicationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [app, setApp] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getApplication(id).then(setApp).catch((e) => setError(e.message))
  }, [id])

  if (error) return <Alert>{error}</Alert>
  if (!app) return <p className="text-slate-500"><Spinner /> Loading…</p>

  const current = stageState(app.status)
  const examReady = app.status === 'shortlisted' || app.status === 'exam_in_progress'
  const interviewReady = app.status === 'exam_passed' || app.status === 'interview_in_progress'

  return (
    <div className="space-y-6 max-w-3xl">
      <Link to="/applications" className="text-sm text-indigo-600">← My applications</Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{app.job_title}</h1>
        <StatusBadge status={app.status} />
      </div>

      {/* Stage tracker */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          {STAGES.map((s, i) => {
            const done = i < current
            const active = i === current
            return (
              <div key={s.key} className="flex-1 flex flex-col items-center text-center">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold
                  ${done ? 'bg-emerald-500 text-white' : active ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                  {done ? '✓' : i + 1}
                </div>
                <span className="text-xs mt-2 text-slate-600">{s.label}</span>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Scores */}
      <Card className="p-6 grid grid-cols-3 gap-4 text-center">
        <div><p className="text-xs text-slate-500 uppercase">Screening</p><p className="text-2xl"><ScoreBadge score={app.screening_score} /></p></div>
        <div><p className="text-xs text-slate-500 uppercase">Assessment</p><p className="text-2xl"><ScoreBadge score={app.exam_score} /></p></div>
        <div><p className="text-xs text-slate-500 uppercase">Interview</p><p className="text-2xl"><ScoreBadge score={app.interview_score} /></p></div>
      </Card>

      {/* Screening detail */}
      {app.screening_details?.matched_skills && (
        <Card className="p-6 space-y-3">
          <h3 className="font-semibold">Screening breakdown</h3>
          <div className="text-sm">
            <p className="text-slate-500 mb-1">Matched skills</p>
            <div className="flex flex-wrap gap-1">
              {app.screening_details.matched_skills.map((s) => (
                <span key={s} className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">{s}</span>
              ))}
            </div>
          </div>
          {app.screening_details.missing_skills?.length > 0 && (
            <div className="text-sm">
              <p className="text-slate-500 mb-1">Missing skills</p>
              <div className="flex flex-wrap gap-1">
                {app.screening_details.missing_skills.map((s) => (
                  <span key={s} className="text-[11px] px-2 py-0.5 rounded bg-rose-50 text-rose-700">{s}</span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Next action */}
      <Card className="p-6">
        {app.status === 'screen_rejected' && (
          <p className="text-rose-600">Unfortunately your resume did not meet the screening cutoff for this role.</p>
        )}
        {examReady && (
          <div className="flex items-center justify-between">
            <p className="text-slate-700 font-medium">🎉 You've been shortlisted! Take your online assessment.</p>
            <button onClick={() => navigate(`/applications/${id}/exam`)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-2.5 rounded-xl">
              {app.status === 'exam_in_progress' ? 'Resume assessment' : 'Start assessment'}
            </button>
          </div>
        )}
        {app.status === 'exam_failed' && (
          <p className="text-rose-600">Your assessment score was below the cutoff for this role.</p>
        )}
        {interviewReady && (
          <div className="flex items-center justify-between">
            <p className="text-slate-700 font-medium">✅ You passed the assessment! Begin your AI voice interview.</p>
            <button onClick={() => navigate(`/applications/${id}/interview`)}
              className="bg-violet-600 hover:bg-violet-700 text-white font-semibold px-5 py-2.5 rounded-xl">
              Start AI interview
            </button>
          </div>
        )}
        {app.status === 'interview_completed' && (
          <p className="text-indigo-600">Your interview is complete and under review. Thank you!</p>
        )}
        {app.status === 'selected' && (
          <p className="text-emerald-600 font-semibold">🎊 Congratulations! You have been recommended for selection.</p>
        )}
        {app.status === 'rejected' && (
          <p className="text-rose-600">Thank you for your time. You were not selected for this role.</p>
        )}
      </Card>
    </div>
  )
}
