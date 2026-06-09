import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'

export default function Layout() {
  const { auth, signOut } = useAuth()
  const navigate = useNavigate()

  const logout = () => {
    signOut()
    navigate('/')
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="font-bold text-lg tracking-tight">
            🎯 Recruitment Management System
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {auth?.role === 'candidate' && (
              <>
                <Link to="/jobs" className="hover:text-indigo-100">Jobs</Link>
                <Link to="/applications" className="hover:text-indigo-100">My Applications</Link>
              </>
            )}
            {auth?.role === 'admin' && (
              <>
                <Link to="/admin" className="hover:text-indigo-100">Dashboard</Link>
                <Link to="/admin/jobs" className="hover:text-indigo-100">Jobs</Link>
                <Link to="/admin/applications" className="hover:text-indigo-100">Applications</Link>
              </>
            )}
            {auth ? (
              <>
                <span className="text-indigo-100">{auth.user?.name}</span>
                <button onClick={logout} className="bg-white/15 hover:bg-white/25 rounded-lg px-3 py-1.5">
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="hover:text-indigo-100">Login</Link>
                <Link to="/signup" className="bg-white text-indigo-700 font-semibold rounded-lg px-3 py-1.5">
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        <Outlet />
      </main>

      <footer className="text-center text-xs text-slate-400 py-6">
        Unified AI Recruitment Platform · Resume Screening + Online Assessment + AI Voice Interview
      </footer>
    </div>
  )
}
