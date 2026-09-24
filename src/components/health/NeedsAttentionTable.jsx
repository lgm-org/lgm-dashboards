import { useState, useMemo, useEffect } from 'react'
import InfoTip from './InfoTip'

const G   = '#8CC63F'
const RED = '#EF4444'
const AMB = '#EAB308'

const HIGHLY_NEEDED_COUNT = 10
const PAGE_SIZE           = 20

function bandColor(band) {
  if (band === 'healthy') return G
  if (band === 'watch')   return AMB
  if (band === 'no_data') return '#9CA3AF'
  return RED
}

function resolvedAgo(ts) {
  if (!ts) return ''
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60)  return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function HealthPill({ score, band }) {
  const c = bandColor(band)
  return (
    <div className="flex items-center gap-1.5">
      <span className="num inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border"
        style={{ color: c, background: `${c}12`, borderColor: `${c}28` }}>
        {score ?? '—'}
      </span>
      <div className="w-10 h-1 rounded-full bg-brand-border overflow-hidden">
        <div className="h-full score-bar-fill rounded-full" style={{ width: `${score ?? 0}%`, background: c }} />
      </div>
    </div>
  )
}

function ActivityBadge({ days, source }) {
  // No LC wallet data for this account — the only fallback is GHL's record-updated
  // date, which can reflect LGM staff touching the sub-account, not client usage.
  // Legacy accounts untouched for years render nonsense like "1919d ago" — hide it.
  if (source === 'ghl' || days === null || days === undefined) return <span className="text-brand-muted text-[11px]">—</span>
  const d = Number(days)
  const color = d <= 7 ? G : d <= 30 ? AMB : RED
  const label = d === 0 ? 'Today' : `${d}d ago`
  return (
    <span className="num inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border"
      style={{ color, background: `${color}12`, borderColor: `${color}28` }}>
      {label}
    </span>
  )
}

function StatusBadge({ status }) {
  if (status === 'resolved')    return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap"
      style={{ color: G, background: `${G}10`, borderColor: `${G}28` }}>✓ Resolved</span>
  )
  if (status === 'in_progress') return (
    <span className="inline-flex items-center gap-1 text-amber-700 text-[11px] font-semibold bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" /> In Progress
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-red-500 text-[11px] font-semibold bg-red-50 border border-red-200 px-2 py-0.5 rounded-full whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" /> Needs Outreach
    </span>
  )
}

function ActionButtons({ id, status, setStatus }) {
  if (status === 'resolved') return (
    <button onClick={() => setStatus(id, null)}
      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-all duration-200 whitespace-nowrap"
      style={{ color: '#6B7280', borderColor: '#E5E7E5' }}>Undo</button>
  )
  if (status === 'in_progress') return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button onClick={() => setStatus(id, 'resolved')}
        className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border text-white whitespace-nowrap"
        style={{ background: G, borderColor: G, boxShadow: `0 1px 4px ${G}40` }}>Mark Complete</button>
      <button onClick={() => setStatus(id, null)}
        className="text-[11px] font-semibold px-2 py-1.5 rounded-lg border whitespace-nowrap"
        style={{ color: '#6B7280', borderColor: '#E5E7E5' }} title="Reset">↩</button>
    </div>
  )
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1.5 flex-wrap">
      <button onClick={() => setStatus(id, 'in_progress')}
        className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border whitespace-nowrap"
        style={{ color: '#D97706', background: '#FFFBEB', borderColor: '#FDE68A' }}>In Progress</button>
      <button onClick={() => setStatus(id, 'resolved')}
        className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border text-white whitespace-nowrap"
        style={{ background: G, borderColor: G, boxShadow: `0 1px 4px ${G}40` }}>Mark Complete</button>
    </div>
  )
}

