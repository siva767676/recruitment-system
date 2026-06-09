import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { applyToJob, candidateJobs } from '../lib/api.js'
import { Alert, Card, Spinner, StatusBadge } from '../components/ui.jsx'

export default function CandidateJobs() {
  const [jobs, setJobs] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [applyingId, setApplyingId] = useState(null)
  const fileInputs = useRef({})
  const navigate = useNavigate()

  const load = () => {
    setLoading(true)
    candidateJobs()
      .then(setJobs)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const apply = async (jobId) => {
    const file = fileInputs.current[jobId]?.files?.[0]
    if (!file) {
      setError('Please choose a resume file first.')
      return
    }
    setError('')
    setApplyingId(jobId)
    try {
      const res = await applyToJob(jobId, file)
      navigate(`/applications/${res.application.id}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setApplyingId(null)
    }
  }

  if (loading) return <p className="text-slate-500"><Spinner /> Loading jobs…</p>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Open Positions</h1>
      <Alert>{error}</Alert>
      {jobs.length === 0 && <p className="text-slate-500">No open positions right now.</p>}
      <div className="grid md:grid-cols-2 gap-5">
        {jobs.map((job) => (
          <Card key={job.id} className="p-6 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{job.title}</h2>
                <p className="text-sm text-slate-500">
                  {job.department} · {job.location}
                </p>
              </div>
              {job.applied && <StatusBadge status={job.application_status} />}
            </div>
            <div className="flex flex-wrap gap-1">
              {job.required_skills.slice(0, 8).map((s) => (
                <span key={s} className="text-[11px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">{s}</span>
              ))}
            </div>
            <p className="text-sm text-slate-600 line-clamp-3 whitespace-pre-line">
              {job.description.slice(0, 220)}…
            </p>
            {job.applied ? (
              <button onClick={() => navigate(`/applications`)}
                className="text-sm text-indigo-600 font-medium">
                View your application →
              </button>
            ) : (
              <div className="flex items-center gap-2 pt-1">
                <input type="file" accept=".pdf,.docx,.txt,.md"
                  ref={(el) => (fileInputs.current[job.id] = el)}
                  className="text-sm flex-1" />
                <button onClick={() => apply(job.id)} disabled={applyingId === job.id}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-sm font-semibold px-4 py-2 rounded-lg whitespace-nowrap">
                  {applyingId === job.id ? <Spinner /> : 'Apply'}
                </button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
