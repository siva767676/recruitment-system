import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { adminApplications, adminJobs } from '../lib/api.js'
import { Alert, Card, ScoreBadge, Spinner, StatusBadge } from '../components/ui.jsx'

export default function AdminApplications() {
  const [params, setParams] = useSearchParams()
  const [apps, setApps] = useState([])
  const [jobs, setJobs] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const jobFilter = params.get('job') || ''
  const statusFilter = params.get('status') || ''

  useEffect(() => {
    adminJobs().then(setJobs).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const q = []
    if (jobFilter) q.push(`job_id=${jobFilter}`)
    if (statusFilter) q.push(`status=${statusFilter}`)
    adminApplications(q.length ? `?${q.join('&')}` : '')
      .then(setApps)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [jobFilter, statusFilter])

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Applications</h1>
      <Alert>{error}</Alert>

      <Card className="p-4 flex flex-wrap gap-4">
        <select value={jobFilter} onChange={(e) => setFilter('job', e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All jobs</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setFilter('status', e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {['applied', 'shortlisted', 'screen_rejected', 'exam_passed', 'exam_failed',
            'interview_completed', 'selected', 'rejected'].map((s) =>
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
      </Card>

      {loading ? (
        <p className="text-slate-500"><Spinner /> Loading…</p>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500 bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3">Candidate</th><th>Job</th><th>Status</th>
                <th>Screen</th><th>Exam</th><th>Interview</th><th></th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium">{a.candidate_name}</p>
                    <p className="text-xs text-slate-400">{a.candidate_email}</p>
                  </td>
                  <td>{a.job_title}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td><ScoreBadge score={a.screening_score} /></td>
                  <td><ScoreBadge score={a.exam_score} /></td>
                  <td><ScoreBadge score={a.interview_score} /></td>
                  <td className="text-right pr-4">
                    <Link to={`/admin/applications/${a.id}`} className="text-indigo-600 font-medium">Review →</Link>
                  </td>
                </tr>
              ))}
              {apps.length === 0 && (
                <tr><td colSpan="7" className="px-4 py-6 text-center text-slate-400">No applications match.</td></tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
