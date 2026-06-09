import { useEffect, useState } from 'react'
import {
  adminCreateJob, adminDeleteJob, adminJobs, adminTogglePublish, adminUpdateJob,
} from '../lib/api.js'
import { Alert, Card, Spinner } from '../components/ui.jsx'

const EMPTY = {
  title: '', department: 'Engineering', location: 'Remote', description: '',
  required_skills: '', experience_required: 0, published: true,
  screening_cutoff: '', exam_cutoff: '', interview_cutoff: '',
}

export default function AdminJobs() {
  const [jobs, setJobs] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // job id or 'new' or null
  const [form, setForm] = useState(EMPTY)

  const load = () => {
    setLoading(true)
    adminJobs().then(setJobs).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const openNew = () => { setForm(EMPTY); setEditing('new') }
  const openEdit = (j) => {
    setForm({
      ...j,
      required_skills: (j.required_skills || []).join(', '),
      screening_cutoff: j.screening_cutoff ?? '',
      exam_cutoff: j.exam_cutoff ?? '',
      interview_cutoff: j.interview_cutoff ?? '',
    })
    setEditing(j.id)
  }

  const save = async () => {
    setError('')
    const body = {
      title: form.title, department: form.department, location: form.location,
      description: form.description,
      required_skills: form.required_skills.split(',').map((s) => s.trim()).filter(Boolean),
      experience_required: Number(form.experience_required) || 0,
      published: !!form.published,
      screening_cutoff: form.screening_cutoff === '' ? null : Number(form.screening_cutoff),
      exam_cutoff: form.exam_cutoff === '' ? null : Number(form.exam_cutoff),
      interview_cutoff: form.interview_cutoff === '' ? null : Number(form.interview_cutoff),
    }
    try {
      if (editing === 'new') await adminCreateJob(body)
      else await adminUpdateJob(editing, body)
      setEditing(null)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const remove = async (id) => {
    if (!confirm('Delete this job and all its applications?')) return
    await adminDeleteJob(id)
    load()
  }

  if (loading) return <p className="text-slate-500"><Spinner /> Loading…</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Manage Jobs & JDs</h1>
        <button onClick={openNew} className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 rounded-lg">
          + New Job
        </button>
      </div>
      <Alert>{error}</Alert>

      {editing !== null && (
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold">{editing === 'new' ? 'Create job' : 'Edit job'}</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <Inp label="Title" v={form.title} on={(v) => setForm({ ...form, title: v })} />
            <Inp label="Department" v={form.department} on={(v) => setForm({ ...form, department: v })} />
            <Inp label="Location" v={form.location} on={(v) => setForm({ ...form, location: v })} />
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-600">Job Description (JD)</span>
            <textarea rows="8" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 font-mono text-sm" />
          </label>
          <Inp label="Required skills (comma-separated)" v={form.required_skills}
            on={(v) => setForm({ ...form, required_skills: v })} />
          <div className="grid md:grid-cols-4 gap-4">
            <Inp label="Min experience (yrs)" type="number" v={form.experience_required}
              on={(v) => setForm({ ...form, experience_required: v })} />
            <Inp label="Screening cutoff" type="number" v={form.screening_cutoff}
              on={(v) => setForm({ ...form, screening_cutoff: v })} placeholder="default 60" />
            <Inp label="Exam cutoff" type="number" v={form.exam_cutoff}
              on={(v) => setForm({ ...form, exam_cutoff: v })} placeholder="default 50" />
            <Inp label="Interview cutoff" type="number" v={form.interview_cutoff}
              on={(v) => setForm({ ...form, interview_cutoff: v })} placeholder="default 60" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })}
              className="accent-indigo-600" />
            Published (visible to candidates)
          </label>
          <div className="flex gap-3">
            <button onClick={save} className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-2 rounded-lg">Save</button>
            <button onClick={() => setEditing(null)} className="bg-slate-100 hover:bg-slate-200 px-5 py-2 rounded-lg">Cancel</button>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {jobs.map((j) => (
          <Card key={j.id} className="p-5 flex items-center justify-between">
            <div>
              <h3 className="font-semibold">{j.title}
                {!j.published && <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">draft</span>}
              </h3>
              <p className="text-sm text-slate-500">{j.department} · {j.location} · {j.applicant_count} applicants</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => adminTogglePublish(j.id).then(load)}
                className="text-sm border border-slate-300 hover:border-indigo-400 px-3 py-1.5 rounded-lg">
                {j.published ? 'Unpublish' : 'Publish'}
              </button>
              <button onClick={() => openEdit(j)} className="text-sm border border-slate-300 hover:border-indigo-400 px-3 py-1.5 rounded-lg">Edit</button>
              <button onClick={() => remove(j.id)} className="text-sm text-rose-600 px-3 py-1.5 rounded-lg hover:bg-rose-50">Delete</button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function Inp({ label, v, on, type = 'text', placeholder }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <input type={type} value={v} placeholder={placeholder} onChange={(e) => on(e.target.value)}
        className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
    </label>
  )
}
