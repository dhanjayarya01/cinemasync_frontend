

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'

export interface User {
  id: string
  email: string
  name: string
  picture?: string
}

export interface AuthResponse {
  success: boolean
  token: string
  user: User
}

export const getCurrentUser = (): User | null => {
  if (typeof window === 'undefined') return null
  
  const userStr = localStorage.getItem('user')
  if (!userStr) return null
  
  try {
    return JSON.parse(userStr)
  } catch {
    return null
  }
}

export const getToken = (): string | null => {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('token')
}

export const isAuthenticated = (): boolean => {
  return getToken() !== null && getCurrentUser() !== null
}


export const logout = (): void => {
  if (typeof window === 'undefined') return
  
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

export const verifyToken = async (token: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/profile`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    })
    return response.ok
  } catch {
    return false
  }
}


export const googleLogin = async (credential: string): Promise<AuthResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ credential })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Authentication failed')
  }

  return response.json()
}


export const logoutFromBackend = async (): Promise<void> => {
  const token = getToken()
  if (!token) return

  try {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    })
  } catch (error) {
    console.error('Logout error:', error)
  } finally {
    logout()
  }
} 