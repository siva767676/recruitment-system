import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { adminAnalytics } from '../lib/api.js'
import { Alert, Card, Spinner } from '../components/ui.jsx'

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#ec4899']

export default function AdminDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    adminAnalytics().then(setData).catch((e) => setError(e.message))
  }, [])

  if (error) return <Alert>{error}</Alert>
  if (!data) return <p className="text-slate-500"><Spinner /> Loading analytics…</p>

  const statusData = Object.entries(data.status_breakdown || {}).map(([name, value]) => ({
    name: name.replace(/_/g, ' '), value,
  }))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Recruitment Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Stat label="Candidates" value={data.total_candidates} />
        <Stat label="Open Jobs" value={data.published_jobs} sub={`${data.total_jobs} total`} />
        <Stat label="Applications" value={data.total_applications} />
        <Stat label="Avg Screening" value={data.avg_screening_score} />
        <Stat label="Selected" value={data.selected} accent />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="font-semibold mb-4">Pipeline status breakdown</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" outerRadius={90} label>
                {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold mb-4">Applicants per job</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.per_job}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="title" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="applicants" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="selected" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="p-6">
        <h3 className="font-semibold mb-4">Jobs overview</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500 border-b">
            <tr><th className="py-2">Role</th><th>Applicants</th><th>In pipeline</th><th>Selected</th><th></th></tr>
          </thead>
          <tbody>
            {data.per_job.map((j) => (
              <tr key={j.job_id} className="border-b border-slate-100">
                <td className="py-2 font-medium">{j.title}</td>
                <td>{j.applicants}</td>
                <td>{j.shortlisted}</td>
                <td className="text-emerald-600 font-semibold">{j.selected}</td>
                <td className="text-right">
                  <Link to={`/admin/applications?job=${j.job_id}`} className="text-indigo-600">View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function Stat({ label, value, sub, accent }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500 uppercase">{label}</p>
      <p className={`text-2xl font-bold ${accent ? 'text-emerald-600' : 'text-slate-800'}`}>{value ?? '—'}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </Card>
  )
}
