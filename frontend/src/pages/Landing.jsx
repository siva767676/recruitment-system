import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { Card } from '../components/ui.jsx'

const STEPS = [
  ['1. Sign up & apply', 'Create an account, upload your resume, and apply to an open role.'],
  ['2. Automated screening', 'Your resume is parsed and scored against the job description in seconds.'],
  ['3. Online assessment', 'Shortlisted candidates take a dynamically generated test built from their resume + JD.'],
  ['4. AI voice interview', 'Qualified candidates have a natural, voice-based interview with an AI interviewer.'],
  ['5. Decision', 'Scores and reports feed a final recommendation — with full admin oversight.'],
]

export default function Landing() {
  const { auth } = useAuth()

  return (
    <div className="space-y-10">
      <section className="text-center space-y-4 py-8">
        <h1 className="text-4xl font-extrabold text-slate-800">
          Hire smarter with an end-to-end AI recruiter
        </h1>
        <p className="text-slate-500 max-w-2xl mx-auto">
          From application to final recommendation — resume screening, dynamic assessments,
          and a human-like AI voice interview, fully automated with admin control.
        </p>
        <div className="flex justify-center gap-3 pt-2">
          {auth?.role === 'candidate' ? (
            <Link to="/jobs" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl">
              Browse Jobs
            </Link>
          ) : auth?.role === 'admin' ? (
            <Link to="/admin" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl">
              Open Dashboard
            </Link>
          ) : (
            <>
              <Link to="/signup" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl">
                Get started as a candidate
              </Link>
              <Link to="/admin/login" className="bg-white border border-slate-300 hover:border-indigo-400 text-slate-700 font-semibold px-6 py-3 rounded-xl">
                Admin login
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="grid md:grid-cols-5 gap-4">
        {STEPS.map(([title, desc]) => (
          <Card key={title} className="p-5">
            <h3 className="font-semibold text-indigo-700 mb-2">{title}</h3>
            <p className="text-sm text-slate-500">{desc}</p>
          </Card>
        ))}
      </section>
    </div>
  )
}
