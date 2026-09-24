import { useState, useMemo, useEffect } from 'react'
import InfoTip from './InfoTip'
import { useRole } from '../../contexts/RoleContext'
import { billableUsers, isFlagged } from '../../lib/healthEngine'

const G   = '#8CC63F'
const AMB = '#EAB308'
const RED = '#EF4444'

function bandColor(band) {
  if (band === 'healthy') return G
  if (band === 'watch')   return AMB
  if (band === 'no_data') return '#9CA3AF'
  return RED
}

function HealthPill({ score, band }) {
  const c = bandColor(band)
  return (
    <span className="num inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border"
      style={{ color: c, background: `${c}12`, borderColor: `${c}28` }}
      title={band === 'no_data' ? 'No GHL data for this sub-account — no score' : undefined}>
      {score ?? '—'}
    </span>
  )
}

const daysSince = (iso) => iso
  ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
  : null

function ActivityBadge({ days, isAccurate }) {
  if (days === null || days === undefined)
    return <span className="text-brand-muted text-[10px]">—</span>
  const d = Number(days)
  const color = d <= 7 ? G : d <= 30 ? AMB : RED
  const label = d === 0 ? 'Today' : `${d}d`
  return (
    <span className="num inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold border"
      style={{ color, background: `${color}12`, borderColor: `${color}28` }}
      title={isAccurate ? 'From GHL' : 'LC wallet proxy — GHL returned no activity for this account'}>
      {label}
      {isAccurate && <span style={{ color: G, fontSize: '8px' }}>●</span>}
    </span>
  )
}

// Numeric signal pill. Normal: higher is better (good/great thresholds). invert: higher is worse (warnAt/badAt).
function CountBadge({ value, good, great, invert = false, warnAt, badAt }) {
  if (value === null || value === undefined)
    return <span className="text-brand-muted text-[10px]">—</span>
  const n = Number(value)
  const color = invert
    ? (n >= badAt ? RED : n >= warnAt ? AMB : G)
    : (n >= great ? G : n >= good ? AMB : RED)
  return (
    <span className="num inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border"
      style={{ color, background: `${color}12`, borderColor: `${color}28` }}>
      {n}
    </span>
  )
}