const TABLE_HEADERS = [
  { label: 'Account Name',       tip: null },
  { label: 'Location',           tip: 'City and state from the GHL sub-account profile.' },
  { label: 'Email',              tip: 'Contact email on file in GHL.' },
  { label: 'Last Meaningful',    tip: 'Last Meaningful Activity — days since the most recent of: call, new contact created, won sale. Contact updates are excluded (automations change contacts). Not a login metric.' },
  { label: 'Health Score',       tip: '100-point score: Platform Activity 45 (7-day calls + last call) · Sales Activity 40 (last sale + sales in 30 days) · Account Health 15 (tickets in 7 days). Accounts appear in this table when the score is below 55 (At Risk).' },
  { label: 'Recommended Action', tip: 'Rule-based next step generated from the account\'s activity data.' },
  { label: 'Status',             tip: 'Your team\'s outreach status. Tracked per-browser.' },
  { label: 'Actions',            tip: null },
]

function AccountRow({ a, i, getStatus, getResolvedAt, setStatus, onAccountClick }) {
  const status     = getStatus(a.id)
  const resolvedAt = getResolvedAt(a.id)
  const isResolved = status === 'resolved'

  return (
    <tr
      className={`animate-slide-in-row border-b border-brand-border/60 transition-all duration-200 ${isResolved ? 'opacity-50' : 'hover:bg-red-50/30'}`}
      style={{ animationDelay: `${i * 30}ms`, borderLeft: `2px solid ${isResolved ? '#E5E7E5' : RED}` }}>

      <td className="pl-5 pr-3 py-3">
        <button onClick={() => onAccountClick?.(a)}
          className="text-[12px] font-semibold hover:underline text-left"
          style={{ color: RED }}>
          {a.accountName}
        </button>
      </td>
      <td className="px-3 py-3 text-[11px] text-brand-muted whitespace-nowrap">
        {[a.ghlCity, a.ghlState].filter(Boolean).join(', ') || '—'}
      </td>
      <td className="px-3 py-3 text-[11px] text-brand-muted max-w-[160px] truncate">
        {a.ghlEmail || '—'}
      </td>
      <td className="px-3 py-3">
        <ActivityBadge days={a.lastActivity} source={a.lastLcActivityMonth ? 'lc' : 'ghl'} />
      </td>
      <td className="px-3 py-3">
        <HealthPill score={a._health?.score ?? null} band={a._health?.band ?? 'no_data'} />
      </td>
      <td className="px-3 py-3 max-w-[200px]">
        <p className="text-[11px] text-brand-muted leading-snug">{a._health?.action ?? '—'}</p>
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1">
          <StatusBadge status={status} />
          {isResolved && resolvedAt && (
            <span className="text-[10px] text-brand-muted">Resolved {resolvedAgo(resolvedAt)}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-3 pr-5">
        <ActionButtons id={a.id} status={status} setStatus={setStatus} />
      </td>
    </tr>
  )
}

function AccountTable({ rows, getStatus, getResolvedAt, setStatus, onAccountClick }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-brand-border bg-brand-bg/50">
            {TABLE_HEADERS.map(({ label, tip }) => (
              <th key={label} className="px-3 py-3 first:pl-5 last:pr-5 text-left text-[10px] font-bold uppercase tracking-widest text-brand-muted whitespace-nowrap">
                <span className="flex items-center gap-1">
                  {label}
                  {tip && <InfoTip text={tip} position="bottom-end" />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a, i) => (
            <AccountRow key={a.id} a={a} i={i}
              getStatus={getStatus} getResolvedAt={getResolvedAt}
              setStatus={setStatus} onAccountClick={onAccountClick} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function NeedsAttentionTable({ accounts, statuses, setStatus, onAccountClick }) {
  const [page, setPage] = useState(1)
  const accountsKey = accounts.length
  useEffect(() => { setPage(1) }, [accountsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const getStatus     = (id) => statuses[String(id)]?.status ?? 'action_required'
  const getResolvedAt = (id) => statuses[String(id)]?.resolvedAt ?? null

  const actionRequired = accounts.filter(a => getStatus(a.id) === 'action_required').length
  const inProgress     = accounts.filter(a => getStatus(a.id) === 'in_progress').length
  const resolved       = accounts.filter(a => getStatus(a.id) === 'resolved').length

  const highlyNeeded = accounts.slice(0, HIGHLY_NEEDED_COUNT)
  const todo         = accounts.slice(HIGHLY_NEEDED_COUNT)
  const totalPages   = Math.max(1, Math.ceil(todo.length / PAGE_SIZE))
  const pageData     = useMemo(() => todo.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [todo, page])

  return (
    <div
      className="animate-fade-in-up rounded-2xl border border-brand-border bg-white"
      style={{ animationDelay: '540ms', boxShadow: '0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.04)' }}
    >
      <div className="px-4 sm:px-6 py-4 border-b border-brand-border flex items-start sm:items-center justify-between flex-wrap gap-3">
        <div className="flex items-start gap-2">
          <div>
            <h2 className="text-brand-heading font-semibold text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-brand-red animate-pulse-dot inline-block flex-shrink-0"
                style={{ boxShadow: '0 0 5px rgba(239,68,68,0.5)' }} />
              Needs Attention
            </h2>
            <p className="text-brand-muted text-[11px] mt-0.5">
              {accounts.length === 0
                ? 'No stale accounts — all clients active'
                : `${accounts.length} stale accounts · ${actionRequired} pending outreach · ${inProgress} in progress · ${resolved} resolved`}
            </p>
          </div>
          <InfoTip
            text="Accounts with no GHL activity in 30+ days, sorted worst-first (longest inactive first). The top 10 are flagged as 'Highly Needed' — reach out to those first. Use the status buttons to track your team's progress."
            position="top-end"
          />
        </div>
        {accounts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {resolved     > 0 && <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border" style={{ color: G, background: `${G}10`, borderColor: `${G}25` }}>✓ {resolved} resolved</span>}
            {inProgress   > 0 && <span className="text-amber-700 text-[11px] font-bold bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">◌ {inProgress} in progress</span>}
            {actionRequired > 0 && <span className="text-red-500 text-[11px] font-bold bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">⚠ {actionRequired} pending</span>}
          </div>
        )}
      </div>

      {accounts.length === 0 ? (
        <div className="py-14 text-center">
          <div className="flex flex-col items-center gap-3">
            <span className="text-4xl">✅</span>
            <p className="text-brand-muted text-sm">No stale accounts — every client has recent GHL activity</p>
          </div>
        </div>
      ) : (
        <>
          <div className="px-4 sm:px-6 pt-4 pb-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-red-500 flex items-center gap-1.5">
              🔴 Highly Needed — reach out to these first ({highlyNeeded.length})
            </p>
          </div>
          <AccountTable rows={highlyNeeded} getStatus={getStatus} getResolvedAt={getResolvedAt} setStatus={setStatus} onAccountClick={onAccountClick} />

          {todo.length > 0 && (
            <>
              <div className="px-4 sm:px-6 pt-4 pb-1.5 border-t border-brand-border">
                <p className="text-[10px] font-bold uppercase tracking-widest text-brand-muted flex items-center gap-1.5">
                  🟡 To-Do — {todo.length} more accounts
                </p>
              </div>
              <AccountTable rows={pageData} getStatus={getStatus} getResolvedAt={getResolvedAt} setStatus={setStatus} onAccountClick={onAccountClick} />
              {totalPages > 1 && (
                <div className="px-5 py-3 border-t border-brand-border flex items-center justify-between">
                  <span className="text-[11px] text-brand-muted">Page {page} of {totalPages} · {todo.length} accounts</span>
                  <div className="flex items-center gap-1">
                    <button disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded-lg border text-[11px] font-semibold disabled:opacity-40 text-brand-muted border-brand-border hover:bg-brand-bg">← Prev</button>
                    <button disabled={page === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      className="px-2.5 py-1 rounded-lg border text-[11px] font-semibold disabled:opacity-40 text-brand-muted border-brand-border hover:bg-brand-bg">Next →</button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
