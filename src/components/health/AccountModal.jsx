import { useEffect, useState, useCallback } from 'react'
import { differenceInDays, parseISO, isValid, format } from 'date-fns'
import { recommendAction, enhancedScoreAccount, classify, billableUsers } from '../../lib/healthEngine'
import GHLInfoPanel from './GHLInfoPanel'
import InfoTip from './InfoTip'
import { useRole } from '../../contexts/RoleContext'

function CopyIdButton({ id }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={copy}
      title="Copy Sub-Account ID"
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-all duration-150"
      style={copied
        ? { color: '#3a6b10', background: '#8CC63F18', borderColor: '#8CC63F50' }
        : { color: '#6B7280', background: '#F4F6F4',   borderColor: '#E5E7E5'   }}
    >
      {copied ? '✓ Copied!' : (
        <>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="5" y="5" width="9" height="9" rx="1.5"/>
            <path d="M11 5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6.5A1.5 1.5 0 0 0 3 11h2"/>
          </svg>
          {id}
        </>
      )}
    </button>
  )
}

const NOISE = /\b(agency|llc|inc|corp|insurance|marketing|services|group|associates|co\.?|ltd|the)\b/gi
function buildGHLQuery(name) {
  return name.replace(NOISE, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' ')
}

const G   = '#8CC63F'
const AMB = '#EAB308'
const RED = '#EF4444'

function bandColor(band) {
  if (band === 'healthy') return G
  if (band === 'watch')   return AMB
  return RED
}
function bandLabel(band) {
  if (band === 'healthy') return 'Active'
  if (band === 'watch')   return 'Watch'
  return 'Inactive'
}

