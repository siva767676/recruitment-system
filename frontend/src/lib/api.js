// Thin fetch wrapper. The Vite dev server proxies /api -> backend :8000.
const BASE = '/api'

function token() {
  return localStorage.getItem('rms_token') || ''
}

async function request(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {}
  const tok = token()
  if (tok) headers.Authorization = `Bearer ${tok}`
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json'

  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Cannot reach the backend. Start it on http://127.0.0.1:8000 and retry.')
  }

  if (res.status === 204) return null
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const msg = (data && data.detail) || (typeof data === 'string' && data) || `Request failed (${res.status})`
    throw new Error(msg)
  }
  return data
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  del: (p) => request(p, { method: 'DELETE' }),
  postForm: (p, formData) => request(p, { method: 'POST', body: formData, isForm: true }),
}

// --- auth ---
export const signup = (b) => api.post('/auth/signup', b)
export const login = (b) => api.post('/auth/login', b)
export const adminLogin = (b) => api.post('/auth/admin/login', b)

// --- candidate ---
export const candidateJobs = () => api.get('/candidate/jobs')
export const myApplications = () => api.get('/candidate/applications')
export const getApplication = (id) => api.get(`/candidate/applications/${id}`)
export const applyToJob = (jobId, file) => {
  const fd = new FormData()
  fd.append('resume', file)
  return api.postForm(`/candidate/jobs/${jobId}/apply`, fd)
}
export const startExam = (id) => api.post(`/candidate/applications/${id}/exam/start`)
export const submitExam = (id, answers) => api.post(`/candidate/applications/${id}/exam/submit`, { answers })
export const saveExamDraft = (id, answers) => api.post(`/candidate/applications/${id}/exam/save`, { answers })
export const startInterview = (id) => api.post(`/candidate/applications/${id}/interview/start`)
export const interviewAnswer = (id, threadId, answer) =>
  api.post(`/candidate/applications/${id}/interview/answer`, { thread_id: threadId, answer })

// --- proctoring ---
export const proctorEvent = (id, stage, type, detail = '') =>
  api.post(`/candidate/applications/${id}/proctor/event`, { stage, type, detail })
export const proctorSnapshot = (id, stage, blob) => {
  const fd = new FormData()
  fd.append('stage', stage)
  fd.append('frame', blob, 'frame.jpg')
  return api.postForm(`/candidate/applications/${id}/proctor/snapshot`, fd)
}
export const adminProctor = (id) => api.get(`/admin/applications/${id}/proctor`)
export const adminTerminate = (id, stage, reason) =>
  api.post(`/admin/applications/${id}/terminate`, { stage, reason })
// Snapshots need the auth header, so <img src> can't load them directly —
// fetch as a blob and hand back an object URL.
export const adminSnapshotUrl = async (id, name) => {
  const res = await fetch(`${BASE}/admin/applications/${id}/proctor/snapshots/${name}`, {
    headers: { Authorization: `Bearer ${token()}` },
  })
  if (!res.ok) throw new Error(`Snapshot failed (${res.status})`)
  return URL.createObjectURL(await res.blob())
}

// --- admin ---
export const adminJobs = () => api.get('/admin/jobs')
export const adminCreateJob = (b) => api.post('/admin/jobs', b)
export const adminUpdateJob = (id, b) => api.put(`/admin/jobs/${id}`, b)
export const adminTogglePublish = (id) => api.post(`/admin/jobs/${id}/publish`)
export const adminDeleteJob = (id) => api.del(`/admin/jobs/${id}`)
export const adminCandidates = () => api.get('/admin/candidates')
export const adminApplications = (q = '') => api.get(`/admin/applications${q}`)
export const adminApplicationDetail = (id) => api.get(`/admin/applications/${id}`)
export const adminResume = (id) => api.get(`/admin/applications/${id}/resume`)
export const adminRescreen = (id) => api.post(`/admin/applications/${id}/rescreen`)
export const adminOverrideStatus = (id, status, note) =>
  api.post(`/admin/applications/${id}/status`, { status, note })
export const adminInterview = (id) => api.get(`/admin/interviews/${id}`)
export const adminAnalytics = () => api.get('/admin/analytics')
