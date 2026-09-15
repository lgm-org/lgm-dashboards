import { lazy, Suspense, useState, useMemo, useCallback } from 'react'
import TeamLoginPage from './components/TeamLoginPage'

// VITE_APP_MODE=health is set on the lgm-customer-health Vercel project.
// VITE_APP_MODE=master is set on the Master Dashboard Vercel project (GHL-embedded).
// When either build runs, this file short-circuits and renders that standalone app.
// lgm-dashboard (QC) has no VITE_APP_MODE set, so it falls through to the full app.
//
// These two MUST stay lazy imports, not static ones. A static `import
// HealthStandaloneApp from './HealthStandaloneApp'` at the top of this file
// pulls in its whole dependency tree — including src/lib/supabase.js, which
// calls createClient() at module-load time using VITE_SUPABASE_URL/ANON_KEY.
// ES modules run that top-level code on import regardless of which mode
// actually renders, so Master mode was crashing on Health's Supabase client
// before React ever mounted, even though Master mode never uses it. Lazy
// imports code-split each app into its own chunk that only loads when
// actually rendered, so each mode is isolated from the others' env vars
// and dependencies.
const HealthStandaloneApp = lazy(() => import('./HealthStandaloneApp'))
const MasterStandaloneApp = lazy(() => import('./MasterStandaloneApp'))

const IS_HEALTH_MODE = import.meta.env.VITE_APP_MODE === 'health'
const IS_MASTER_MODE = import.meta.env.VITE_APP_MODE === 'master'

import { useEmployeeHealthSheet } from './hooks/useEmployeeHealthSheet'
import { useCallStatus }          from './hooks/useCallStatus'
import { useCoachingStatus }      from './hooks/useCoachingStatus'

import {
  filterCalls, getPrevCalls, calcSummary, aggregateEmployees,
  calcTopPerformer, buildChartData, calcQuickStats, getFrustratedCalls,
} from './lib/ehUtils'

import Header              from './components/Header'
import SummaryCards        from './components/SummaryCards'
import QuickStats          from './components/QuickStats'
import TopPerformer        from './components/TopPerformer'
import EmployeeTable       from './components/EmployeeTable'
import NeedCoaching        from './components/NeedCoaching'
import MeetingsChart       from './components/MeetingsChart'
import VerdictDistribution from './components/VerdictDistribution'
import CategoryPerformance from './components/CategoryPerformance'
import BehaviorInsights    from './components/BehaviorInsights'
import ResolutionTracker   from './components/ResolutionTracker'
import MissedCallsTracker  from './components/MissedCallsTracker'
import FrustratedTable     from './components/FrustratedTable'
import ActivityFeed        from './components/ActivityFeed'
import CallDetailModal     from './components/modals/CallDetailModal'
import EmployeeDetailModal from './components/modals/EmployeeDetailModal'
import CoachingModal       from './components/modals/CoachingModal'
import { ActiveCallsBar } from './components/ActiveCallsBar'

// ─── Loading / Error screens ──────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center gap-5">
      <div className="relative w-14 h-14">
        <div className="absolute inset-0 rounded-full border-4 border-brand-border" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-brand-green animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-brand-heading font-semibold text-base">Loading dashboard…</p>
        <p className="text-brand-muted text-sm mt-1">Fetching data from Google Sheets</p>
      </div>
    </div>
  )
}

function ErrorScreen({ message, onRetry }) {
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-brand-border p-8 max-w-lg w-full text-center"
        style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-brand-heading font-bold text-lg mb-2">Could not load data</h2>
        <p className="text-brand-muted text-sm leading-relaxed mb-6">{message}</p>
        <div className="bg-brand-bg rounded-xl p-4 text-left mb-6 text-xs text-brand-muted space-y-1.5">
          <p className="font-semibold text-brand-heading text-[11px] uppercase tracking-wider mb-2">Quick checklist</p>
          <p>1. Open the sheet → <strong>File → Share → Publish to web</strong></p>
          <p>2. Choose <strong>Entire Document</strong> + <strong>CSV</strong> → Publish</p>
          <p>3. Also set sharing to <strong>Anyone with the link can view</strong></p>
        </div>
        <button onClick={onRetry} className="px-6 py-2.5 rounded-xl text-white text-sm font-semibold"
          style={{ background: '#8CC63F', boxShadow: '0 2px 8px rgba(140,198,63,0.35)' }}>
          Try Again
        </button>
      </div>
    </div>
  )
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────
const TEAM_COOKIE = 'lgm-team-auth'
function getTeamCookie() {
  return document.cookie
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(TEAM_COOKIE + '='))
    ?.slice(TEAM_COOKIE.length + 1) || null
}

