import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import * as authService from '@services/auth.service'
import { storage } from '@utils/storage'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(storage.get('token'))
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    storage.set('token', token)
  }, [token])

  const login = async (email, password) => {
    setLoading(true)
    try {
      const { user: u, token: t } = await authService.login({ email, password })
      setUser(u)
      setToken(t)
      return { user: u, token: t }
    } finally {
      setLoading(false)
    }
  }

  const logout = () => {
    setUser(null)
    setToken(null)
    storage.remove('token')
  }

  const value = useMemo(() => ({ user, token, loading, login, logout, setUser }), [user, token, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthContext() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider')
  return ctx
}
