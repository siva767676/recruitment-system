import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signup } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Alert, Card, Spinner } from '../components/ui.jsx'
import { Field } from './Login.jsx'

export default function Signup() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await signup(form)
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
        <h1 className="text-2xl font-bold">Create your candidate account</h1>
        <Alert>{error}</Alert>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Field label="Phone (optional)" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label="Password (min 6 chars)" type="password" value={form.password}
            onChange={(v) => setForm({ ...form, password: v })} />
          <button disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold py-3 rounded-xl">
            {loading ? <Spinner /> : 'Sign up'}
          </button>
        </form>
        <p className="text-sm text-slate-500 text-center">
          Already have an account? <Link to="/login" className="text-indigo-600 font-medium">Log in</Link>
        </p>
      </Card>
    </div>
  )
}
