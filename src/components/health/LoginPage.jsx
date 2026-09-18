import { useState } from 'react'

const G = '#8CC63F'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}

export default function LoginPage({ onSuccess }) {
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword]   = useState('')
  const [loading,  setLoading]    = useState(false)
  const [error,    setError]      = useState('')
  const [attempts, setAttempts]   = useState(0)

  // Read any OAuth error from URL params
  const urlError = new URLSearchParams(window.location.search).get('error')
  const oauthErrorMsg = urlError === 'domain_not_allowed'
    ? 'Only @littlegiantmarketing.com accounts are allowed.'
    : urlError && urlError !== '1' ? `Sign-in error: ${urlError}. Try again.` : null

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading || !password.trim()) return

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password }),
      })

      if (res.ok) {
        onSuccess()
      } else {
        const n = attempts + 1
        setAttempts(n)
        setError(n >= 3
          ? 'Incorrect password. Contact your administrator if you need access.'
          : 'Incorrect password. Please try again.'
        )
        setPassword('')
      }
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center px-4">

      {/* Top accent bar */}
      <div className="fixed top-0 left-0 right-0 h-[3px]" style={{ background: G }} />

      <div className="w-full max-w-sm">

        {/* Logo / brand */}
        <div className="text-center mb-8">
          <img
            src="/lgm-logo.png"
            alt="Little Giant Marketing"
            className="h-12 mx-auto mb-4 object-contain"
            onError={e => { e.target.style.display = 'none' }}
          />
          <h1 className="text-brand-heading font-bold text-xl tracking-tight">Customer Health</h1>
          <p className="text-brand-muted text-[13px] mt-1">Internal dashboard — LGM team access only</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-brand-border p-7"
          style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)' }}>

          {/* Google OAuth — primary method */}
          {(oauthErrorMsg) && (
            <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
              {oauthErrorMsg}
            </p>
          )}

          <a
            href="/api/auth-google-start?app=health"
            className="flex items-center justify-center gap-3 w-full rounded-xl border border-brand-border bg-white py-3 text-[14px] font-semibold text-brand-heading hover:bg-brand-bg transition-all"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
          >
            <GoogleIcon />
            Sign in with Google
          </a>

          <p className="text-[11px] text-brand-muted text-center mt-3 mb-5">
            Use your <strong>@littlegiantmarketing.com</strong> account
          </p>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-brand-border" />
            <button
              onClick={() => setShowPassword(v => !v)}
              className="text-[10px] text-brand-muted/60 uppercase tracking-widest hover:text-brand-muted transition-colors"
            >
              {showPassword ? 'hide password' : 'use password'}
            </button>
            <div className="flex-1 h-px bg-brand-border" />
          </div>

          {/* Password fallback — collapsed by default */}
          {showPassword && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                placeholder="Access password"
                autoComplete="current-password"
                autoFocus
                className="w-full rounded-xl border border-brand-border bg-brand-bg px-4 py-3 text-[14px] text-brand-text placeholder-brand-muted/60 outline-none focus:border-[#8CC63F] transition-all"
                disabled={loading}
              />

              {error && (
                <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !password.trim()}
                className="w-full rounded-xl py-3 text-white text-[14px] font-bold tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: loading ? '#aaa' : G }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Verifying…
                  </span>
                ) : 'Sign In'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-[11px] text-brand-muted/50 mt-6">
          Little Giant Marketing &mdash; Internal Use Only
        </p>
      </div>
    </div>
  )
}
