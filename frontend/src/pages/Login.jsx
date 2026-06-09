import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { login } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Alert, Card, Spinner } from '../components/ui.jsx'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await login(form)
      signIn(data)
      navigate('/jobs')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md mx-auto">
      <Card className="p-8 space-y-5">
        <h1 className="text-2xl font-bold">Candidate Login</h1>
        <Alert>{error}</Alert>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" type="email" value={form.email}
            onChange={(v) => setForm({ ...form, email: v })} />
          <Field label="Password" type="password" value={form.password}
            onChange={(v) => setForm({ ...form, password: v })} />
          <button disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold py-3 rounded-xl">
            {loading ? <Spinner /> : 'Log in'}
          </button>
        </form>
        <p className="text-sm text-slate-500 text-center">
          No account? <Link to="/signup" className="text-indigo-600 font-medium">Sign up</Link>
          {' · '}
          <Link to="/admin/login" className="text-indigo-600 font-medium">Admin</Link>
        </p>
      </Card>
    </div>
  )
}

export function Field({ label, type = 'text', value, onChange, ...rest }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
        {...rest}
      />
    </label>
  )
}
