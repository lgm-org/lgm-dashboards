import { useState, useMemo, useEffect, useRef } from 'react'
import { format, subDays, startOfMonth, endOfMonth, subMonths, differenceInDays, parseISO, isValid } from 'date-fns'
import { useMergedHealthData }    from '../../hooks/useMergedHealthData'
import { useAccountStatus }       from '../../hooks/useAccountStatus'
import { useDmAgentMap }          from '../../hooks/useDmAgentMap'
import { useRole }                from '../../contexts/RoleContext'
import { scoreAccount, classify, isAtRisk, recommendAction, isUpsellReady, suggestAddon, billableUsers } from '../../lib/healthEngine'
import HealthFilterBar            from './HealthFilterBar'
import HealthSummaryCards         from './HealthSummaryCards'
import ResolutionTrackerHealth    from './ResolutionTrackerHealth'
import NeedsAttentionTable        from './NeedsAttentionTable'
import MasterAccountsTable        from './MasterAccountsTable'
import HealthCharts               from './HealthCharts'
import QuickWins                  from './QuickWins'
import AccountModal               from './AccountModal'
import DmAgentBreakdown           from './DmAgentBreakdown'
import UpsellTable                from './UpsellTable'
import TransactionBreakdown       from './TransactionBreakdown'
import TicketsModal               from './TicketsModal'
import DmFootprintTab             from './DmFootprintTab'
import ChurnMetrics              from './ChurnMetrics'
import LogoChurnChart           from './LogoChurnChart'
import { useLogoChurn }         from '../../hooks/useLogoChurn'

const G = '#8CC63F'