function SortIcon({ col, sortCol, sortDir }) {
  if (sortCol !== col) return <span className="text-brand-border ml-0.5 text-[9px]">↕</span>
  return <span className="ml-0.5 text-[9px]" style={{ color: G }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
}

function TypeChip({ type, bound }) {
  if (!bound) return null
  return (
    <span className={`text-[9px] font-bold px-1 py-0.5 rounded border ml-1 ${
      type === 'DM'
        ? 'bg-blue-50 border-blue-200 text-blue-700'
        : 'bg-purple-50 border-purple-200 text-purple-700'
    }`}>{type}</span>
  )
}

function fmtRev(n) { return n > 0 ? `$${Math.round(n).toLocaleString()}` : '—' }
function fmtWallet(n) { return n > 0 ? `$${Math.round(n).toLocaleString()}` : null }

// Columns: 11 total — compact enough for 1280px+ without horizontal scroll
const COLS = [
  { key: 'accountName',        label: 'Account',      sortable: true,  align: 'left',   tip: null },
  { key: 'ghlDateAdded',       label: 'Joined',       sortable: true,  align: 'left',   tip: 'Date this sub-account was created in GHL.' },
  { key: 'stripeStatus',       label: 'Status',       sortable: false, align: 'center', tip: 'Stripe subscription status. Active = paying. Canceled = churned. Past due = payment failed.' },
  { key: 'totalRev',           label: 'Total Rev',    sortable: true,  align: 'right',  tip: 'Total monthly charges from Stripe: base plan + billed user seats + add-ons.' },
  { key: 'planPrice',          label: 'Plan',         sortable: true,  align: 'right',  tip: 'Base monthly plan price from Stripe. "yr" badge = annual plan (billed yearly).' },
  { key: 'addOns',             label: 'Add-ons',      sortable: false, align: 'right',  tip: 'Monthly add-on charges (e.g. LeadFlow AI). $0 = Stripe-matched with no active add-ons — upsell opportunity.' },
  { key: 'lcWalletCharges',    label: 'LC Wallet',    sortable: true,  align: 'right',  tip: 'Cumulative LC platform spend from Cliff\'s data: SMS, AI calls, email, voice. All-time total — not monthly.' },
  { key: 'users',              label: 'Billed Users', sortable: true,  align: 'center', tip: 'Rule: Billed Users = Total Users − 1.\nThe first seat on every account is free; every additional seat is billable at $64/mo.\nTotal users is the seat quantity on the Stripe subscription.' },
  { key: '_estGP',             label: 'Est. GP%',     sortable: false, align: 'right',  tip: 'Estimated gross profit %: (Monthly Revenue − Est. Monthly LC Cost) ÷ Revenue. LC cost is estimated from all-time wallet spend ÷ tenure months. Will be exact once Cliff\'s daily LC sync is live.' },
  { key: '_sig:calls7d',       label: '7-Day Calls',  sortable: true,  align: 'center', tip: 'Calls in the last 7 days — the biggest usage signal (actual human behaviour in LG).\nScore (30 pts): 100+ = 30 · 75–99 = 25 · 50–74 = 20 · 25–49 = 12 · 1–24 = 5 · 0 = 0.\nSource: GHL call conversations (call_log once the n8n call webhook has history).' },
  { key: 'lastCallDate',       label: 'Last Call',    sortable: true,  align: 'center', tip: 'Days since the most recent call in this sub-account.\nScore (15 pts): ≤1d = 15 · 2–3d = 12 · 4–7d = 8 · 8–14d = 4 · 15d+ = 0.' },
  { key: 'lastSaleDate',       label: 'Last Sale',    sortable: true,  align: 'center', tip: 'Days since the most recent opportunity marked Won in GHL.\nScore (25 pts): ≤7d = 25 · 8–14d = 20 · 15–30d = 12 · 31–60d = 5 · 60d+/none = 0.\n⚑ = no won sale in more than 10 days (or none recorded).' },
  { key: '_sig:won30d',        label: 'Sales 30d',    sortable: true,  align: 'center', tip: 'Won opportunities in the last 30 days, with the change vs the prior 30 days.\nScore (15 pts): 10+ = 15 · 6–9 = 12 · 3–5 = 9 · 1–2 = 5 · 0 = 0.\nThe trend % is context only — not scored.' },
  { key: '_sig:tickets7d',     label: 'Tickets 7d',   sortable: true,  align: 'center', tip: 'Freshdesk support tickets created in the last 7 days (Freshdesk company = GHL location id).\nScore (15 pts): 0–1 = 15 · 2 = 12 · 3 = 8 · 4–5 = 4 · 6+ = 0.\nNo Freshdesk company → treated as 0 tickets.' },
  { key: 'lastActivity',       label: 'Last Meaningful', sortable: true, align: 'center', tip: 'Last Meaningful Activity — days since the most recent of: call · new contact created · won sale.\nContact updates are excluded (automations change contacts).\nFalls back to LC wallet charge month only if GHL returns nothing for the sub-account.' },
  { key: '_healthScore',       label: 'Health',       sortable: true,  align: 'center', tip: '100-point score: Platform Activity 45 (7-day calls + last call) · Sales Activity 40 (last sale + sales in 30 days) · Account Health 15 (tickets in 7 days).\nBands: 70+ Healthy · 55–69 Watch · <55 At Risk. — = no GHL data.' },
]

const PAGE_SIZE = 25
const BILLING_COLS = new Set(['stripeStatus', 'totalRev', 'planPrice', 'addOns', 'users', '_estGP'])

export default function MasterAccountsTable({ accounts, dateFiltered = false, dateLabel = null, onAccountClick }) {
  const { isAdmin }           = useRole()
  const [sortCol, setSortCol] = useState('lastActivity')
  const [sortDir, setSortDir] = useState('asc')
  const [page,    setPage]    = useState(1)

  const accountsKey = accounts.length
  useEffect(() => { setPage(1) }, [accountsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const stripeCount  = useMemo(() => accounts.filter(a => a._stripeBound).length, [accounts])
  const lcCount      = useMemo(() => accounts.filter(a => (a.lcWalletCharges ?? 0) > 0).length, [accounts])
  const flaggedCount = useMemo(() => accounts.filter(isFlagged).length, [accounts])
  const visibleCols  = isAdmin ? COLS : COLS.filter(c => !BILLING_COLS.has(c.key))

  function estGP(account) {
    if (!account._stripeBound || !account.totalRev || account.totalRev <= 0) return null
    const lc = account.lcWalletCharges ?? 0
    if (lc <= 0) return null
    const startDate = account.stripeStartDate || account.ghlDateAdded
    if (!startDate) return null
    try {
      const months = Math.max(1, (Date.now() - new Date(startDate + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24 * 30))
      const monthlyLC = lc / months
      const gp = Math.round(((account.totalRev - monthlyLC) / account.totalRev) * 100)
      return gp > 100 ? 100 : gp < -99 ? null : gp
    } catch { return null }
  }

  const sorted = useMemo(() => {
    return [...accounts].sort((a, b) => {
      let av, bv
      if (sortCol === '_healthScore') {
        av = a._health?.score ?? -1; bv = b._health?.score ?? -1
      } else if (sortCol.startsWith('_sig:')) {
        const k = sortCol.slice(5)
        av = a._signals?.[k] ?? -1; bv = b._signals?.[k] ?? -1
      } else if (sortCol === 'lastActivity') {
        av = a.lastActivity ?? 9999; bv = b.lastActivity ?? 9999
      } else if (['totalRev','planPrice','users','lcWalletCharges'].includes(sortCol)) {
        av = a[sortCol] ?? 0; bv = b[sortCol] ?? 0
      } else {
        av = a[sortCol] ?? ''; bv = b[sortCol] ?? ''
      }
      if (typeof av === 'string') av = av.toLowerCase()
      if (typeof bv === 'string') bv = bv.toLowerCase()
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ?  1 : -1
      return 0
    })
  }, [accounts, sortCol, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageData   = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleSort = (col) => {
    const c = COLS.find(c => c.key === col)
    if (!c?.sortable) return
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else {
      setSortCol(col)
      setSortDir(col === 'lastActivity' ? 'asc' : 'desc')
    }
    setPage(1)
  }

  return (
    <div className="animate-fade-in-up rounded-2xl border border-brand-border bg-white"
      style={{ animationDelay: '400ms', boxShadow: '0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.04)' }}>

      <div className="px-4 sm:px-5 py-3.5 border-b border-brand-border flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-start gap-2">
          <div>
            <h2 className="text-brand-heading font-semibold text-sm flex items-center gap-2">
              All Accounts
              {dateFiltered && dateLabel && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                  style={{ color: '#3a6b10', background: `${G}10`, borderColor: `${G}30` }}>
                  {dateLabel}
                </span>
              )}
            </h2>
            <p className="text-brand-muted text-[10px] mt-0.5">
              {accounts.length} sub-accounts
              {isAdmin && stripeCount > 0 && <> · <span className="font-medium" style={{ color: G }}>{stripeCount} Stripe</span> · {accounts.length - stripeCount} unmatched</>}
              {isAdmin && lcCount > 0 && <> · <span className="font-medium" style={{ color: '#7c3aed' }}>{lcCount} with LC spend</span></>}
              {flaggedCount > 0 && <> · <span className="font-medium" style={{ color: AMB }}>⚑ {flaggedCount} with no sale 10+ days</span></>}
              {' '}· click a column to sort · click a row to open details
            </p>
          </div>
          <InfoTip
            text={"Full client portfolio.\nBilling columns (Status, Total Rev, Plan, Add-ons, Billed Users) come live from Stripe for matched accounts.\n7-Day Calls / Last Call / Last Sale / Sales 30d / Tickets 7d are the inputs to the 100-point health score, synced from GHL + Freshdesk on every dashboard load.\n⚑ = no won sale in more than 10 days.\nHover any column header's ? for the exact points behind it."}
            position="top-end"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-brand-border bg-brand-bg/50">
              {visibleCols.map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`px-2 py-2 first:pl-5 last:pr-4 text-[9px] font-bold uppercase tracking-widest whitespace-nowrap select-none text-${col.align} ${
                    col.sortable ? 'cursor-pointer hover:text-brand-heading text-brand-muted' : 'text-brand-muted cursor-default'
                  }`}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {col.label}
                    {col.sortable && <SortIcon col={col.key} sortCol={sortCol} sortDir={sortDir} />}
                    {col.tip && (
                      <span onClick={e => e.stopPropagation()}>
                        <InfoTip text={col.tip} position="bottom-end" />
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length} className="py-10 text-center text-brand-muted text-sm">
                  No accounts match the current filters.
                </td>
              </tr>
            )}
            {pageData.map(a => {
              const bound   = a._stripeBound
              const churned = a.stripeStatus === 'canceled'
              const wallet  = fmtWallet(a.lcWalletCharges)
              const gp      = estGP(a)

              return (
                <tr
                  key={a.id}
                  onClick={() => onAccountClick?.(a)}
                  className="border-b border-brand-border/40 hover:bg-brand-bg/60 cursor-pointer transition-colors duration-100"
                  style={churned ? { background: '#FEF2F210' } : {}}
                >
                  {/* Account Name + Type chip + DM badge */}
                  <td className="pl-5 pr-2 py-2">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-[11px] font-medium text-brand-text truncate max-w-[150px]">{a.accountName}</span>
                      <TypeChip type={a.accountType} bound={bound} />
                      {churned && (
                        <span className="text-[8px] font-bold px-1 py-0.5 rounded border border-red-200 bg-red-50 text-red-600 flex-shrink-0">CHR</span>
                      )}
                      {isAdmin && !bound && (
                        <span
                          title="No Stripe match found for this account — billing columns can't populate until Cliff reconciles it. Not a $0 or broken account, just an unmatched data gap."
                          className="text-[8px] font-bold px-1 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700 flex-shrink-0"
                        >
                          UNMATCHED
                        </span>
                      )}
                    </div>
                    {a._dm?.dmName && (
                      <div className="mt-0.5 flex items-center gap-0.5 text-[9px] font-semibold" style={{ color: G }}>
                        <span>↗</span>
                        <span className="truncate max-w-[140px]">{a._dm.dmName}</span>
                      </div>
                    )}
                  </td>

                  {/* Joined GHL */}
                  <td className="px-2 py-2 text-[10px] text-brand-muted whitespace-nowrap">
                    {a.ghlDateAdded
                      ? new Date(a.ghlDateAdded + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                      : '—'}
                  </td>

                  {/* Billing columns — admin only */}
                  {isAdmin && (
                    <td className="px-2 py-2 text-center">
                      {bound ? (
                        <span className="inline-flex flex-col items-center gap-0.5">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                            a.stripeCanceling                 ? 'bg-amber-50 border-amber-300 text-amber-700' :
                            a.stripeStatus === 'active'       ? 'bg-green-50 border-green-200 text-green-700' :
                            a.stripeStatus === 'trialing'     ? 'bg-blue-50 border-blue-200 text-blue-700' :
                            a.stripeStatus === 'past_due'     ? 'bg-orange-50 border-orange-200 text-orange-700' :
                            a.stripeStatus === 'open_invoice' ? 'bg-amber-50 border-amber-300 text-amber-700' :
                            a.stripeStatus === 'paused'       ? 'bg-yellow-50 border-yellow-300 text-yellow-700' :
                            'bg-red-50 border-red-200 text-red-600'
                          }`}>
                            {a.stripeCanceling ? 'canceling' : a.stripeStatus === 'open_invoice' ? 'open invoice' : (a.stripeStatus ?? '—')}
                          </span>
                          {a.ghlDisabled && (
                            <span className="text-[8px] font-bold px-1 py-0.5 rounded border bg-purple-50 border-purple-200 text-purple-700 whitespace-nowrap">GHL paused</span>
                          )}
                        </span>
                      ) : a.ghlDisabled ? (
                        <span className="text-[8px] font-bold px-1 py-0.5 rounded border bg-purple-50 border-purple-200 text-purple-700 whitespace-nowrap">GHL paused</span>
                      ) : <span className="text-brand-border text-[10px]">—</span>}
                    </td>
                  )}
                  {isAdmin && (
                    <td className="px-2 py-2 text-right">
                      {bound
                        ? <span className="num text-[11px] font-semibold text-brand-text">{fmtRev(a.totalRev)}</span>
                        : <span className="text-brand-border text-[10px]">—</span>}
                    </td>
                  )}
                  {isAdmin && (
                    <td className="px-2 py-2 text-right">
                      {bound ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="num text-[11px] text-brand-text">{fmtRev(a.planPrice)}</span>
                          {a.planInterval === 'year' && (
                            <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700">yr</span>
                          )}
                        </span>
                      ) : <span className="text-brand-border text-[10px]">—</span>}
                    </td>
                  )}
                  {isAdmin && (
                    <td className="px-2 py-2 text-right">
                      {bound ? (
                        a.addOns > 0
                          ? <span className="num text-[11px] text-brand-text">{fmtRev(a.addOns)}</span>
                          : <span className="num text-[10px] text-brand-muted">$0</span>
                      ) : <span className="text-brand-border text-[10px]">—</span>}
                    </td>
                  )}
                  {isAdmin && (
                    <td className="px-2 py-2 text-right">
                      {wallet
                        ? <span className="num text-[11px] font-medium" style={{ color: '#7c3aed' }}>{wallet}</span>
                        : <span className="text-brand-border text-[10px]">—</span>}
                    </td>
                  )}
                  {isAdmin && (
                    <td className="px-2 py-2 text-center">
                      {bound
                        ? <span className="num text-[11px] text-brand-text">{billableUsers(a) > 0 ? billableUsers(a) : '—'}</span>
                        : <span className="text-brand-border text-[10px]">—</span>}
                    </td>
                  )}
                  {isAdmin && (
                    <td className="px-2 py-2 text-right">
                      {gp !== null
                        ? <span className="num text-[10px] font-medium" style={{ color: gp >= 70 ? G : gp >= 40 ? AMB : RED }}>
                            {gp}%
                          </span>
                        : <span className="text-brand-border text-[10px]">—</span>}
                    </td>
                  )}

                  {/* John's signals: 7-day calls · last call · last sale · sales 30d · tickets 7d */}
                  <td className="px-2 py-2 text-center">
                    <CountBadge value={a._signals?.hasGhlData ? a._signals.calls7d : null} good={25} great={75} />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <ActivityBadge days={daysSince(a.lastCallDate)} isAccurate />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <span className="inline-flex items-center gap-1">
                      <ActivityBadge days={daysSince(a.lastSaleDate)} isAccurate />
                      {isFlagged(a) && (
                        <span className="text-[11px] leading-none" style={{ color: AMB }}
                          title="No won sale in more than 10 days">⚑</span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center whitespace-nowrap">
                    <CountBadge value={a._signals?.hasGhlData ? a._signals.won30d : null} good={3} great={10} />
                    {a._signals?.hasGhlData && a._signals.wonPrior30d > 0 && (
                      <span className="num ml-1 text-[9px] font-semibold"
                        style={{ color: a._signals.won30d >= a._signals.wonPrior30d ? G : RED }}
                        title={`Prior 30 days: ${a._signals.wonPrior30d}`}>
                        {a._signals.won30d >= a._signals.wonPrior30d ? '↑' : '↓'}
                        {Math.abs(Math.round(((a._signals.won30d - a._signals.wonPrior30d) / a._signals.wonPrior30d) * 100))}%
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <CountBadge value={a._signals?.hasGhlData ? (a._signals.tickets7d ?? 0) : null} invert warnAt={2} badAt={4} />
                  </td>

                  {/* Last Meaningful Activity — newest of call / new contact / won sale */}
                  <td className="px-2 py-2 text-center">
                    <ActivityBadge
                      days={a.lastActivity}
                      isAccurate={a._lastActivitySource === 'ghl_contact'}
                    />
                  </td>

                  {/* Health Score */}
                  <td className="px-2 pr-4 py-2 text-center">
                    <HealthPill score={a._health?.score ?? null} band={a._health?.band ?? 'no_data'} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="px-5 py-3 border-t border-brand-border flex items-center justify-between">
          <span className="text-[10px] text-brand-muted">
            Page {page} of {totalPages} · {sorted.length} accounts
          </span>
          <div className="flex items-center gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-2.5 py-1 rounded-lg border text-[10px] font-semibold disabled:opacity-40 text-brand-muted border-brand-border hover:bg-brand-bg">
              ← Prev
            </button>
            <button disabled={page === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1 rounded-lg border text-[10px] font-semibold disabled:opacity-40 text-brand-muted border-brand-border hover:bg-brand-bg">
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
