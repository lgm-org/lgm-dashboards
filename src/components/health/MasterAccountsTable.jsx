import { useState, useMemo, useEffect } from 'react'
import InfoTip from './InfoTip'
import { useRole } from '../../contexts/RoleContext'
import { billableUsers } from '../../lib/healthEngine'

const G   = '#8CC63F'
const AMB = '#EAB308'
const RED = '#EF4444'

function bandColor(band) {
  if (band === 'healthy') return G
  if (band === 'watch')   return AMB
  return RED
}

function HealthPill({ score, band }) {
  const c = bandColor(band)
  return (
    <span className="num inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border"
      style={{ color: c, background: `${c}12`, borderColor: `${c}28` }}>
      {score}
    </span>
  )
}

function ActivityBadge({ days }) {
  if (days === null || days === undefined)
    return <span className="text-brand-muted text-[10px]">—</span>
  const d = Number(days)
  const color = d <= 7 ? G : d <= 10 ? AMB : RED
  const label = d === 0 ? 'Today' : `${d}d`
  return (
    <span className="num inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border"
      style={{ color, background: `${color}12`, borderColor: `${color}28` }}>
      {label}
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
  { key: 'users',              label: 'Billed Users', sortable: true,  align: 'center', tip: 'Billable user seats (total users minus 1 free admin seat). First user on every account is free.' },
  { key: '_estGP',             label: 'Est. GP%',     sortable: false, align: 'right',  tip: 'Estimated gross profit %: (Monthly Revenue − Est. Monthly LC Cost) ÷ Revenue. LC cost is estimated from all-time wallet spend ÷ tenure months. Will be exact once Cliff\'s daily LC sync is live.' },
  { key: 'lastActivity',       label: 'Last Update',  sortable: true,  align: 'center', tip: 'Days since last detected platform signal — whichever is more recent: LC wallet charge month-end, or GHL sub-account settings update. Green ≤ 7d · Amber 8–10d · Red > 10d. ⚠ This is NOT user-login activity — GHL does not expose login timestamps via API. Click an account to see real-time CRM & portal-login data.' },
  { key: '_healthScore',       label: 'Health',       sortable: true,  align: 'center', tip: 'Health score 0–100 based on GHL activity recency. 70+ = Healthy · 40–69 = Watch · <40 = At-Risk. Click any row to see the full breakdown.' },
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
        av = a._health?.score ?? 0; bv = b._health?.score ?? 0
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
              {' '}· click a column to sort · click a row to open details
            </p>
          </div>
          <InfoTip
            text="Full client portfolio. Billing columns (Type, Total Rev, Plan, Add-ons, Users) pull live from Stripe for matched accounts. LC Wallet = cumulative platform spend from Cliff's data. Email, location, transactions, GP, and multi-location are in each account's detail modal."
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

                  {/* Last Activity */}
                  <td className="px-2 py-2 text-center">
                    <ActivityBadge
                      days={a.lastActivity ?? a.ghlDaysSinceUpdate}
                      source={a._lastActivitySource}
                      lcMonth={a.lastLcActivityMonth}
                    />
                  </td>

                  {/* Health Score */}
                  <td className="px-2 pr-4 py-2 text-center">
                    <HealthPill score={a._health?.score ?? 0} band={a._health?.band ?? 'at_risk'} />
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
