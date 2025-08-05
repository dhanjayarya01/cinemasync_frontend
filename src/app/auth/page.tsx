"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Play, Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google'
import { getToken, verifyToken, googleLogin, logout } from "@/lib/auth"

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  // Check if user is already logged in
  useEffect(() => {
    const token = getToken()
    
    if (token) {
      // Verify token with backend
      verifyToken(token).then(isValid => {
        if (isValid) {
          router.push("/rooms")
        } else {
          // Token is invalid, clear storage
          logout()
        }
      })
    }
  }, [router])

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setIsLoading(true)
    setError("")

    try {
      const data = await googleLogin(credentialResponse.credential)
      
      // Store token and user data
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
      
      // Redirect to rooms page
      router.push("/rooms")
    } catch (error) {
      console.error('Google login error:', error)
      setError(error instanceof Error ? error.message : 'Failed to authenticate with Google')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleError = () => {
    setError('Google login failed. Please try again.')
    setIsLoading(false)
  }

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    // For now, we'll keep the mock email authentication
    // In a real app, you'd implement email/password authentication
    setTimeout(() => {
      localStorage.setItem(
        "user",
        JSON.stringify({
          id: "2",
          name: name || "User",
          email: email,
          avatar: "/placeholder.svg?height=40&width=40",
        }),
      )
      router.push("/rooms")
    }, 1000)
  }

  return (
    <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''}>
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4 overflow-hidden">
        <div className="w-full max-w-md relative z-10">
          {/* Header */}
          <div className="text-center mb-8 animate-fadeInDown">
            <Link href="/" className="inline-flex items-center space-x-2 mb-6 group">
              <Play className="h-8 w-8 text-purple-400 transition-all duration-300 group-hover:scale-110 group-hover:rotate-12" />
              <span className="text-2xl font-bold text-white transition-colors duration-300 group-hover:text-purple-300">
                CinemaSync
              </span>
            </Link>
            <h1 className="text-3xl font-bold text-white mb-2">{isLogin ? "Welcome Back" : "Create Account"}</h1>
            <p className="text-gray-300">{isLogin ? "Sign in to continue watching" : "Join the movie community"}</p>
          </div>

          <Card className="bg-white/10 backdrop-blur-sm border-white/20 hover-lift animate-scaleIn">
            <CardHeader>
              <CardTitle className="text-white text-center">{isLogin ? "Sign In" : "Sign Up"}</CardTitle>
              <CardDescription className="text-gray-300 text-center">
                {isLogin ? "Enter your credentials to access your account" : "Create your account to get started"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Error Message */}
              {error && (
                <div className="bg-red-500/20 border border-red-500/50 text-red-200 px-4 py-2 rounded-md text-sm animate-fadeInUp">
                  {error}
                </div>
              )}

              {/* Google Login Button */}
              <div className="w-full">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={handleGoogleError}
                  theme="filled_blue"
                  size="large"
                  text="continue_with"
                  shape="rectangular"
                />
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/20" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-transparent px-2 text-gray-400">Or continue with email</span>
                </div>
              </div>

              {/* Email Form */}
              <form onSubmit={handleEmailAuth} className="space-y-4">
                {!isLogin && (
                  <div className="space-y-2 animate-fadeInUp delay-100">
                    <label htmlFor="name" className="text-white text-sm font-medium">
                      Full Name
                    </label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="Enter your full name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required={!isLogin}
                      className="bg-white/10 border-white/20 text-white placeholder:text-gray-400 transition-all duration-300 focus:scale-105"
                    />
                  </div>
                )}

                <div className="space-y-2 animate-fadeInUp delay-200">
                  <label htmlFor="email" className="text-white text-sm font-medium">
                    Email
                  </label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="bg-white/10 border-white/20 text-white placeholder:text-gray-400 transition-all duration-300 focus:scale-105"
                  />
                </div>

                <div className="space-y-2 animate-fadeInUp delay-300">
                  <label htmlFor="password" className="text-white text-sm font-medium">
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="bg-white/10 border-white/20 text-white placeholder:text-gray-400 transition-all duration-300 focus:scale-105"
                  />
                </div>

                {isLogin && (
                  <div className="text-right animate-fadeInUp delay-400">
                    <a href="#" className="text-sm text-purple-300 hover:text-purple-200 transition-colors duration-300">
                      Forgot password?
                    </a>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-purple-600 hover:bg-purple-700 transition-all duration-300 hover:scale-105 animate-fadeInUp delay-500"
                >
                  {isLoading ? (
                    <div className="flex items-center space-x-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{isLogin ? "Signing In..." : "Creating Account..."}</span>
                    </div>
                  ) : (
                    <span>{isLogin ? "Sign In" : "Create Account"}</span>
                  )}
                </Button>
              </form>

              <div className="text-center animate-fadeInUp delay-600">
                <p className="text-gray-300">
                  {isLogin ? "Don't have an account?" : "Already have an account?"}
                  <button
                    onClick={() => setIsLogin(!isLogin)}
                    className="ml-1 text-purple-300 hover:text-purple-200 font-medium transition-colors duration-300"
                  >
                    {isLogin ? "Sign up" : "Sign in"}
                  </button>
                </p>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-gray-400 text-sm mt-6 animate-fadeInUp delay-700">
            By continuing, you agree to our{" "}
            <a href="#" className="text-purple-300 hover:text-purple-200 transition-colors duration-300">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" className="text-purple-300 hover:text-purple-200 transition-colors duration-300">
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </GoogleOAuthProvider>
  )
}
