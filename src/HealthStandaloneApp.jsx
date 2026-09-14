import { useState, useEffect } from 'react'
import { RoleContext } from './contexts/RoleContext'
import HealthDashboard from './components/health/HealthDashboard'
import JarvisChat      from './components/health/JarvisChat'
import LoginPage       from './components/health/LoginPage'

const COOKIE = 'lgm-health-auth'
function getSessionCookie() {
  return document.cookie
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(COOKIE + '='))
    ?.slice(COOKIE.length + 1) || null
}

// Decode role from Google OAuth cookie (format: g.{base64url(email:role)}.{sig})
function getRoleFromCookie(cookie) {
  if (!cookie) return 'admin'
  if (cookie.startsWith('g.')) {
    try {
      const payload = cookie.split('.')[1]
      const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
      const role    = decoded.split(':')[1]
      return role === 'account_manager' ? 'account_manager' : 'admin'
    } catch { return 'admin' }
  }
  return 'admin'  // old password cookie → always admin
}

function LogoMark() {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <img
        src="/lgm-logo.png"
        alt="Little Giant Marketing"
        className="h-8 sm:h-9 w-auto flex-shrink-0 object-contain"
        onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
      />
      <div className="flex-shrink-0 items-center gap-2 hidden" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 44 44" fill="none">
          <circle cx="22" cy="22" r="16" stroke="#4A4A4A" strokeWidth="6" fill="none"/>
          <path d="M29.3 12.7 A11 11 0 1 0 33 22 L23 22"
            stroke="#8CC63F" strokeWidth="4" strokeLinecap="round" fill="none"/>
        </svg>
      </div>
      <div className="hidden sm:block leading-tight min-w-0">
        <p className="shimmer-text text-[10px] font-extrabold tracking-[0.2em] uppercase leading-none">
          Little Giant Marketing
        </p>
        <p className="text-brand-heading font-semibold text-[14px] leading-tight mt-0.5 truncate">
          Customer Health
        </p>
      </div>
      <p className="sm:hidden text-brand-heading font-semibold text-[13px] whitespace-nowrap">
        Customer Health
      </p>
    </div>
  )
}

function DashboardShell({ onSignOut }) {
  const [activeTab, setActiveTab] = useState('health')
  const [healthFilters, setHealthFilters] = useState({
    search: '', typeFilter: 'all', bandFilter: 'all', billingFilter: 'all',
    dateRange: { type: 'all', from: '', to: '' },
  })

  const tabs = [
    { id: 'health', label: 'Customer Health' },
    { id: 'jarvis', label: '✦ Jarvis' },
  ]

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text">
      <header className="sticky top-0 z-50 bg-white border-b border-brand-border"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderTop: '3px solid #8CC63F' }}>
        <div className="max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 h-[60px] flex items-center justify-between gap-4">
          <LogoMark />
          {/* Tab switcher */}
          <div className="flex items-center bg-brand-bg rounded-xl p-1 border border-brand-border">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                  activeTab === t.id
                    ? 'bg-white text-brand-heading shadow-sm border border-brand-border'
                    : 'text-brand-muted hover:text-brand-heading'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={onSignOut}
            className="text-[11px] text-brand-muted hover:text-brand-heading transition-colors px-3 py-1.5 rounded-lg hover:bg-brand-bg border border-transparent hover:border-brand-border"
          >
            Sign out
          </button>
        </div>
      </header>

      {activeTab === 'health' && (
        <HealthDashboard filters={healthFilters} setFilters={setHealthFilters} />
      )}
      {activeTab === 'jarvis' && (
        <JarvisChat />
      )}

      <footer className="mt-12 py-5 border-t border-brand-border text-center text-[11px] text-brand-muted/60 tracking-widest uppercase">
        Little Giant Marketing &mdash; Customer Health Dashboard
      </footer>
    </div>
  )
}

// ─── Auth app — Google OAuth + cookie-based role ──────────────────────────────
function AuthApp() {
  const params      = new URLSearchParams(window.location.search)
  const loginForced = params.get('login') === '1'
  const cookie      = getSessionCookie()
  const [authed, setAuthed] = useState(!loginForced && !!cookie)

  function handleLoginSuccess() {
    setAuthed(true)
    const url = new URL(window.location.href)
    url.searchParams.delete('login')
    url.searchParams.delete('error')
    window.history.replaceState({}, '', url.toString())
  }

  if (!authed) return <LoginPage onSuccess={handleLoginSuccess} />

  const role = getRoleFromCookie(getSessionCookie())
  return (
    <RoleContext.Provider value={{ role, isAdmin: role === 'admin', isLoaded: true }}>
      <DashboardShell onSignOut={() => { window.location.href = '/api/auth?logout=1' }} />
    </RoleContext.Provider>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function HealthStandaloneApp() {
  useEffect(() => { document.title = 'LGM — Customer Health Dashboard' }, [])
  return <AuthApp />
}