function fmtTs(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtCents(amount, currency = 'usd') {
  if (amount === null || amount === undefined) return '—'
  const sym = currency === 'usd' ? '$' : currency.toUpperCase() + ' '
  return `${sym}${(amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function SubScoreBar({ label, score }) {
  const pct   = Math.round(score ?? 0)
  const color = pct >= 70 ? G : pct >= 40 ? AMB : RED
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-brand-muted">{label}</span>
        <span className="num font-bold" style={{ color }}>{pct}</span>
      </div>
      <div className="h-1.5 rounded-full bg-brand-border overflow-hidden">
        <div className="h-full rounded-full score-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export default function AccountModal({ account, onClose }) {
  const { isAdmin } = useRole()
  const [ghlData,    setGhlData]    = useState(null)
  const [ghlLoading, setGhlLoading] = useState(false)
  const [ghlError,   setGhlError]   = useState(null)

  const [liveMetrics,        setLiveMetrics]        = useState(null)
  const [liveMetricsLoading, setLiveMetricsLoading] = useState(true)
  const [liveMetricsError,   setLiveMetricsError]   = useState(null)

  const [fdTickets,        setFdTickets]        = useState(null)
  const [fdLoading,        setFdLoading]        = useState(true)

  const [lcCharges,        setLcCharges]        = useState(null)
  const [lcLoading,        setLcLoading]        = useState(true)

  const [stripeAcct,        setStripeAcct]        = useState(null)
  const [stripeAcctLoading, setStripeAcctLoading] = useState(false)
  const [stripeAcctError,   setStripeAcctError]   = useState(null)
  const [expandedSubId,     setExpandedSubId]     = useState(null)
  const [expandedInvId,     setExpandedInvId]     = useState(null)
  const [invLoadingMore,    setInvLoadingMore]    = useState(false)
  const [pmtLoadingMore,    setPmtLoadingMore]    = useState(false)

  const fetchGHLInfo = useCallback(async () => {
    if (ghlLoading) return
    setGhlLoading(true)
    setGhlError(null)
    try {
      const q = buildGHLQuery(account.accountName)
      const res = await fetch(`/api/ghl-contact?q=${encodeURIComponent(q)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setGhlData(data)
    } catch (err) {
      setGhlError(err.message)
    } finally {
      setGhlLoading(false)
    }
  }, [account.accountName, ghlLoading])

  // Auto-fetch per-location metrics (users, contacts, opportunities) via OAuth KV
  useEffect(() => {
    if (!account.ghlId) { setLiveMetricsLoading(false); return }
    setLiveMetricsLoading(true)
    setLiveMetricsError(null)
    fetch(`/api/ghl-location-data?locationId=${encodeURIComponent(account.ghlId)}`)
      .then(r => r.json())
      .then(data => { setLiveMetrics(data); setLiveMetricsLoading(false) })
      .catch(err => { setLiveMetricsError(err.message); setLiveMetricsLoading(false) })
  }, [account.ghlId])

  // Auto-fetch Freshdesk support ticket summary
  useEffect(() => {
    if (!account.ghlId) { setFdLoading(false); return }
    setFdLoading(true)
    fetch(`/api/freshdesk-data?locationId=${encodeURIComponent(account.ghlId)}`)
      .then(r => r.json())
      .then(data => { setFdTickets(data); setFdLoading(false) })
      .catch(() => { setFdLoading(false) })
  }, [account.ghlId])

  // Auto-fetch LC wallet charges from Cliff's migrated data
  useEffect(() => {
    if (!account.ghlId) { setLcLoading(false); return }
    setLcLoading(true)
    fetch(`/api/lc-charges?locationId=${encodeURIComponent(account.ghlId)}`)
      .then(r => r.json())
      .then(data => { setLcCharges(data); setLcLoading(false) })
      .catch(() => { setLcLoading(false) })
  }, [account.ghlId])

  // Auto-fetch detailed Stripe subscriptions + invoices for this customer
  useEffect(() => {
    if (!account.stripeCustomerId) return
    setStripeAcctLoading(true)
    setStripeAcctError(null)
    fetch(`/api/stripe-account?customerId=${encodeURIComponent(account.stripeCustomerId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setStripeAcct(data)
      })
      .catch(err => setStripeAcctError(err.message))
      .finally(() => setStripeAcctLoading(false))
  }, [account.stripeCustomerId])

  function loadMoreInvoices() {
    if (!stripeAcct?.lastInvoiceId || invLoadingMore) return
    setInvLoadingMore(true)
    fetch(`/api/stripe-account?customerId=${encodeURIComponent(account.stripeCustomerId)}&invoiceStartingAfter=${stripeAcct.lastInvoiceId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) return
        setStripeAcct(prev => ({
          ...prev,
          invoices:       [...(prev.invoices || []), ...(data.invoices || [])],
          hasMoreInvoices: data.hasMoreInvoices,
          lastInvoiceId:   data.lastInvoiceId,
        }))
      })
      .finally(() => setInvLoadingMore(false))
  }

  function loadMorePayments() {
    if (!stripeAcct?.lastPaymentId || pmtLoadingMore) return
    setPmtLoadingMore(true)
    fetch(`/api/stripe-account?customerId=${encodeURIComponent(account.stripeCustomerId)}&paymentStartingAfter=${stripeAcct.lastPaymentId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) return
        setStripeAcct(prev => ({
          ...prev,
          payments:       [...(prev.payments || []), ...(data.payments || [])],
          hasMorePayments: data.hasMorePayments,
          lastPaymentId:   data.lastPaymentId,
        }))
      })
      .finally(() => setPmtLoadingMore(false))
  }

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  if (!account) return null

  // Use enhanced score when live metrics are loaded, fall back to basic score
  const baseHealth = account._health || { score: 0, parts: {}, band: 'at_risk' }
  const enhanced   = (!liveMetricsLoading && liveMetrics?.oauthConnected)
    ? enhancedScoreAccount(account, liveMetrics)
    : null
  const displayScore = enhanced ?? baseHealth
  const { score, parts } = displayScore
  const band   = classify(score)
  const color  = bandColor(band)
  const action = recommendAction(account)
  const isEnhanced = !!enhanced

  const dateAdded = account.ghlDateAdded
  let tenureDays = null, joinFormatted = null
  if (dateAdded) {
    try {
      const d = parseISO(dateAdded)
      if (isValid(d)) {
        tenureDays    = differenceInDays(new Date(), d)
        joinFormatted = format(d, 'MMM d, yyyy')
      }
    } catch {}
  }

  const initials = account.accountName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  // Activity source: most-recent of GHL dateUpdated and LC wallet latest month
  const activitySource = account._lastActivitySource || (account.lastLcActivityMonth ? 'lc' : 'ghl')
  const lcDays   = account.lastLcActivityMonth ? account.lastActivity : null
  const lcSource = account.lastLcActivityMonth ? `LC · ${account.lastLcActivityMonth}` : null

  const activityLabel = activitySource === 'lc'
    ? `LC Platform Activity (last wallet charge, ${account.lastLcActivityMonth})`
    : 'GHL Sub-Account Activity (last record update)'

  const daysAgo = (iso) => iso
    ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)))
    : null

  // Four GHL activity signals — live from the modal fetch, falling back to the cached values
  const contactUpdatedVal = liveMetrics?.lastContactUpdate  ?? account.lastContactUpdate  ?? null
  const contactCreatedVal = liveMetrics?.lastContactCreated ?? account.lastContactCreated ?? null
  const lastCallVal       = liveMetrics?.lastCallDate       ?? account.lastCallDate       ?? null
  const lastSaleDateVal   = liveMetrics?.lastSaleDate       ?? account.lastSaleDate       ?? null

  const realtimeDays      = daysAgo(contactUpdatedVal)
  const contactCreatedDays = daysAgo(contactCreatedVal)
  const lastCallDays      = daysAgo(lastCallVal)
  const lastSaleDays      = daysAgo(lastSaleDateVal)
  const lastLoginDays     = daysAgo(liveMetrics?.lastLogin)

  const signalRows = [
    { label: 'Last Contact Updated', days: realtimeDays,       date: contactUpdatedVal, note: 'GHL contact record' },
    { label: 'Last Contact Created', days: contactCreatedDays, date: contactCreatedVal, note: 'GHL new contact' },
    { label: 'Last Call',            days: lastCallDays,       date: lastCallVal,       note: 'GHL call conversation' },
    { label: 'Last Sale',            days: lastSaleDays,       date: lastSaleDateVal,   note: 'GHL won opportunity' },
  ].filter(r => r.date)

  // Last Activity = newest of the four GHL signals; LC wallet only when none exist
  const ghlDays   = signalRows.length ? Math.min(...signalRows.map(r => r.days)) : null
  const days      = ghlDays ?? lcDays
  const actSource = ghlDays !== null ? 'GHL activity (newest of contacts / calls / sales)' : lcSource
  const actColor  = days !== null ? (days <= 7 ? G : days <= 30 ? AMB : RED) : undefined

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div className="animate-backdrop-in absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div
        className="animate-modal-enter relative bg-white rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
        style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.20)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-brand-border px-5 sm:px-6 py-4 flex items-center justify-between z-10 rounded-t-2xl">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
              style={{ background: color }}>{initials}</div>
            <div className="min-w-0">
              <h2 className="text-brand-heading font-bold text-base truncate">{account.accountName}</h2>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border"
                  style={{ color, background: `${color}12`, borderColor: `${color}30` }}>
                  {bandLabel(band)}
                </span>
                {days !== null && days !== undefined && (
                  <span className="text-[11px] text-brand-muted">
                    Last active: <span className="font-semibold" style={{ color: actColor }}>
                      {days === 0 ? 'today' : `${days}d ago`}
                    </span>
                    {(ghlDays !== null || lastLoginDays !== null) && (
                      <span className="ml-1 text-[9px] font-semibold px-1 py-0.5 rounded" style={{ background: '#8CC63F15', color: '#3a6b10' }}>
                        live
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-brand-muted hover:text-brand-text hover:bg-brand-bg transition-colors text-base flex-shrink-0">
            ✕
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5 space-y-5">

          {/* Health score */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-brand-bg rounded-xl p-3 border border-brand-border text-center relative">
              <div className="absolute top-2 right-2">
                <InfoTip
                  text={isEnhanced
                    ? `Enhanced score: Activity 30% (most recent of GHL sub-account update or LC wallet charge) · CRM Contacts 40% (how much data is in their system) · Pipeline Opportunities 30% (deals being tracked). Higher = more active client.`
                    : `Activity score: 100 = active today, 90 = last 7 days, 75 = last 2 weeks, 60 = last 30 days, 40 = last 60 days, 20 = last 90 days, 5 = 90+ days. Uses most recent signal: GHL sub-account last updated or LC wallet charge (whichever is more recent). Enhanced score (contacts + pipeline) loads automatically below.`}
                  position="top-end"
                />
              </div>
              <p className="num text-base font-bold" style={{ color }}>{score}/100</p>
              <p className="text-[10px] text-brand-muted uppercase tracking-wider mt-0.5">
                {isEnhanced ? 'Health Score ✦' : 'Health Score'}
              </p>
            </div>
            <div className="bg-brand-bg rounded-xl p-3 border border-brand-border text-center">
              <p className="num text-base font-bold text-brand-text">
                {joinFormatted || '—'}
              </p>
              <p className="text-[10px] text-brand-muted uppercase tracking-wider mt-0.5">Joined GHL</p>
            </div>
          </div>

          {/* Score breakdown */}
          <div className="rounded-xl border border-brand-border p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">Score Breakdown</p>
              {isEnhanced && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#8CC63F18', color: '#3a6b10' }}>
                  ENHANCED
                </span>
              )}
            </div>
            {isEnhanced ? (
              <>
                <SubScoreBar label={`${activityLabel} — 30% of score`} score={parts.activity} />
                <SubScoreBar label="CRM Contacts in their system — 40% of score" score={parts.contacts} />
                <SubScoreBar label="Opportunities / pipeline deals — 30% of score" score={parts.opps} />
              </>
            ) : (
              <SubScoreBar label={activityLabel} score={parts.activity} />
            )}
            <div className="mt-3 pt-3 border-t border-brand-border">
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span className="text-brand-muted font-semibold">Composite</span>
                <span className="num font-bold text-[14px]" style={{ color }}>{score}/100</span>
              </div>
              <div className="h-2 rounded-full bg-brand-border overflow-hidden">
                <div className="h-full rounded-full score-bar-fill" style={{ width: `${score}%`, background: color }} />
              </div>
            </div>
          </div>

          {/* Action */}
          <div className="rounded-xl border px-4 py-3" style={{
            borderColor: `${color}30`, background: `${color}08`
          }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color }}>Recommended Action</p>
            <p className="text-[12px]" style={{ color: band === 'at_risk' ? RED : band === 'watch' ? AMB : '#3a6b10' }}>
              {action}
            </p>
          </div>

          {/* GHL location details */}
          <div className="rounded-xl border border-brand-border p-4 grid grid-cols-2 gap-3 text-[12px]">
            {account.ghlId && (
              <div className="col-span-2 flex flex-wrap items-center gap-2">
                <a
                  href={`https://app.littlegiantmarketing.com/v2/location/${account.ghlId}/dashboard`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors"
                  style={{ color: G, background: `${G}10`, borderColor: `${G}30` }}
                >
                  Open in GHL →
                </a>
                <CopyIdButton id={account.ghlId} />
              </div>
            )}
            <div>
              <p className="text-[10px] text-brand-muted uppercase tracking-wider">
                {ghlDays !== null ? 'Last Active in GHL' : 'Last Active'}
              </p>
              <p className="num font-medium mt-0.5" style={{ color: days !== null ? actColor : undefined }}>
                {days !== null ? (days === 0 ? 'Today' : `${days} days ago`) : '—'}
              </p>
              {actSource && <p className="text-[9px] text-brand-muted/50 mt-0.5 leading-none">{actSource}</p>}
            </div>
            <div>
              <p className="text-[10px] text-brand-muted uppercase tracking-wider">Tenure</p>
              <p className="num font-medium text-brand-text mt-0.5">
                {tenureDays !== null ? `${tenureDays} days` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-brand-muted uppercase tracking-wider">Email</p>
              <p className="font-medium text-brand-text mt-0.5 truncate">{account.ghlEmail || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-brand-muted uppercase tracking-wider">Phone</p>
              <p className="font-medium text-brand-text mt-0.5">{account.ghlPhone || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-brand-muted uppercase tracking-wider">Location</p>
              <p className="font-medium text-brand-text mt-0.5">
                {[account.ghlCity, account.ghlState].filter(Boolean).join(', ') || '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-brand-muted uppercase tracking-wider">Timezone</p>
              <p className="font-medium text-brand-text mt-0.5">{account.ghlTimezone || '—'}</p>
            </div>
            {account.ghlWebsite && (
              <div className="col-span-2">
                <p className="text-[10px] text-brand-muted uppercase tracking-wider">Website</p>
                <a href={account.ghlWebsite} target="_blank" rel="noopener noreferrer"
                  className="font-medium text-brand-text mt-0.5 hover:underline truncate block"
                  style={{ color: G }}>
                  {account.ghlWebsite}
                </a>
              </div>
            )}
          </div>

          {/* Billing — admin only */}
          {isAdmin && <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted mb-2">
              Billing
              <span className="ml-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-full normal-case"
                style={{ background: '#635bff15', color: '#635bff', border: '1px solid #635bff30' }}>
                Stripe
              </span>
            </p>
            {account.stripeCustomerId ? (
              <div className="rounded-xl border border-brand-border overflow-hidden">
                {/* Status + Stripe button row */}
                <div className="px-4 py-3 bg-brand-bg/60 border-b border-brand-border flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {(() => {
                      const s = account.stripeStatus
                      const cfg =
                        s === 'active'       ? { label: 'Active',       bg: '#8CC63F12', color: G,       border: '#8CC63F30' } :
                        s === 'trialing'     ? { label: 'Trialing',     bg: '#3b82f612', color: '#3b82f6', border: '#3b82f630' } :
                        s === 'past_due'     ? { label: 'Past Due',     bg: '#EF444412', color: RED,      border: '#EF444430' } :
                        s === 'open_invoice' ? { label: 'Open Invoice', bg: '#EAB30812', color: AMB,      border: '#EAB30830' } :
                        s === 'unpaid'       ? { label: 'Unpaid',       bg: '#EF444412', color: RED,      border: '#EF444430' } :
                        s === 'paused'       ? { label: 'Paused',       bg: '#6b728012', color: '#6b7280', border: '#6b728030' } :
                        s === 'canceled'     ? { label: 'Canceled',     bg: '#6b728012', color: '#6b7280', border: '#6b728030' } :
                                              { label: s || 'Unknown',  bg: '#6b728012', color: '#6b7280', border: '#6b728030' }
                      return (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border"
                          style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}>
                          {cfg.label}
                        </span>
                      )
                    })()}
                    {account.planNickname && (
                      <span className="text-[11px] text-brand-muted truncate max-w-[160px]">{account.planNickname}</span>
                    )}
                  </div>
                  <a
                    href={`https://dashboard.stripe.com/customers/${account.stripeCustomerId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border flex-shrink-0 transition-colors"
                    style={{ color: '#635bff', background: '#635bff10', borderColor: '#635bff30' }}
                  >
                    View in Stripe →
                  </a>
                </div>
                {/* Revenue breakdown */}
                <div className="grid grid-cols-4 divide-x divide-brand-border border-b border-brand-border">
                  {[
                    { label: 'Total / mo',  value: account.totalRev      > 0 ? `$${Math.round(account.totalRev).toLocaleString()}`      : '—' },
                    { label: 'Base Plan',   value: account.planPrice     > 0 ? `$${Math.round(account.planPrice).toLocaleString()}`     : '—' },
                    { label: `Billable Users (${billableUsers(account)} of ${account.users ?? 0} total · 1st free)`, value: account.monthlyUserSub > 0 ? `$${Math.round(account.monthlyUserSub).toLocaleString()}` : '—' },
                    { label: 'Add-ons',     value: account.addOns        > 0 ? `$${Math.round(account.addOns).toLocaleString()}`        : '—' },
                  ].map(({ label, value }) => (
                    <div key={label} className="px-2 py-2.5 text-center bg-white">
                      <p className="num text-sm font-bold text-brand-text">{value}</p>
                      <p className="text-[10px] text-brand-muted mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
                {/* Start date */}
                <div className="px-4 py-2.5 flex items-center justify-between gap-2 bg-brand-bg/30">
                  <div>
                    <span className="text-[10px] text-brand-muted">Customer since: </span>
                    <span className="text-[11px] font-semibold text-brand-text">
                      {account.stripeStartDate
                        ? new Date(account.stripeStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'}
                    </span>
                  </div>
                </div>

                {/* ── Subscriptions ───────────────────────────────── */}
                <div className="border-t border-brand-border">
                  <p className="px-4 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-muted">
                    Subscriptions
                  </p>
                  {stripeAcctLoading ? (
                    <div className="px-4 py-3 flex items-center gap-2 text-[11px] text-brand-muted">
                      <div className="w-3 h-3 rounded-full border-2 border-brand-border border-t-[#635bff] animate-spin flex-shrink-0" />
                      Loading…
                    </div>
                  ) : stripeAcctError ? (
                    <div className="px-4 py-3 text-[11px] text-red-600">{stripeAcctError}</div>
                  ) : !stripeAcct?.subscriptions?.length ? (
                    <div className="px-4 py-3 text-[11px] text-brand-muted">No subscriptions found.</div>
                  ) : (
                    <div className="divide-y divide-brand-border/50">
                      {stripeAcct.subscriptions.map(sub => {
                        const isOpen = expandedSubId === sub.id
                        const sCfg =
                          sub.status === 'active'    ? { label: 'Active',    color: G,         bg: '#8CC63F12', border: '#8CC63F30' } :
                          sub.status === 'past_due'  ? { label: 'Past Due',  color: RED,       bg: '#EF444412', border: '#EF444430' } :
                          sub.status === 'trialing'  ? { label: 'Trialing',  color: '#3b82f6', bg: '#3b82f612', border: '#3b82f630' } :
                          sub.status === 'canceled'  ? { label: 'Canceled',  color: '#6b7280', bg: '#6b728012', border: '#6b728030' } :
                          sub.status === 'paused'    ? { label: 'Paused',    color: '#6b7280', bg: '#6b728012', border: '#6b728030' } :
                                                       { label: sub.status,  color: '#6b7280', bg: '#6b728012', border: '#6b728030' }
                        const summary = sub.items
                          .map(i => i.quantity > 1 ? `${i.description || 'Plan'} × ${i.quantity}` : (i.description || 'Plan'))
                          .join(' + ')
                        const firstItem = sub.items[0]
                        const frequency = firstItem
                          ? (firstItem.intervalCount === 1
                              ? `Billing ${firstItem.interval}ly`
                              : `Every ${firstItem.intervalCount} ${firstItem.interval}s`)
                          : ''
                        const willCancel = sub.cancelAtPeriodEnd || sub.cancelAt
                        const cancelDate = sub.cancelAt
                          ? fmtTs(sub.cancelAt)
                          : (sub.cancelAtPeriodEnd && sub.currentPeriodEnd ? fmtTs(sub.currentPeriodEnd) : null)
                        const nextDate   = sub.currentPeriodEnd ? fmtTs(sub.currentPeriodEnd) : '—'
                        const nextAmount = sub.items.reduce((sum, i) => sum + (i.unitAmount * i.quantity), 0)
                        const nextInvoice = willCancel
                          ? (cancelDate ? `Cancels ${cancelDate}` : 'Canceling')
                          : (nextAmount > 0 ? `${nextDate} for ${fmtCents(nextAmount)}` : nextDate)
                        return (
                          <div key={sub.id}>
                            <button
                              className="w-full px-4 py-2.5 flex items-start justify-between gap-2 text-left hover:bg-brand-bg/40 transition-colors"
                              onClick={() => setExpandedSubId(isOpen ? null : sub.id)}
                            >
                              <div className="flex items-center gap-2 min-w-0 pt-0.5">
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0"
                                  style={{ color: sCfg.color, background: sCfg.bg, borderColor: sCfg.border }}>
                                  {sCfg.label}
                                </span>
                                {willCancel && cancelDate && (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border flex-shrink-0"
                                    style={{ color: '#f59e0b', background: '#f59e0b12', borderColor: '#f59e0b30' }}>
                                    Cancels {cancelDate}
                                  </span>
                                )}
                                <span className="text-[11px] text-brand-text truncate">{summary}</span>
                              </div>
                              <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-brand-muted">{frequency}</span>
                                  <span className="text-[10px] text-brand-muted">{isOpen ? '▲' : '▼'}</span>
                                </div>
                                {!willCancel && <span className="text-[10px] text-brand-muted">Next: {nextInvoice}</span>}
                              </div>
                            </button>
                            {isOpen && (
                              <div className="bg-brand-bg/60 border-t border-brand-border/50 px-4 py-3 space-y-2">
                                {sub.items.map(item => (
                                  <div key={item.id} className="flex items-center justify-between text-[11px]">
                                    <span className="text-brand-text">{item.description || 'Plan'}</span>
                                    <span className="num font-semibold text-brand-text tabular-nums">
                                      {item.quantity > 1 ? `${item.quantity} × ` : ''}{fmtCents(item.unitAmount, item.currency)}<span className="text-brand-muted font-normal">/{item.interval}</span>
                                    </span>
                                  </div>
                                ))}
                                <div className="pt-1.5 border-t border-brand-border/40 text-[10px] text-brand-muted">
                                  Current period: {fmtTs(sub.currentPeriodStart)} – {fmtTs(sub.currentPeriodEnd)}
                                </div>
                                <a
                                  href={`https://dashboard.stripe.com/subscriptions/${sub.id}`}
                                  target="_blank" rel="noopener noreferrer"
                                  className="text-[10px] font-medium"
                                  style={{ color: '#635bff' }}
                                >
                                  View in Stripe →
                                </a>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* ── Payments ────────────────────────────────────── */}
                <div className="border-t border-brand-border">
                  <p className="px-4 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-muted">
                    Payments
                  </p>
                  {stripeAcctLoading ? (
                    <div className="px-4 py-3 flex items-center gap-2 text-[11px] text-brand-muted">
                      <div className="w-3 h-3 rounded-full border-2 border-brand-border border-t-[#635bff] animate-spin flex-shrink-0" />
                      Loading…
                    </div>
                  ) : !stripeAcct?.payments?.length ? (
                    <div className="px-4 py-3 text-[11px] text-brand-muted">No payments found.</div>
                  ) : (
                    <>
                    <div className="divide-y divide-brand-border/50">
                      {stripeAcct.payments.map(pmt => {
                        const pCfg =
                          pmt.status === 'succeeded' ? { label: 'Succeeded', color: G,        bg: '#8CC63F12', border: '#8CC63F30' } :
                          pmt.status === 'failed'    ? { label: 'Failed',    color: RED,       bg: '#EF444412', border: '#EF444430' } :
                                                       { label: 'Pending',   color: AMB,       bg: '#EAB30812', border: '#EAB30830' }
                        return (
                          <div key={pmt.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="num text-[12px] font-bold text-brand-text tabular-nums flex-shrink-0">
                                {fmtCents(pmt.amount, pmt.currency)}
                              </span>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0"
                                style={{ color: pCfg.color, background: pCfg.bg, borderColor: pCfg.border }}>
                                {pCfg.label}
                              </span>
                              {pmt.description && (
                                <span className="text-[10px] text-brand-muted truncate">{pmt.description}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[10px] text-brand-muted">{fmtTs(pmt.created)}</span>
                              {pmt.receiptUrl && (
                                <a href={pmt.receiptUrl} target="_blank" rel="noopener noreferrer"
                                  className="text-[10px] font-medium flex-shrink-0"
                                  style={{ color: '#635bff' }}>
                                  Receipt →
                                </a>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {stripeAcct.hasMorePayments && (
                      <div className="px-4 py-2.5 border-t border-brand-border/50">
                        <button
                          onClick={loadMorePayments}
                          disabled={pmtLoadingMore}
                          className="text-[11px] font-medium transition-colors disabled:opacity-50"
                          style={{ color: '#635bff' }}
                        >
                          {pmtLoadingMore ? 'Loading…' : 'Load more payments →'}
                        </button>
                      </div>
                    )}
                    </>
                  )}
                </div>

                {/* ── Invoices ────────────────────────────────────── */}
                <div className="border-t border-brand-border">
                  <p className="px-4 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-muted">
                    Invoices
                  </p>
                  {stripeAcctLoading ? (
                    <div className="px-4 py-3 flex items-center gap-2 text-[11px] text-brand-muted">
                      <div className="w-3 h-3 rounded-full border-2 border-brand-border border-t-[#635bff] animate-spin flex-shrink-0" />
                      Loading…
                    </div>
                  ) : !stripeAcct?.invoices?.length ? (
                    <div className="px-4 py-3 text-[11px] text-brand-muted">No invoices found.</div>
                  ) : (
                    <>
                      <div className="divide-y divide-brand-border/50">
                        {stripeAcct.invoices.map(inv => {
                          const isOpen = expandedInvId === inv.id
                          const iCfg =
                            inv.status === 'paid'   ? { label: 'Paid',   color: G,   bg: '#8CC63F12', border: '#8CC63F30' } :
                            inv.status === 'open'   ? { label: 'Open',   color: RED, bg: '#EF444412', border: '#EF444430' } :
                            inv.status === 'draft'  ? { label: 'Draft',  color: '#6b7280', bg: '#6b728012', border: '#6b728030' } :
                                                      { label: inv.status, color: '#6b7280', bg: '#6b728012', border: '#6b728030' }
                          return (
                            <div key={inv.id}>
                              <button
                                className="w-full px-4 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-brand-bg/40 transition-colors"
                                onClick={() => setExpandedInvId(isOpen ? null : inv.id)}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0"
                                    style={{ color: iCfg.color, background: iCfg.bg, borderColor: iCfg.border }}>
                                    {iCfg.label}
                                  </span>
                                  <span className="num text-[11px] font-semibold text-brand-text tabular-nums">{fmtCents(inv.total, inv.currency)}</span>
                                  {inv.number && <span className="text-[10px] text-brand-muted truncate">{inv.number}</span>}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span className="text-[10px] text-brand-muted">{fmtTs(inv.created)}</span>
                                  <span className="text-[10px] text-brand-muted">{isOpen ? '▲' : '▼'}</span>
                                </div>
                              </button>
                              {isOpen && (
                                <div className="bg-brand-bg/60 border-t border-brand-border/50 px-4 py-3 space-y-1.5">
                                  {inv.lines.map(line => (
                                    <div key={line.id} className="flex items-start justify-between gap-2 text-[11px]">
                                      <div className="min-w-0">
                                        <p className="text-brand-text leading-snug">{line.description || '—'}</p>
                                        {line.periodStart && (
                                          <p className="text-[10px] text-brand-muted mt-0.5">
                                            {fmtTs(line.periodStart)} – {fmtTs(line.periodEnd)}
                                          </p>
                                        )}
                                      </div>
                                      <span className="num font-semibold text-brand-text flex-shrink-0 tabular-nums">
                                        {line.quantity > 1 ? `${line.quantity} × ` : ''}{fmtCents(line.amount, line.currency)}
                                      </span>
                                    </div>
                                  ))}
                                  <div className="pt-2 border-t border-brand-border/40 grid grid-cols-3 gap-2 text-[10px]">
                                    {[
                                      { label: 'Subtotal', value: fmtCents(inv.subtotal, inv.currency) },
                                      { label: 'Tax',      value: inv.tax > 0 ? fmtCents(inv.tax, inv.currency) : '—' },
                                      { label: 'Total',    value: fmtCents(inv.total, inv.currency) },
                                    ].map(({ label, value }) => (
                                      <div key={label}>
                                        <p className="text-brand-muted">{label}</p>
                                        <p className="num font-semibold text-brand-text tabular-nums">{value}</p>
                                      </div>
                                    ))}
                                  </div>
                                  {inv.amountRemaining > 0 && (
                                    <p className="text-[10px] font-semibold" style={{ color: RED }}>
                                      Amount remaining: {fmtCents(inv.amountRemaining, inv.currency)}
                                    </p>
                                  )}
                                  {inv.hostedUrl && (
                                    <a href={inv.hostedUrl} target="_blank" rel="noopener noreferrer"
                                      className="text-[10px] font-medium" style={{ color: '#635bff' }}>
                                      View invoice →
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                      {stripeAcct.hasMoreInvoices && (
                        <div className="px-4 py-2.5 border-t border-brand-border/50">
                          <button
                            onClick={loadMoreInvoices}
                            disabled={invLoadingMore}
                            className="text-[11px] font-medium transition-colors disabled:opacity-50"
                            style={{ color: '#635bff' }}
                          >
                            {invLoadingMore ? 'Loading…' : 'Load more invoices →'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-brand-border bg-brand-bg p-3 text-[11px] text-brand-muted">
                No Stripe customer matched for this account.
              </div>
            )}
          </div>}

          {/* Live Metrics — users, contacts, opportunities via OAuth KV */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted mb-2">Live Account Metrics</p>
            {liveMetricsLoading ? (
              <div className="rounded-xl border border-brand-border p-4 flex items-center gap-2 text-[11px] text-brand-muted">
                <div className="w-3.5 h-3.5 rounded-full border-2 border-brand-border border-t-brand-green animate-spin flex-shrink-0" />
                Fetching live data from GHL…
              </div>
            ) : liveMetricsError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[11px] text-red-700">
                Could not load live metrics: {liveMetricsError}
              </div>
            ) : liveMetrics && !liveMetrics.oauthConnected ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-700">
                OAuth token not yet available for this location. Once the marketplace app is installed for this account, metrics will appear here automatically.
              </div>
            ) : liveMetrics ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: 'Team Members',   value: liveMetrics.users,         icon: '👤' },
                  { label: 'Contacts',       value: liveMetrics.contacts,      icon: '📋' },
                  { label: 'Opportunities',  value: liveMetrics.opportunities,  icon: '🎯' },
                  { label: 'Conversations',  value: liveMetrics.conversations,  icon: '💬' },
                ].map(({ label, value, icon }) => (
                  <div key={label} className="bg-brand-bg rounded-xl border border-brand-border p-3 text-center">
                    <div className="text-base mb-0.5">{icon}</div>
                    <p className="num text-sm font-bold text-brand-text">
                      {value === null ? '—' : value.toLocaleString()}
                    </p>
                    <p className="text-[10px] text-brand-muted mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {(signalRows.length > 0 || liveMetrics?.lastLogin) && (
              <div className="mt-2 space-y-1.5">
                {signalRows.map(r => (
                  <div key={r.label} className="px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg/60 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">{r.label}</p>
                      <p className="text-[11px] font-semibold mt-0.5" style={{ color: r.days <= 7 ? G : r.days <= 30 ? AMB : RED }}>
                        {r.days === 0 ? 'Today' : r.days === 1 ? 'Yesterday' : `${r.days} days ago`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-brand-muted">{r.note}</p>
                      <p className="text-[10px] font-medium text-brand-text mt-0.5">
                        {new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                ))}
                {/* Portal login — informational only, not part of Last Activity */}
                {liveMetrics?.lastLogin && (
                  <div className="px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg/60 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">Last Portal Login</p>
                      <p className="text-[11px] font-semibold mt-0.5" style={{ color: lastLoginDays !== null ? (lastLoginDays <= 7 ? G : lastLoginDays <= 30 ? AMB : RED) : undefined }}>
                        {lastLoginDays === 0 ? 'Today' : lastLoginDays === 1 ? 'Yesterday' : `${lastLoginDays} days ago`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-brand-muted">GHL portal access</p>
                      <p className="text-[10px] font-medium text-brand-text mt-0.5">
                        {new Date(liveMetrics.lastLogin).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Freshdesk Support Tickets */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted mb-2">
              Support Tickets
              <span className="ml-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-full normal-case"
                style={{ background: '#22c55e12', color: '#15803d', border: '1px solid #22c55e30' }}>
                Freshdesk
              </span>
            </p>
            {fdLoading ? (
              <div className="rounded-xl border border-brand-border p-4 flex items-center gap-2 text-[11px] text-brand-muted">
                <div className="w-3.5 h-3.5 rounded-full border-2 border-brand-border border-t-brand-green animate-spin flex-shrink-0" />
                Loading support tickets…
              </div>
            ) : !fdTickets || !fdTickets.found ? (
              <div className="rounded-xl border border-brand-border bg-brand-bg p-3 text-[11px] text-brand-muted">
                No support account found in Freshdesk for this client.
              </div>
            ) : (
              <div className="rounded-xl border border-brand-border overflow-hidden">
                <div className="grid grid-cols-4 divide-x divide-brand-border">
                  {[
                    { label: 'Open', value: fdTickets.openCount, color: fdTickets.openCount > 0 ? RED : G },
                    { label: 'Pending', value: fdTickets.pendingCount, color: fdTickets.pendingCount > 0 ? AMB : null },
                    { label: 'Urgent', value: fdTickets.urgentCount, color: fdTickets.urgentCount > 0 ? RED : null },
                    { label: 'Total', value: fdTickets.totalCount, color: null },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="px-3 py-2.5 text-center bg-brand-bg/40">
                      <p className="num text-sm font-bold" style={{ color: color || 'inherit' }}>{value}</p>
                      <p className="text-[10px] text-brand-muted mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
                {fdTickets.avgSentiment !== null && (
                  <div className="px-4 py-2.5 border-t border-brand-border flex items-center justify-between bg-white">
                    <span className="text-[11px] text-brand-muted">Avg Sentiment</span>
                    <span className="num text-[11px] font-bold" style={{
                      color: fdTickets.avgSentiment >= 70 ? G : fdTickets.avgSentiment >= 40 ? AMB : RED
                    }}>
                      {fdTickets.avgSentiment}/100
                    </span>
                  </div>
                )}
                {fdTickets.lastTicketAt && (
                  <div className="px-4 py-2 border-t border-brand-border flex items-center justify-between bg-brand-bg/30">
                    <span className="text-[10px] text-brand-muted">Last ticket</span>
                    <span className="text-[10px] text-brand-muted">
                      {new Date(fdTickets.lastTicketAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                )}
                {fdTickets.recentOpen?.length > 0 && (
                  <div className="border-t border-brand-border/50">
                    <p className="px-4 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-wider text-brand-muted/70">
                      Open / Pending Tickets
                    </p>
                    <div className="divide-y divide-brand-border/30">
                      {fdTickets.recentOpen.map(t => (
                        <div key={t.id} className="px-4 py-2 flex items-center justify-between gap-2 bg-white hover:bg-brand-bg/30 transition-colors">
                          <p className="text-[11px] text-brand-text leading-snug flex-1 min-w-0 truncate">{t.subject}</p>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {t.priority >= 3 && (
                              <span className="text-[8px] font-bold px-1 py-0.5 rounded border"
                                style={{ color: RED, background: '#EF444412', borderColor: '#EF444430' }}>
                                {t.priority === 4 ? 'URGENT' : 'HIGH'}
                              </span>
                            )}
                            <span className={`text-[9px] font-semibold px-1 py-0.5 rounded ${t.status === 2 ? 'text-red-600' : 'text-amber-600'}`}>
                              {t.status === 2 ? 'Open' : 'Pending'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* LC Platform Usage */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted mb-2">
              LC Platform Usage
              <span className="ml-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-full normal-case"
                style={{ background: '#8CC63F12', color: '#3a6b10', border: '1px solid #8CC63F30' }}>
                Wallet charges
              </span>
            </p>
            {lcLoading ? (
              <div className="rounded-xl border border-brand-border p-4 flex items-center gap-2 text-[11px] text-brand-muted">
                <div className="w-3.5 h-3.5 rounded-full border-2 border-brand-border border-t-brand-green animate-spin flex-shrink-0" />
                Loading LC charges…
              </div>
            ) : !lcCharges || !lcCharges.hasData ? (
              <div className="rounded-xl border border-brand-border bg-brand-bg p-3 text-[11px] text-brand-muted">
                No LC wallet charges found for this account.
              </div>
            ) : (
              <div className="rounded-xl border border-brand-border overflow-hidden">
                <div className="px-4 py-2.5 bg-brand-bg/60 border-b border-brand-border flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-brand-text">Total charges (all time)</span>
                  <span className="num text-[13px] font-bold text-brand-text">${lcCharges.totalAmount.toLocaleString()}</span>
                </div>
                <div className="divide-y divide-brand-border">
                  {lcCharges.breakdown.map(row => (
                    <div key={row.type} className="px-4 py-2 flex items-center justify-between bg-white hover:bg-brand-bg/30 transition-colors">
                      <div>
                        <p className="text-[11px] font-medium text-brand-text">{row.type}</p>
                        <p className="text-[10px] text-brand-muted">{row.count.toLocaleString()} transactions · latest {row.latestMonth}</p>
                      </div>
                      <span className="num text-[12px] font-bold text-brand-text">${row.amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Call Intelligence */}
          {account.callStats ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted mb-2">
                Call Intelligence
                <span className="ml-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-full normal-case"
                  style={{ background: '#8CC63F12', color: '#3a6b10', border: '1px solid #8CC63F30' }}>
                  AI Team Assistant
                </span>
              </p>
              <div className="rounded-xl border border-brand-border overflow-hidden">
                {/* Summary stats */}
                <div className="grid grid-cols-3 divide-x divide-brand-border border-b border-brand-border">
                  {[
                    { label: 'Total Calls',  value: account.callStats.totalCalls,     color: null },
                    { label: 'Avg Score',    value: account.callStats.avgScore > 0 ? `${account.callStats.avgScore}/10` : '—', color: account.callStats.avgScore >= 7 ? G : account.callStats.avgScore >= 5 ? AMB : RED },
                    { label: 'Frustrated',   value: account.callStats.frustratedCount > 0 ? account.callStats.frustratedCount : '0', color: account.callStats.frustratedCount > 0 ? RED : G },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="px-3 py-2.5 text-center bg-brand-bg/40">
                      <p className="num text-sm font-bold" style={{ color: color || 'inherit' }}>{value}</p>
                      <p className="text-[10px] text-brand-muted mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
                {/* Last call + risk */}
                <div className="px-4 py-2.5 flex items-center justify-between gap-2 text-[11px] border-b border-brand-border/50 bg-white">
                  <div>
                    <span className="text-brand-muted">Last call:</span>
                    <span className="font-semibold text-brand-text ml-1">{account.callStats.lastCallDate || '—'}</span>
                    <span className="text-brand-muted ml-1">by</span>
                    <span className="text-brand-text ml-1">{account.callStats.lastCallEmployee}</span>
                    <span className="ml-1 text-brand-muted">· {account.callStats.lastCallCategory}</span>
                  </div>
                  {account.callStats.riskLevel && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0"
                      style={{
                        color:       account.callStats.riskLevel === 'High' ? RED : account.callStats.riskLevel === 'Medium' ? AMB : G,
                        background:  account.callStats.riskLevel === 'High' ? '#EF444412' : account.callStats.riskLevel === 'Medium' ? '#EAB30812' : '#8CC63F12',
                        borderColor: account.callStats.riskLevel === 'High' ? '#EF444430' : account.callStats.riskLevel === 'Medium' ? '#EAB30830' : '#8CC63F30',
                      }}>
                      {account.callStats.riskLevel} Risk
                    </span>
                  )}
                </div>
                {/* Category breakdown */}
                {Object.keys(account.callStats.categories).length > 0 && (
                  <div className="px-4 py-2.5 flex flex-wrap gap-1.5 border-b border-brand-border/50 bg-white">
                    {Object.entries(account.callStats.categories).sort((a,b) => b[1]-a[1]).map(([cat, cnt]) => (
                      <span key={cat} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-bg border border-brand-border text-brand-muted">
                        {cat} ×{cnt}
                      </span>
                    ))}
                  </div>
                )}
                {/* Recent calls */}
                <div className="divide-y divide-brand-border/50">
                  {account.callStats.recentCalls.map((c, i) => (
                    <div key={c.meetingId || i} className="px-4 py-2.5 bg-white">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-[11px] font-semibold text-brand-text">{c.date}</span>
                        <div className="flex items-center gap-1.5">
                          {c.score > 0 && (
                            <span className="num text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ color: c.score >= 7 ? G : c.score >= 5 ? AMB : RED,
                                       background: c.score >= 7 ? '#8CC63F12' : c.score >= 5 ? '#EAB30812' : '#EF444412' }}>
                              {c.score}/10
                            </span>
                          )}
                          {c.frustrated && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600">
                              Frustrated
                            </span>
                          )}
                          <span className="text-[10px] text-brand-muted">{c.category}</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-brand-muted leading-relaxed line-clamp-2">{c.summary}</p>
                      {c.actionItems && (
                        <p className="text-[10px] text-amber-700 mt-1 leading-relaxed line-clamp-1">
                          Action: {c.actionItems}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted mb-2">Call Intelligence</p>
              <div className="rounded-xl border border-brand-border px-4 py-3 text-[11px] text-brand-muted bg-brand-bg/40">
                No call records found for this account. Calls are matched by client name from the AI Team Assistant dashboard.
              </div>
            </div>
          )}

          {/* Live GHL CRM */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted mb-2">CRM Contact Lookup</p>
            <GHLInfoPanel
              data={ghlData}
              loading={ghlLoading}
              error={ghlError}
              onFetch={fetchGHLInfo}
            />
          </div>

        </div>
      </div>
    </div>
  )
}