// ─── Router — picks which app to render ───────────────────────────────────────
export default function App() {
  if (IS_HEALTH_MODE) return <Suspense fallback={null}><HealthStandaloneApp /></Suspense>
  if (IS_MASTER_MODE) return <Suspense fallback={null}><MasterStandaloneApp /></Suspense>

  const cookie = getTeamCookie()
  if (!cookie) return <TeamLoginPage />

  return <QCDashboard />
}

// ─── QC Dashboard — all hooks live here (never conditionally skipped) ─────────
function QCDashboard() {
  // ── QC state ────────────────────────────────────────────────────────────────
  const [filter, setFilter]                 = useState({ type: 'today', from: '', to: '' })
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [employeeFilter, setEmployeeFilter] = useState('all')
  const [searchQuery, setSearchQuery]       = useState('')

  const [modalStack, setModalStack] = useState([])
  const currentModal = modalStack.length > 0 ? modalStack[modalStack.length - 1] : null
  const canGoBack    = modalStack.length > 1
  const pushModal  = useCallback((m) => setModalStack(s => [...s, m]), [])
  const popModal   = useCallback(()  => setModalStack(s => s.slice(0, -1)), [])
  const closeAll   = useCallback(()  => setModalStack([]), [])

  const { statuses, setStatus } = useCallStatus()
  const { statuses: coachingStatuses, toggleRec: toggleCoachingRec, isCoachingComplete, resetEmployee: resetCoaching, markAllComplete: markAllCoachingComplete } = useCoachingStatus()

const { calls, loading, error, lastUpdated, refetch, retrying } = useEmployeeHealthSheet()

  // ── QC derived data ─────────────────────────────────────────────────────────
  const allCategories = useMemo(() => {
    const cats = new Set(calls.map(c => c.category).filter(Boolean))
    return [...cats].sort()
  }, [calls])

  const allEmployees = useMemo(() => {
    const emps = new Set(calls.map(c => c.employee).filter(Boolean))
    return [...emps].sort()
  }, [calls])

  const filteredCalls = useMemo(() => {
    let result = filterCalls(calls, filter)
    if (categoryFilter !== 'all') result = result.filter(c => c.category === categoryFilter)
    if (employeeFilter !== 'all') result = result.filter(c => c.employee === employeeFilter)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(c =>
        c.employee?.toLowerCase().includes(q) ||
        c.customer?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q) ||
        c.meetingId?.toLowerCase().includes(q) ||
        c.date?.includes(q) ||
        c.finalVerdict?.toLowerCase().includes(q) ||
        c.status?.toLowerCase().includes(q) ||
        c.summary?.toLowerCase().includes(q)
      )
    }
    return result
  }, [calls, filter, categoryFilter, employeeFilter, searchQuery])

  const prevCalls = useMemo(() => getPrevCalls(calls, filter), [calls, filter])

  const summary         = useMemo(() => calcSummary(filteredCalls),             [filteredCalls])
  const prevSummary     = useMemo(() => calcSummary(prevCalls),                 [prevCalls])
  const employees       = useMemo(() => aggregateEmployees(filteredCalls),      [filteredCalls])
  const topPerformer    = useMemo(() => calcTopPerformer(filteredCalls),        [filteredCalls])
  const chartData       = useMemo(() => buildChartData(filteredCalls, filter),  [filteredCalls, filter])
  const quickStats      = useMemo(() => calcQuickStats(filteredCalls, prevCalls, filter), [filteredCalls, prevCalls, filter])
  const frustratedCalls = useMemo(() => getFrustratedCalls(filteredCalls),      [filteredCalls])

  const coachingNeeded = useMemo(() =>
    employees.filter(e => e.coaching > 0 && !isCoachingComplete(e.name, e.coachingRecs?.length)).length
  , [employees, isCoachingComplete])

  const recentActivity = useMemo(() =>
    [...calls].sort((a, b) => b._rowIdx - a._rowIdx).slice(0, 15),
    [calls]
  )

  const canCompare = prevCalls.length >= 3 && !['all', 'today', 'yesterday', 'custom'].includes(filter.type)
  const trends = useMemo(() => ({
    total:      canCompare ? (summary.total      - prevSummary.total)      : null,
    positive:   canCompare ? (summary.positive   - prevSummary.positive)   : null,
    frustrated: canCompare ? (summary.frustrated - prevSummary.frustrated) : null,
  }), [summary, prevSummary, canCompare])

  if (loading && calls.length === 0) return <LoadingScreen />
  if (error   && calls.length === 0) return <ErrorScreen message={error} onRetry={refetch} />

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text">
      <Header
        filter={filter}           setFilter={setFilter}
        categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} allCategories={allCategories}
        employeeFilter={employeeFilter} setEmployeeFilter={setEmployeeFilter} allEmployees={allEmployees}
        searchQuery={searchQuery}  setSearchQuery={setSearchQuery}
        searchResultCount={searchQuery.trim() ? filteredCalls.length : null}
        lastUpdated={lastUpdated}  onRefresh={refetch}
        isRefreshing={loading}     retrying={retrying} dataError={error}
        onSignOut={() => { window.location.href = '/api/auth-team-logout' }}
      />

      <ActiveCallsBar />

      <div className="max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {error && calls.length > 0 && (
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
              <span>⚠️</span>
              <span>Auto-refresh failed — showing last known data.{' '}
                <button onClick={refetch} className="underline font-medium">Retry</button>
              </span>
            </div>
          )}

          {!loading && filteredCalls.length === 0 && calls.length > 0 && (
            <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 flex items-center gap-2">
              <span>📅</span>
              <span>No calls match the current filters. Try adjusting the date range or clearing filters.</span>
            </div>
          )}

          <div className="flex gap-7 items-start">
            <div className="flex-1 min-w-0 space-y-6">
              <SummaryCards summary={summary} trends={trends} />
              <QuickStats stats={quickStats} coachingNeeded={coachingNeeded} />

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="flex flex-col gap-6">
                  <TopPerformer performer={topPerformer} onEmployeeClick={(n) => pushModal({ type: 'employee', id: n })} />
                  <NeedCoaching
                    employees={employees}
                    onEmployeeClick={(n) => pushModal({ type: 'employee', id: n })}
                    onCoachingClick={(n) => pushModal({ type: 'coaching', id: n })}
                    isComplete={isCoachingComplete}
                    onClearAll={() => markAllCoachingComplete(employees)}
                  />
                </div>
                <div className="lg:col-span-2">
                  <EmployeeTable
                    employees={employees}
                    onEmployeeClick={(n) => pushModal({ type: 'employee', id: n })}
                    onCoachingClick={(n) => pushModal({ type: 'coaching', id: n })}
                  />
                </div>
              </div>

              <MeetingsChart data={chartData} />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <VerdictDistribution calls={filteredCalls} />
                <CategoryPerformance calls={filteredCalls} />
              </div>

              <BehaviorInsights calls={filteredCalls} />
              <MissedCallsTracker />
              <ResolutionTracker calls={frustratedCalls} statuses={statuses} />
              <FrustratedTable
                calls={frustratedCalls}
                statuses={statuses}
                setStatus={setStatus}
                onEmployeeClick={(n)  => pushModal({ type: 'employee', id: n })}
                onCallClick={(mid)    => pushModal({ type: 'call',     id: mid })}
              />
            </div>

            <aside className="hidden xl:flex flex-col w-[320px] flex-shrink-0 sticky top-20">
              <ActivityFeed
                calls={recentActivity}
                onEmployeeClick={(n)  => pushModal({ type: 'employee', id: n })}
                onCallClick={(mid)    => pushModal({ type: 'call',     id: mid })}
              />
            </aside>
          </div>
        </div>

      <footer className="mt-12 py-5 border-t border-brand-border text-center text-[11px] text-brand-muted/60 tracking-widest uppercase">
        Little Giant Marketing &mdash; Team AI Assistant
      </footer>

      {/* ── Modal stack (QC tab) ───────────────────────────────────────────── */}
      {currentModal?.type === 'employee' && (
        <EmployeeDetailModal
          key={currentModal.id}
          employeeName={currentModal.id}
          allCalls={calls}
          filter={filter}
          onClose={closeAll}
          onBack={canGoBack ? popModal : null}
          onCallClick={(mid)    => pushModal({ type: 'call',     id: mid })}
          onCoachingClick={(n)  => pushModal({ type: 'coaching', id: n })}
          statuses={statuses}
          setStatus={setStatus}
        />
      )}
      {currentModal?.type === 'call' && (
        <CallDetailModal
          key={currentModal.id}
          meetingId={currentModal.id}
          allCalls={calls}
          onClose={closeAll}
          onBack={canGoBack ? popModal : null}
          onEmployeeClick={(name) => pushModal({ type: 'employee', id: name })}
        />
      )}
      {currentModal?.type === 'coaching' && (
        <CoachingModal
          key={currentModal.id}
          employeeName={currentModal.id}
          allCalls={calls}
          coachingStatuses={coachingStatuses}
          onToggleRec={toggleCoachingRec}
          onResetCoaching={resetCoaching}
          onClose={closeAll}
          onBack={canGoBack ? popModal : null}
          onEmployeeClick={(name) => pushModal({ type: 'employee', id: name })}
        />
      )}
    </div>
  )
}
