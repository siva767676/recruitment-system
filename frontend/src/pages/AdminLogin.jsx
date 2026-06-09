import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminLogin } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Alert, Card, Spinner } from '../components/ui.jsx'
import { Field } from './Login.jsx'

export default function AdminLogin() {
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
      const data = await adminLogin(form)
      signIn(data)
      navigate('/admin')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md mx-auto">
      <Card className="p-8 space-y-5">
        <h1 className="text-2xl font-bold">Administrator Login</h1>
        <p className="text-sm text-slate-500">
          Use the predefined admin credentials configured for this system.
        </p>
        <Alert>{error}</Alert>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Admin email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Field label="Password" type="password" value={form.password}
            onChange={(v) => setForm({ ...form, password: v })} />
          <button disabled={loading}
            className="w-full bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white font-semibold py-3 rounded-xl">
            {loading ? <Spinner /> : 'Enter dashboard'}
          </button>
        </form>
        <p className="text-xs text-slate-400 text-center">
          Default (dev): admin@recruit.ai / Admin@123
        </p>
      </Card>
    </div>
  )
}
