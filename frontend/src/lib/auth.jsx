import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

function load() {
  try {
    const raw = localStorage.getItem('rms_auth')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(load)

  const signIn = ({ token, role, user }) => {
    localStorage.setItem('rms_token', token)
    const value = { token, role, user }
    localStorage.setItem('rms_auth', JSON.stringify(value))
    setAuth(value)
  }

  const signOut = () => {
    localStorage.removeItem('rms_token')
    localStorage.removeItem('rms_auth')
    setAuth(null)
  }

  return (
    <AuthContext.Provider value={{ auth, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
