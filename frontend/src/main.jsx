import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import Layout from './components/Layout.jsx'
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'
import Signup from './pages/Signup.jsx'
import AdminLogin from './pages/AdminLogin.jsx'
import CandidateJobs from './pages/CandidateJobs.jsx'
import CandidateApplications from './pages/CandidateApplications.jsx'
import ApplicationDetail from './pages/ApplicationDetail.jsx'
import ExamPage from './pages/ExamPage.jsx'
import InterviewPage from './pages/InterviewPage.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'
import AdminJobs from './pages/AdminJobs.jsx'
import AdminApplications from './pages/AdminApplications.jsx'
import AdminApplicationDetail from './pages/AdminApplicationDetail.jsx'

function Protected({ role, children }) {
  const { auth } = useAuth()
  if (!auth) return <Navigate to="/login" replace />
  if (role && auth.role !== role) return <Navigate to="/" replace />
  return children
}

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/admin/login" element={<AdminLogin />} />

        {/* Candidate */}
        <Route path="/jobs" element={<Protected role="candidate"><CandidateJobs /></Protected>} />
        <Route path="/applications" element={<Protected role="candidate"><CandidateApplications /></Protected>} />
        <Route path="/applications/:id" element={<Protected role="candidate"><ApplicationDetail /></Protected>} />
        <Route path="/applications/:id/exam" element={<Protected role="candidate"><ExamPage /></Protected>} />
        <Route path="/applications/:id/interview" element={<Protected role="candidate"><InterviewPage /></Protected>} />

        {/* Admin */}
        <Route path="/admin" element={<Protected role="admin"><AdminDashboard /></Protected>} />
        <Route path="/admin/jobs" element={<Protected role="admin"><AdminJobs /></Protected>} />
        <Route path="/admin/applications" element={<Protected role="admin"><AdminApplications /></Protected>} />
        <Route path="/admin/applications/:id" element={<Protected role="admin"><AdminApplicationDetail /></Protected>} />
      </Route>
    </Routes>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
