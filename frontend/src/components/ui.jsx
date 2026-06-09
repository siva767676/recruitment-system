// Small shared presentational helpers.

const STATUS_STYLES = {
  applied: 'bg-slate-100 text-slate-700',
  screening: 'bg-sky-100 text-sky-700',
  screen_rejected: 'bg-rose-100 text-rose-700',
  shortlisted: 'bg-emerald-100 text-emerald-700',
  exam_in_progress: 'bg-amber-100 text-amber-700',
  exam_completed: 'bg-indigo-100 text-indigo-700',
  exam_passed: 'bg-emerald-100 text-emerald-700',
  exam_failed: 'bg-rose-100 text-rose-700',
  interview_in_progress: 'bg-amber-100 text-amber-700',
  interview_completed: 'bg-indigo-100 text-indigo-700',
  selected: 'bg-emerald-600 text-white',
  rejected: 'bg-rose-600 text-white',
}

export function StatusBadge({ status }) {
  const cls = STATUS_STYLES[status] || 'bg-slate-100 text-slate-700'
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${cls}`}>
      {(status || 'unknown').replace(/_/g, ' ')}
    </span>
  )
}

export function ScoreBadge({ score }) {
  if (score === null || score === undefined) return <span className="text-slate-400">—</span>
  const color = score >= 75 ? 'text-emerald-600' : score >= 50 ? 'text-amber-600' : 'text-rose-600'
  return <span className={`font-bold ${color}`}>{score}</span>
}

export function Card({ children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${className}`}>
      {children}
    </div>
  )
}

export function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 inline" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

export function Alert({ children, kind = 'error' }) {
  if (!children) return null
  const cls =
    kind === 'error'
      ? 'bg-rose-50 border-rose-200 text-rose-700'
      : kind === 'success'
        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
        : 'bg-sky-50 border-sky-200 text-sky-700'
  return <div className={`border rounded-xl px-4 py-3 text-sm ${cls}`}>{children}</div>
}
