import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { myApplications } from '../lib/api.js'
import { Alert, Card, ScoreBadge, Spinner, StatusBadge } from '../components/ui.jsx'

export default function CandidateApplications() {
  const [apps, setApps] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    myApplications()
      .then(setApps)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-slate-500"><Spinner /> Loading…</p>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Applications</h1>
      <Alert>{error}</Alert>
      {apps.length === 0 && (
        <p className="text-slate-500">
          You haven't applied yet. <Link to="/jobs" className="text-indigo-600">Browse jobs →</Link>
        </p>
      )}
      <div className="space-y-4">
        {apps.map((a) => (
          <Card key={a.id} className="p-5 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">{a.job_title}</h2>
              <div className="flex items-center gap-4 text-sm text-slate-500 mt-1">
                <span>Screening: <ScoreBadge score={a.screening_score} /></span>
                <span>Exam: <ScoreBadge score={a.exam_score} /></span>
                <span>Interview: <ScoreBadge score={a.interview_score} /></span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <StatusBadge status={a.status} />
              <Link to={`/applications/${a.id}`} className="text-indigo-600 font-medium text-sm">
                Open →
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
