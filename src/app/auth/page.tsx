"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Play, Shield, Lock, CheckCircle, Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google'
import { getToken, verifyToken, googleLogin, logout } from "@/lib/auth"
import { socketManager } from "@/lib/socket"

export default function AuthPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()


  useEffect(() => {
    const token = getToken()

    if (token) {

      verifyToken(token).then(isValid => {
        if (isValid) {
          router.push("/rooms")
        } else {

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


      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))


      const redirectPath = localStorage.getItem('redirectAfterLogin')
      if (redirectPath) {
        
  try {
  const token = getToken();
  socketManager.connect?.({ auth: { token } });
  console.log('___Socket re-used existing connection threater page');
} catch {
  socketManager.connect();
  console.log('___Socket created new connection');
}
        localStorage.removeItem('redirectAfterLogin')
        router.push(redirectPath)
      } else {
        router.push("/rooms")
      }
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
            <h1 className="text-3xl font-bold text-white mb-2">Secure Login</h1>
            <p className="text-gray-300">Sign in safely with your Google account</p>
          </div>

          <Card className="bg-white/10 backdrop-blur-sm border-white/20 hover-lift animate-scaleIn">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <CardTitle className="text-white text-xl">Secure Google Authentication</CardTitle>
              <CardDescription className="text-gray-300">
                Sign in safely with your Google account - no passwords to remember
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {error && (
                <div className="bg-red-500/20 border border-red-500/50 text-red-200 px-4 py-2 rounded-md text-sm animate-fadeInUp">
                  {error}
                </div>
              )}

              <div className="w-full flex justify-center relative">
                {isLoading ? (
                  <div className="flex items-center justify-center space-x-2 bg-blue-600 text-white px-6 py-3 rounded-md min-w-[200px]">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Signing in...</span>
                  </div>
                ) : (
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={handleGoogleError}
                    theme="filled_blue"
                    size="large"
                    text="continue_with"
                    shape="rectangular"
                  />
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-3 text-sm text-gray-300">
                  <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                  <span>Protected by Google's advanced security</span>
                </div>
                <div className="flex items-center space-x-3 text-sm text-gray-300">
                  <Lock className="w-5 h-5 text-blue-400 flex-shrink-0" />
                  <span>Your data is encrypted and secure</span>
                </div>
                <div className="flex items-center space-x-3 text-sm text-gray-300">
                  <CheckCircle className="w-5 h-5 text-purple-400 flex-shrink-0" />
                  <span>No passwords to manage or remember</span>
                </div>
              </div>



              <div className="text-center text-xs text-gray-400 bg-gray-800/30 rounded-lg p-3">
                <Lock className="w-4 h-4 inline mr-1" />
                Your privacy is protected. We only access your basic profile information.
              </div>
            </CardContent>
          </Card>

          <div className="text-center mt-6 animate-fadeInUp delay-700">
            <p className="text-gray-400 text-sm mb-2">
              Trusted by thousands of movie enthusiasts worldwide
            </p>
            <p className="text-gray-500 text-xs">
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
      </div>
    </GoogleOAuthProvider>
  )
}