function median(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

function getDateWindow(dateRange) {
  if (dateRange.type === 'all') return { from: '0000-01-01', to: '9999-12-31' }
  const today = new Date()
  if (dateRange.type === 'today')      { const d = format(today, 'yyyy-MM-dd'); return { from: d, to: d } }
  if (dateRange.type === 'yesterday')  { const d = format(subDays(today, 1), 'yyyy-MM-dd'); return { from: d, to: d } }
  if (dateRange.type === 'last_7')     return { from: format(subDays(today, 7), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') }
  if (dateRange.type === 'this_month') return { from: format(startOfMonth(today), 'yyyy-MM-dd'), to: format(endOfMonth(today), 'yyyy-MM-dd') }
  if (dateRange.type === 'last_month') {
    const prev = subMonths(today, 1)
    return { from: format(startOfMonth(prev), 'yyyy-MM-dd'), to: format(endOfMonth(prev), 'yyyy-MM-dd') }
  }
  if (dateRange.type === 'last_30') return { from: format(subDays(today, 30), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') }
  if (dateRange.type === 'last_90') return { from: format(subDays(today, 90), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') }
  if (dateRange.type === 'custom')  return { from: dateRange.from || '0000-01-01', to: dateRange.to || format(today, 'yyyy-MM-dd') }
  return { from: '0000-01-01', to: '9999-12-31' }
}

function timeAgo(date) {
  if (!date) return '—'
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60)  return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

function RefreshIcon({ spinning }) {
  return (
    <svg className={`w-3.5 h-3.5 ${spinning ? 'animate-spin-slow' : ''}`}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
      <path d="M21 3v5h-5"/>
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
      <path d="M8 16H3v5"/>
    </svg>
  )
}

function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-5">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-4 border-brand-border" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-brand-green animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-brand-heading font-semibold text-sm">Loading GHL sub-accounts…</p>
        <p className="text-brand-muted text-[11px] mt-1">Pulling live data from GoHighLevel API</p>
      </div>
    </div>
  )
}

function ErrorBanner({ message, onRetry }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-8 text-center max-w-lg mx-auto my-12">
      <p className="text-3xl mb-3">⚠️</p>
      <h3 className="text-brand-heading font-bold text-base mb-2">Could not load GHL data</h3>
      <p className="text-brand-muted text-sm mb-5">{message}</p>
      <button onClick={onRetry} className="px-5 py-2 rounded-xl text-white text-sm font-semibold"
        style={{ background: G, boxShadow: `0 2px 8px ${G}35` }}>
        Try Again
      </button>
    </div>
  )
}


export default function HealthDashboard({ filters, setFilters }) {
  const { isAdmin }             = useRole()
  const { accounts: raw, loading, stripeLoading, error, lastUpdated, refetch } = useMergedHealthData()
  const { statuses, setStatus } = useAccountStatus()
  const { dmMap, dmLoaded }     = useDmAgentMap()
  const logoChurn               = useLogoChurn()
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [activeSubTab, setActiveSubTab]       = useState('overview')
  const [elapsed, setElapsed] = useState('—')
  const [stripeElapsed, setStripeElapsed] = useState(0)
  const [activitySyncing, setActivitySyncing] = useState(false)
  const [activitySyncDone, setActivitySyncDone] = useState(false)
  const stripeStartRef = useRef(null)
  const needsAttentionRef = useRef(null)
  const masterTableRef = useRef(null)
  const [freshdesk, setFreshdesk] = useState(null)
  const [ticketsModalFilter, setTicketsModalFilter] = useState(null) // null closed · 'open' | 'urgent' | 'all'

  // Upsell "Mark Contacted" state — persisted in localStorage
  const [upsellContacted, setUpsellContacted] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lgm-upsell-contacted') || '{}') } catch { return {} }
  })
  useEffect(() => {
    try { localStorage.setItem('lgm-upsell-contacted', JSON.stringify(upsellContacted)) } catch {}
  }, [upsellContacted])
  const isContacted     = (id) => !!upsellContacted[String(id)]
  const toggleContacted = (id) => setUpsellContacted(prev => {
    const k = String(id)
    if (prev[k]) { const next = { ...prev }; delete next[k]; return next }
    return { ...prev, [k]: new Date().toISOString() }
  })
  const getContactedAt  = (id) => upsellContacted[String(id)] || null

  useEffect(() => {
    let cancelled = false
    const load = () => fetch('/api/freshdesk-summary')
      .then(r => r.json())
      .then(d => { if (!cancelled && !d.error) setFreshdesk(d) })
      .catch(() => {})
    load()
    const id = setInterval(load, 300_000) // 5 min, matches other billing/LC polls
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  useEffect(() => {
    const tick = () => setElapsed(timeAgo(lastUpdated))
    tick()
    const id = setInterval(tick, 15_000)
    return () => clearInterval(id)
  }, [lastUpdated])

  // Count up while Stripe is fetching so the user can see progress
  useEffect(() => {
    if (!stripeLoading) {
      stripeStartRef.current = null
      return
    }
    stripeStartRef.current = Date.now()
    setStripeElapsed(0)
    const id = setInterval(() => {
      if (stripeStartRef.current) {
        setStripeElapsed(Math.floor((Date.now() - stripeStartRef.current) / 1000))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [stripeLoading])

  // Batch-sync GHL contact activity on initial load.
  // Fire-and-forget: processes all accounts in 20-account pages, populates Supabase cache.
  // This powers accurate "last activity" in the main table without needing individual modal opens.
  const syncActivityData = async () => {
    if (activitySyncing) return
    setActivitySyncing(true)
    setActivitySyncDone(false)
    let skip = 0
    let hasMore = true
    while (hasMore) {
      try {
        const r = await fetch(`/api/ghl-sync-activity-batch?skip=${skip}`)
        if (!r.ok) break
        const d = await r.json()
        hasMore = d.hasMore
        skip    = d.nextSkip || skip + 20
      } catch { break }
    }
    setActivitySyncing(false)
    setActivitySyncDone(true)
  }

  useEffect(() => {
    // Auto-sync once per session, 3 seconds after initial data loads
    const timer = setTimeout(() => {
      if (raw.length > 0 && !activitySyncing && !activitySyncDone) {
        syncActivityData()
      }
    }, 3000)
    return () => clearTimeout(timer)
  }, [raw.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSelectedAccount(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Auto-scroll master table into view 800ms after user starts searching
  useEffect(() => {
    if (!filters.search.trim()) return
    const timer = setTimeout(() => {
      masterTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 800)
    return () => clearTimeout(timer)
  }, [filters.search])

  // Enrich with health scores + DM map lookup
  const accounts = useMemo(() =>
    raw.map(a => {
      const { score, parts } = scoreAccount(a)
      const band   = classify(score)
      const action = recommendAction(a)
      const dmEntry = dmMap[a.id] || null
      // DM footprint is authoritative for type: accounts listed there are Agent clients
      // (column name is agent_ghl_location_id). Accounts not in the footprint are DM clients.
      // This overrides Stripe price-detection and Cliff sheet for accounts in the footprint.
      const accountType = dmEntry
        ? 'Agent'
        : (a.accountType !== 'Unknown' ? a.accountType : 'DM')
      return { ...a, accountType, _health: { score, parts, band, action }, _dm: dmEntry }
    }),
    [raw, dmMap]
  )

  // Apply filters
  const filteredAccounts = useMemo(() => {
    const { from, to } = getDateWindow(filters.dateRange)
    const srch = filters.search.toLowerCase().trim()
    const billing = filters.billingFilter || 'all'
    return accounts.filter(a => {
      if (srch && !a.accountName.toLowerCase().includes(srch) &&
          !(a.ghlEmail || '').toLowerCase().includes(srch) &&
          !(a.ghlCity  || '').toLowerCase().includes(srch)) return false
      // Use DM footprint (_dm) as source of truth: in footprint = Agent, not in = DM
      if (filters.typeFilter === 'DM'    && a._dm !== null) return false
      if (filters.typeFilter === 'Agent' && a._dm === null) return false
      if (filters.bandFilter !== 'all' && a._health?.band !== filters.bandFilter) return false
      if (billing === 'matched'          && !a._stripeBound) return false
      if (billing === 'unmatched'        &&  a._stripeBound) return false
      if (billing === 'past_due_or_open' && a.stripeStatus !== 'past_due' && a.stripeStatus !== 'open_invoice') return false
      if (billing === 'canceling'     && !a.stripeCanceling) return false
      if (billing === 'paused_stripe' && a.stripeStatus !== 'paused') return false
      if (billing === 'paused_ghl'    && !a.ghlDisabled) return false
      if (billing === 'paused_both'   && !(a.stripeStatus === 'paused' && a.ghlDisabled)) return false
      if (filters.dateRange.type !== 'all') {
        const d = (a.stripeStartDate || a.ghlDateAdded || '').slice(0, 10)
        if (!d || d < from || d > to) return false
      }
      return true
    })
  }, [accounts, filters])

  // Accounts whose Stripe subscription was cancelled within the active date window
  const cancelledInPeriod = useMemo(() => {
    if (filters.dateRange.type === 'all') return []
    const { from, to } = getDateWindow(filters.dateRange)
    return accounts
      .filter(a => { const d = a.canceledAt || ''; return d && d >= from && d <= to })
      .sort((a, b) => (b.canceledAt || '').localeCompare(a.canceledAt || ''))
  }, [accounts, filters.dateRange])

  const DATE_FILTER_LABELS = {
    today: 'Today', yesterday: 'Yesterday',
    last_7: 'Last 7 Days', this_month: 'This Month', last_month: 'Last Month',
    last_30: 'Last 30 Days', last_90: 'Last 90 Days', custom: 'Custom Range',
  }
  const activeDateLabel = filters.dateRange.type !== 'all'
    ? (DATE_FILTER_LABELS[filters.dateRange.type] || 'Selected Period')
    : null

  // DM/Agent split counts — passed to filter bar so dropdown shows live counts
  const agentCount = useMemo(() => accounts.filter(a => a._dm !== null).length, [accounts])
  const dmCount    = useMemo(() => accounts.filter(a => a._dm === null).length,  [accounts])

  // KPIs — derived from filteredAccounts so DM/Agent/band filters update all numbers
  // Only use lastActivity (real GHL contact data) — not ghlDaysSinceUpdate (settings update, unreliable)
  const activeAccounts = useMemo(() =>
    filteredAccounts.filter(a => { const d = Number(a.lastActivity); return !isNaN(d) && d <= 30 }),
    [filteredAccounts]
  )
  const staleAccounts = useMemo(() =>
    filteredAccounts.filter(isAtRisk).sort((a, b) =>
      (Number(b.lastActivity) || 0) - (Number(a.lastActivity) || 0)
    ),
    [filteredAccounts]
  )

  const { newAccounts, newPeriodLabel } = useMemo(() => {
    const today = new Date()
    const isAllTime = filters.dateRange.type === 'all'
    const from  = isAllTime ? format(subDays(today, 30), 'yyyy-MM-dd') : getDateWindow(filters.dateRange).from
    const to    = isAllTime ? format(today, 'yyyy-MM-dd')              : getDateWindow(filters.dateRange).to
    const label = isAllTime ? 'last 30 days' : ({
      today: 'today', yesterday: 'yesterday',
      last_7: 'last 7 days', this_month: 'this month', last_month: 'last month',
      last_30: 'last 30 days', last_90: 'last 90 days',
    }[filters.dateRange.type] || 'selected period')
    const list = filteredAccounts.filter(a => { const d = a.ghlDateAdded || ''; return d && d >= from && d <= to })
    return { newAccounts: list, newPeriodLabel: label }
  }, [filteredAccounts, filters.dateRange])

  const avgScore = useMemo(() => {
    if (!filteredAccounts.length) return 0
    return filteredAccounts.reduce((s, a) => s + (a._health?.score ?? 0), 0) / filteredAccounts.length
  }, [filteredAccounts])

  const avgTenureDays = useMemo(() => {
    const withDate = filteredAccounts.filter(a => a.ghlDateAdded)
    if (!withDate.length) return 0
    const total = withDate.reduce((s, a) => {
      try {
        const d = parseISO(a.ghlDateAdded)
        return isValid(d) ? s + differenceInDays(new Date(), d) : s
      } catch { return s }
    }, 0)
    return total / withDate.length
  }, [filteredAccounts])

  // Quick Wins: top 3 stale + top 3 newest
  const top3Stale = staleAccounts.slice(0, 3)
  const top3New   = useMemo(() =>
    [...filteredAccounts]
      .filter(a => a.ghlDateAdded)
      .sort((a, b) => (b.ghlDateAdded || '').localeCompare(a.ghlDateAdded || ''))
      .slice(0, 3),
    [filteredAccounts]
  )

  // ── Stripe billing aggregates ────────────────────────────────────────────
  const billedAccounts = useMemo(() =>
    filteredAccounts.filter(a => a._stripeBound && a.totalRev > 0),
    [filteredAccounts]
  )

  const BILLING = useMemo(() => {
    if (!billedAccounts.length) {
      return {
        billedCount: 0, atRisk: 0, healthy: 0, upsellReady: 0,
        riskRevenue: 0, upsellMRR: 0, avgSub: 0, medianSub: 0,
        avgUsers: 0, avgWallet: 0, medianWallet: 0, walletCount: 0, newMRR: 0,
      }
    }
    const today   = new Date()
    const cutoff  = format(subDays(today, 30), 'yyyy-MM-dd')

    const atRiskList   = billedAccounts.filter(a =>
      a._health?.band === 'at_risk' || a.stripeStatus === 'past_due'
    )
    const healthyList  = billedAccounts.filter(a => a._health?.band === 'healthy')
    const upsellList   = billedAccounts.filter(isUpsellReady)
    const newList      = billedAccounts.filter(a => (a.stripeStartDate || '') >= cutoff)
    const withUsers    = billedAccounts.filter(a => billableUsers(a) > 0)

    return {
      billedCount:  billedAccounts.length,
      atRisk:       atRiskList.length,
      healthy:      healthyList.length,
      upsellReady:  upsellList.length,
      riskRevenue:  atRiskList.reduce((s, a) => s + a.totalRev, 0),
      upsellMRR:    upsellList.reduce((s, a) => s + (suggestAddon(a)?.estExtra || 0), 0),
      avgSub:       billedAccounts.reduce((s, a) => s + a.totalRev, 0) / billedAccounts.length,
      medianSub:    median(billedAccounts.map(a => a.totalRev)),
      avgUsers:     withUsers.length
        ? withUsers.reduce((s, a) => s + billableUsers(a), 0) / withUsers.length
        : 0,
      newMRR:       newList.reduce((s, a) => s + a.totalRev, 0),
    }
  }, [billedAccounts])

  // ── DM vs Agent breakdown ────────────────────────────────────────────────
  const dmAgentBreakdown = useMemo(() => {
    const dm    = billedAccounts.filter(a => a.accountType === 'DM')
    const agent = billedAccounts.filter(a => a.accountType !== 'DM')
    const dmRev    = dm.reduce((s, a) => s + a.totalRev, 0)
    const agentRev = agent.reduce((s, a) => s + a.totalRev, 0)
    const total    = dmRev + agentRev
    return {
      dm:    { count: dm.length,    rev: dmRev,    pct: total ? Math.round(dmRev    / total * 100) : 0 },
      agent: { count: agent.length, rev: agentRev, pct: total ? Math.round(agentRev / total * 100) : 0 },
      total,
    }
  }, [billedAccounts])

  const avgHealthDm = useMemo(() => {
    const dm = filteredAccounts.filter(a => a.accountType === 'DM' && a._health?.score != null)
    return dm.length ? Math.round(dm.reduce((s, a) => s + a._health.score, 0) / dm.length) : null
  }, [filteredAccounts])

  const avgHealthAgent = useMemo(() => {
    const ag = filteredAccounts.filter(a => a.accountType !== 'DM' && a._stripeBound && a._health?.score != null)
    return ag.length ? Math.round(ag.reduce((s, a) => s + a._health.score, 0) / ag.length) : null
  }, [filteredAccounts])

  // ── Upsell candidates ────────────────────────────────────────────────────
  const upsellAccounts = useMemo(() =>
    billedAccounts
      .filter(isUpsellReady)
      .sort((a, b) => (suggestAddon(b)?.estExtra || 0) - (suggestAddon(a)?.estExtra || 0)),
    [billedAccounts]
  )

  const top3Upsell = useMemo(() =>
    upsellAccounts.slice(0, 3).map(a => ({ ...a, _upsell: suggestAddon(a) })),
    [upsellAccounts]
  )

  // ── Cohort churn — John's formula: of clients who STARTED in window, how many cancelled
  const churnMetrics = useMemo(() => {
    const today = new Date()
    // Accounts that set cancel_at_period_end but haven't actually cancelled yet
    const scheduledToCancel = filteredAccounts.filter(a => a._stripeBound && a.stripeCanceling && !a.canceledAt)

    const windows = [30, 60, 90].map(days => {
      const cutoff = format(subDays(today, days), 'yyyy-MM-dd')
      // Denominator: Stripe-matched accounts whose billing start falls within the window
      const cohort = filteredAccounts.filter(a => {
        const start = a.stripeStartDate || a.ghlDateAdded || ''
        return a._stripeBound && start >= cutoff
      })
      // Numerator: cohort members who have since cancelled (canceledAt set in Stripe)
      const churnedAccounts = cohort.filter(a => !!a.canceledAt)
      const mrrLost = churnedAccounts.reduce((sum, a) => sum + (a.planPrice || 0), 0)
      const rate = cohort.length > 0
        ? Math.round((churnedAccounts.length / cohort.length) * 1000) / 10
        : null
      return { days, cohortSize: cohort.length, churned: churnedAccounts.length, churnedAccounts, mrrLost, rate }
    })

    return { windows, scheduledToCancel }
  }, [filteredAccounts])

  if (loading && raw.length === 0) return <LoadingScreen />
  if (error   && raw.length === 0) return <ErrorBanner message={error} onRetry={refetch} />

  return (
    <div className="max-w-[1680px] mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-4 sm:space-y-6">

      {/* Data source badge */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 rounded-xl border border-brand-border bg-white text-[11px] text-brand-muted"
        style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <span className="w-1.5 h-1.5 rounded-full bg-brand-green animate-pulse flex-shrink-0" />
        <span>
          <strong className="text-brand-text">{accounts.length} GHL sub-accounts</strong> · GoHighLevel Agency API
        </span>
        <span className="text-brand-border">·</span>
        {isAdmin && stripeLoading ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-purple-300 animate-pulse flex-shrink-0" />
            <span className="text-brand-muted/60 animate-pulse">Loading Stripe billing…</span>
          </>
        ) : isAdmin && billedAccounts.length > 0 ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse flex-shrink-0" />
            <span>
              <strong className="text-brand-text">{billedAccounts.length} matched</strong> to Stripe
            </span>
            {accounts.length - billedAccounts.length > 0 && (
              <>
                <span className="text-brand-border">·</span>
                <span className="text-amber-600 font-semibold">
                  {accounts.length - billedAccounts.length} unmatched
                </span>
              </>
            )}
          </>
        ) : null}
        <span className="ml-auto text-brand-muted/60">{lastUpdated ? `Synced ${elapsed}` : 'Syncing…'}</span>
      </div>

      {/* Sub-header */}
      <div className="flex items-center gap-3">
        <button onClick={refetch}
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border bg-brand-bg text-brand-muted hover:text-brand-text border-brand-border">
          <RefreshIcon spinning={loading} />
          <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
        </button>
        <button
          onClick={syncActivityData}
          disabled={activitySyncing}
          title="Fetch latest GHL contact activity for all accounts and update Last Activity column"
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border bg-brand-bg border-brand-border transition-colors disabled:opacity-50"
          style={{ color: activitySyncDone ? G : '#6B7280' }}
        >
          <RefreshIcon spinning={activitySyncing} />
          <span>{activitySyncing ? 'Syncing activity…' : activitySyncDone ? 'Activity synced ✓' : 'Sync Activity'}</span>
        </button>
        {error && raw.length > 0 && (
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
            ⚠ Auto-refresh failed — showing last known data
          </div>
        )}
      </div>

      {/* Filter bar */}
      <HealthFilterBar
        filters={filters}
        setFilters={setFilters}
        accountTypes={[]}
        totalShowing={filteredAccounts.length}
        totalAll={accounts.length}
        dmCount={dmCount}
        agentCount={agentCount}
      />

      {/* Sub-tab switcher */}
      <div className="flex items-center gap-1 p-0.5 rounded-xl border border-brand-border bg-white w-fit"
        style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        {[
          { key: 'overview',     label: 'Overview' },
          { key: 'dm-footprint', label: `DM Footprint${dmLoaded && Object.keys(dmMap).length > 0 ? '' : ''}` },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveSubTab(tab.key)}
            className="px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-100"
            style={activeSubTab === tab.key
              ? { background: G, color: '#fff', boxShadow: `0 1px 6px ${G}40` }
              : { color: '#6B7280' }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── DM Footprint sub-tab ─────────────────────────────────── */}
      {activeSubTab === 'dm-footprint' && (
        <DmFootprintTab
          accounts={filteredAccounts}
          dmMap={dmMap}
          onAccountClick={setSelectedAccount}
        />
      )}

      {/* ── Overview sub-tab ─────────────────────────────────────── */}
      {activeSubTab === 'overview' && <>

      {/* Stripe sync progress banner — admin only */}
      {isAdmin && stripeLoading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-purple-100 bg-purple-50 text-[12px]"
          style={{ boxShadow: '0 1px 6px rgba(139,92,246,0.07)' }}>
          <div className="w-4 h-4 rounded-full border-2 border-purple-200 border-t-purple-500 animate-spin flex-shrink-0" />
          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-purple-800">Syncing Stripe billing</span>
            <span className="text-purple-400">·</span>
            <span className="text-purple-700 font-mono tabular-nums font-bold">{stripeElapsed}s</span>
            <span className="text-purple-400 hidden sm:inline">·</span>
            <span className="text-purple-500 hidden sm:inline">Billing sections will fill in automatically</span>
          </div>
          <div className="hidden sm:flex items-center gap-4 ml-auto flex-shrink-0">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: '#8CC63F' }}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#8CC63F' }} />
              GHL · {accounts.length} accounts ✓
            </span>
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-600">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse flex-shrink-0" />
              Stripe · fetching…
            </span>
          </div>
        </div>
      )}

      {/* 1. KPI summary cards — live + billing-pending */}
      <HealthSummaryCards
        total={accounts.length}
        filteredCount={filteredAccounts.length < accounts.length ? filteredAccounts.length : null}
        activeCount={activeAccounts.length}
        staleCount={staleAccounts.length}
        newCount={newAccounts.length}
        newPeriodLabel={newPeriodLabel}
        avgScore={avgScore}
        avgTenureDays={avgTenureDays}
        dateFiltered={!!activeDateLabel}
        {...BILLING}
        freshdeskLoaded={!!freshdesk}
        openTickets={freshdesk?.openCount ?? 0}
        pendingTickets={freshdesk?.pendingCount ?? 0}
        urgentTickets={freshdesk?.urgentCount ?? 0}
        onOpenTicketsClick={() => setTicketsModalFilter('open')}
        onPendingTicketsClick={() => setTicketsModalFilter('urgent')}
        onNewClientsClick={() => masterTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        onNeedsCheckinClick={() => needsAttentionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        isAdmin={isAdmin}
      />

      {/* 2. Cohort churn — admin only */}
      {isAdmin && (
        <ChurnMetrics
          metrics={churnMetrics.windows}
          scheduledToCancel={churnMetrics.scheduledToCancel}
          stripeLoading={stripeLoading}
          onAccountClick={setSelectedAccount}
        />
      )}

      {/* 3. Logo Churn — Cliff's monthly model, admin only */}
      {isAdmin && (
        <LogoChurnChart
          data={logoChurn.data}
          loading={logoChurn.loading}
          error={logoChurn.error}
        />
      )}

      {/* 4. Quick Wins — stale, upsell, newest */}
      <QuickWins
        topStale={top3Stale}
        topNew={top3New}
        topUpsell={top3Upsell}
        onAccountClick={setSelectedAccount}
      />

      {/* 4. DM vs Agent breakdown — admin only (contains revenue split) */}
      {isAdmin && (
        <DmAgentBreakdown
          hasBilling={billedAccounts.length > 0}
          stripeLoading={stripeLoading}
          breakdown={dmAgentBreakdown}
          avgHealthDm={avgHealthDm}
          avgHealthAgent={avgHealthAgent}
          onTypeClick={(type) => {
            setFilters(f => ({ ...f, typeFilter: type }))
            setTimeout(() => masterTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
          }}
        />
      )}

      {/* 4. Resolution tracker */}
      <ResolutionTrackerHealth accounts={staleAccounts} statuses={statuses} />

      {/* 5. Needs Attention — stale accounts with outreach tracking */}
      <div ref={needsAttentionRef}>
        <NeedsAttentionTable
          accounts={staleAccounts}
          statuses={statuses}
          setStatus={setStatus}
          onAccountClick={setSelectedAccount}
        />
      </div>

      {/* 6. Upsell table — admin only */}
      {isAdmin && (
        <UpsellTable
          accounts={upsellAccounts}
          hasBilling={billedAccounts.length > 0}
          stripeLoading={stripeLoading}
          isContacted={isContacted}
          toggleContacted={toggleContacted}
          getContactedAt={getContactedAt}
          onAccountClick={setSelectedAccount}
          potentialMRR={BILLING.upsellMRR}
        />
      )}

      {/* 7. Charts — health distribution, join timeline, activity + billing panels */}
      {activeDateLabel && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-semibold"
          style={{ background: '#8CC63F12', border: '1px solid #8CC63F30', color: '#3a6b10' }}>
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#8CC63F' }} />
          Charts &amp; account table below reflect <strong>{activeDateLabel}</strong> · {filteredAccounts.length} of {accounts.length} accounts
        </div>
      )}
      <div className="transition-all duration-300" style={activeDateLabel ? { borderRadius: '1rem', outline: '2px solid rgba(140,198,63,0.45)', outlineOffset: '2px' } : {}}>
        <HealthCharts accounts={filteredAccounts} stripeLoading={stripeLoading} />
      </div>

      {/* 8. Billing breakdown by charge type — admin only */}
      {isAdmin && <TransactionBreakdown accounts={billedAccounts} stripeLoading={stripeLoading} />}

      {/* Churned this period — admin only, only visible when a date filter is active */}
      {isAdmin && cancelledInPeriod.length > 0 && (
        <div className="animate-fade-in-up rounded-2xl border border-red-200 bg-white overflow-hidden"
          style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.04)' }}>
          <div className="px-5 sm:px-6 py-4 border-b border-red-100 flex items-center justify-between gap-3 bg-red-50/40">
            <div>
              <h2 className="text-red-700 font-semibold text-sm flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                Churned — {activeDateLabel}
              </h2>
              <p className="text-red-500 text-[11px] mt-0.5">
                {cancelledInPeriod.length} subscription{cancelledInPeriod.length !== 1 ? 's' : ''} cancelled in this period
                · ${Math.round(cancelledInPeriod.reduce((s, a) => s + a.totalRev, 0)).toLocaleString()}/mo lost
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-red-100 bg-red-50/20">
                  {['Account', 'Cancelled On', 'Last Plan', 'MRR Lost', 'Type', 'Health'].map(h => (
                    <th key={h} className="px-4 py-2.5 first:pl-5 last:pr-5 text-left text-[10px] font-bold uppercase tracking-widest text-red-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-red-50">
                {cancelledInPeriod.map(a => (
                  <tr key={a.id} className="hover:bg-red-50/30 transition-colors">
                    <td className="pl-5 pr-3 py-2.5">
                      <button onClick={() => setSelectedAccount(a)} className="font-medium text-brand-text hover:underline text-left">
                        {a.accountName}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-brand-muted">{a.canceledAt || '—'}</td>
                    <td className="px-4 py-2.5 text-brand-muted">{a.planNickname || '—'}</td>
                    <td className="px-4 py-2.5 font-semibold text-red-600">${Math.round(a.totalRev).toLocaleString()}/mo</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                        a.accountType === 'DM'
                          ? 'bg-blue-50 border-blue-200 text-blue-700'
                          : 'bg-purple-50 border-purple-200 text-purple-700'
                      }`}>{a.accountType || '—'}</span>
                    </td>
                    <td className="px-4 pr-5 py-2.5">
                      <span className="num text-[11px] font-bold px-2 py-0.5 rounded-full"
                        style={{ color: a._health?.band === 'healthy' ? '#8CC63F' : a._health?.band === 'watch' ? '#EAB308' : '#EF4444',
                                 background: a._health?.band === 'healthy' ? '#8CC63F12' : a._health?.band === 'watch' ? '#EAB30812' : '#EF444412' }}>
                        {a._health?.score ?? 0}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 9. Master accounts table */}
      <div
        ref={masterTableRef}
        className="transition-all duration-300"
        style={activeDateLabel ? { borderRadius: '1rem', outline: '2px solid rgba(140,198,63,0.45)', outlineOffset: '2px' } : {}}
      >
        <MasterAccountsTable
          accounts={filteredAccounts}
          dateFiltered={!!activeDateLabel}
          dateLabel={activeDateLabel}
          onAccountClick={setSelectedAccount}
        />
      </div>

      </> /* end Overview sub-tab */}

      {/* Account detail modal — shared across both sub-tabs */}
      {selectedAccount && (
        <AccountModal
          account={selectedAccount}
          onClose={() => setSelectedAccount(null)}
        />
      )}

      {/* Freshdesk ticket drill-down */}
      {ticketsModalFilter && (
        <TicketsModal
          tickets={freshdesk?.tickets ?? []}
          filterStatus={ticketsModalFilter}
          title={ticketsModalFilter === 'open' ? 'Open Tickets' : 'Urgent Tickets'}
          onClose={() => setTicketsModalFilter(null)}
        />
      )}
    </div>
  )
}
