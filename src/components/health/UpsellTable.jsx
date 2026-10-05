import { useState, useMemo, useEffect } from 'react'
import { suggestAddon } from '../../lib/healthEngine'
import InfoTip from './InfoTip'

const G = '#8CC63F'

const TOP_OPPORTUNITIES_COUNT = 10
const PAGE_SIZE                = 20

function fmt(n) { return '$' + Math.round(n).toLocaleString() }

function contactedAgo(ts) {
  if (!ts) return ''
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60)  return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const DISMISS_DAYS = 30
function backOn(ts) {
  return new Date(ts + DISMISS_DAYS * 86_400_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function UpsellRow({ a, i, isContacted, toggleContacted, getContactedAt, onAccountClick }) {
  const { label, estExtra, priority } = suggestAddon(a)
  const contacted           = isContacted(a.id)
  const contactedAt         = getContactedAt(a.id)
  const calls7d             = a.calls7d ?? null
  const addOns              = [a.hasLeadFlow ? 'LeadFlow AI' : null, a.hasCallCoach ? 'AI Call Coach' : null].filter(Boolean)
  if (!addOns.length && (a.addOnItems || []).length) addOns.push(...a.addOnItems.map(x => x.nickname || 'Add-on'))

  return (
    <tr key={a.id}
      className={`animate-slide-in-row border-b border-brand-border/60 transition-all duration-200 ${contacted ? 'opacity-55 bg-brand-bg/40' : 'hover:bg-green-50/20'}`}
      style={{ animationDelay: `${i * 30}ms`, borderLeft: `2px solid ${contacted ? '#E5E7E5' : G}` }}>

      {/* Account + Type */}
      <td className="pl-5 pr-3 py-3">
        <div className="flex items-center gap-1.5">
          <button onClick={() => onAccountClick?.(a)}
            className="text-[12px] font-semibold text-brand-text hover:underline text-left">
            {a.accountName}
          </button>
          {a.accountType && (
            <span className={`text-[9px] font-bold px-1 py-0.5 rounded border flex-shrink-0 ${
              a.accountType === 'Direct' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-purple-50 border-purple-200 text-purple-700'
            }`}>{a.accountType}</span>
          )}
        </div>
      </td>

      {/* Priority */}
      <td className="px-3 sm:px-4 py-3">
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border"
          style={priority === 'High' ? { color: '#B91C1C', borderColor: '#FCA5A5', background: '#FEF2F2' } : { color: '#C2410C', borderColor: '#FDBA74', background: '#FFF7ED' }}>
          {priority === 'High' ? 'HIGH' : 'Upsell'}
        </span>
      </td>

      {/* Calls in the past 7 days — the qualifying signal */}
      <td className="px-3 sm:px-4 py-3">
        <span className="num text-[12px] font-semibold" style={{ color: '#7c3aed' }}>{calls7d === null ? '—' : calls7d.toLocaleString()}</span>
      </td>

      {/* Users */}
      <td className="px-3 sm:px-4 py-3">
        <span className="num text-[12px] text-brand-text">{a.users > 0 ? a.users : '—'}</span>
      </td>

      {/* Current add-ons */}
      <td className="px-3 sm:px-4 py-3">
        {addOns.length
          ? <span className="text-[11px] text-brand-text">{addOns.join(', ')}</span>
          : <span className="text-brand-muted text-[11px]">none</span>}
      </td>

      {/* Current Rev */}
      <td className="px-3 sm:px-4 py-3">
        <span className="num text-[12px] font-semibold text-brand-text">{fmt(a.totalRev)}</span>
      </td>

      {/* Suggested Add-on */}
      <td className="px-3 sm:px-4 py-3 max-w-[180px]">
        <span className="text-[11px] text-brand-heading">{label}</span>
      </td>

      {/* Est. Extra */}
      <td className="px-3 sm:px-4 py-3">
        <span className="num text-[12px] font-bold" style={{ color: G }}>+{fmt(estExtra)}</span>
      </td>

      {/* Action */}
      <td className="px-3 sm:px-4 py-3 pr-5">
        <div className="flex flex-col gap-1 items-start">
          <button
            onClick={() => toggleContacted(a.id)}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-all duration-200 whitespace-nowrap"
            style={contacted
              ? { color: '#6B7280', borderColor: '#E5E7E5' }
              : { color: G, background: `${G}10`, borderColor: `${G}30` }
            }
          >
            {contacted ? 'Re-flag' : 'Unflag'}
          </button>
          {contacted && contactedAt && (
            <span className="text-[10px] text-brand-muted">Unflagged {contactedAgo(contactedAt)} · back on {backOn(contactedAt)}</span>
          )}
        </div>
      </td>
    </tr>
  )
}

const UPSELL_HEADERS = [
  { label: 'Account',        tip: 'Account name + type from the DM Footprint: Agent = assigned to a District Manager, Direct = no DM assigned.' },
  { label: 'Priority',       tip: 'HIGH = 300+ calls in 7 days and exactly one add-on (sell the second). Upsell = 300+ calls and no add-ons yet.' },
  { label: 'Calls (7d)',     tip: 'Calls in the past 7 days from GHL — the qualifying signal (300+).' },
  { label: 'Users',          tip: 'Billed additional user seats from Stripe (the admin seat is included in the base plan). AI Call Coach is $50 per user.' },
  { label: 'Add-ons',        tip: 'Add-ons currently on the Stripe subscription: LeadFlow AI ($50/mo) and/or AI Call Coach ($50/user/mo).' },
  { label: 'Current Rev',    tip: 'Total monthly charges currently billed — the baseline before any upsell.' },
  { label: 'Suggested Add-on', tip: 'The add-on the account does not have yet.' },
  { label: 'Est. Extra/mo',  tip: 'Monthly MRR if the suggested add-on is sold: LeadFlow AI $50, AI Call Coach $50 × users.' },
  { label: 'Action',         tip: 'Unflag drops the account off this list and off the Sales daily briefing for 30 days; it comes back automatically after that if it still qualifies.' },
]

function UpsellRows({ rows, isContacted, toggleContacted, getContactedAt, onAccountClick }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-brand-border bg-brand-bg/50">
            {UPSELL_HEADERS.map(({ label, tip }) => (
              <th key={label} className="px-3 sm:px-4 py-3 first:pl-5 last:pr-5 text-left text-[10px] font-bold uppercase tracking-widest text-brand-muted whitespace-nowrap">
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
            <UpsellRow key={a.id} a={a} i={i} isContacted={isContacted} toggleContacted={toggleContacted} getContactedAt={getContactedAt} onAccountClick={onAccountClick} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function UpsellTable({ accounts, hasBilling = false, stripeLoading = false, isContacted, toggleContacted, getContactedAt, onAccountClick, potentialMRR }) {
  const [page, setPage] = useState(1)

  const sortedAll = useMemo(() =>
    [...accounts].sort((a, b) => {
      const pa = suggestAddon(a).priority === 'High' ? 1 : 0, pb = suggestAddon(b).priority === 'High' ? 1 : 0
      return (pb - pa) || ((b.calls7d ?? 0) - (a.calls7d ?? 0)) || (suggestAddon(b).estExtra - suggestAddon(a).estExtra)
    }),
    [accounts]
  )
  const unflagged = sortedAll.filter(a => isContacted(a.id))
  const sorted    = sortedAll.filter(a => !isContacted(a.id))
  const contacted = unflagged.length
  const [showUnflagged, setShowUnflagged] = useState(false)

  // Reset to page 1 whenever the incoming accounts list changes (filters applied upstream)
  const accountsKey = accounts.length
  useEffect(() => { setPage(1) }, [accountsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const topOpportunities = sorted.slice(0, TOP_OPPORTUNITIES_COUNT)
  const rest              = sorted.slice(TOP_OPPORTUNITIES_COUNT)

  const totalPages = Math.max(1, Math.ceil(rest.length / PAGE_SIZE))
  const pageData   = useMemo(() => rest.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [rest, page])

  return (
    <div
      className="animate-fade-in-up rounded-2xl border border-brand-border bg-white"
      style={{ animationDelay: '580ms', boxShadow: '0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.04)' }}
    >
      {/* Header */}
      <div className="px-4 sm:px-6 py-4 border-b border-brand-border flex items-start sm:items-center justify-between flex-wrap gap-3">
        <div className="flex items-start gap-2">
          <div>
            <h2 className="text-brand-heading font-semibold text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ background: G }} />
              Upsell Opportunities
            </h2>
            <p className="text-brand-muted text-[11px] mt-0.5">
              {sorted.length} flagged · {sorted.filter(a => suggestAddon(a).priority === 'High').length} high priority · {contacted} unflagged (hidden 30 days)
            </p>
          </div>
          <InfoTip
            text={"Upsell rule (John, Oct 2026):\n• 300+ calls in the past 7 days AND no add-ons → Upsell\n• 300+ calls in the past 7 days AND exactly one add-on → HIGH priority\n\nAdd-ons: LeadFlow AI ($50/mo) · AI Call Coach ($50 per user/mo).\n\nUnflag removes an account from this list and from the Sales daily briefing for 30 days; after that it is flagged again automatically if it still qualifies.\n\nSorted: high priority first, then most calls."}
            position="top-end"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold px-3 py-1.5 rounded-full border"
            style={{ color: G, background: `${G}0D`, borderColor: `${G}30` }}>
            Potential additional MRR: {fmt(potentialMRR)}/mo
          </span>
        </div>
      </div>

      {sorted.length === 0 ? (
        stripeLoading ? (
          <div className="px-5 sm:px-6 py-6 animate-pulse space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand-border/30 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-brand-border/30 rounded w-2/3" />
                  <div className="h-2.5 bg-brand-border/20 rounded w-1/3" />
                </div>
                <div className="w-16 h-6 bg-brand-border/20 rounded-full" />
              </div>
            ))}
          </div>
        ) : hasBilling ? (
        <div className="py-10 flex flex-col items-center gap-3 text-center px-6">
          <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-200 flex items-center justify-center text-lg">✅</div>
          <div>
            <p className="text-brand-heading font-semibold text-sm">No Upsell Candidates Right Now</p>
            <p className="text-brand-muted text-[12px] mt-1.5 leading-relaxed max-w-[360px]">
              Accounts qualify with 300+ calls in the past 7 days and room for an add-on
              (LeadFlow AI or AI Call Coach). Unflagged accounts return after 30 days.
            </p>
          </div>
        </div>
        ) : (
        <div className="py-10 flex flex-col items-center gap-3 text-center px-6">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-lg">📈</div>
          <div>
            <p className="text-brand-heading font-semibold text-sm">Billing Data Not Connected</p>
            <p className="text-brand-muted text-[12px] mt-1.5 leading-relaxed max-w-[360px]">
              Upsell-ready accounts will appear here once billing data is connected.
              Requires: Stripe API key or the LGM billing sheet.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
            <span>⚠</span>
            <span>Data not received — connect Stripe or billing sheet to unlock this section</span>
          </div>
        </div>
        )
      ) : (
        <>
          {/* Top Opportunities — biggest $ potential, always visible, no pagination */}
          <div className="px-4 sm:px-6 pt-4 pb-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-0" style={{ color: G }}>
              🟢 Top Opportunities — highest potential first ({topOpportunities.length})
            </p>
          </div>
          <UpsellRows rows={topOpportunities} isContacted={isContacted} toggleContacted={toggleContacted} getContactedAt={getContactedAt} onAccountClick={onAccountClick} />

          {unflagged.length > 0 && (
            <div className="px-4 sm:px-6 py-3 border-t border-brand-border">
              <button onClick={() => setShowUnflagged(v => !v)} className="text-[11px] font-semibold text-brand-muted hover:text-brand-heading">
                {showUnflagged ? '▾' : '▸'} Unflagged — hidden for 30 days ({unflagged.length})
              </button>
              {showUnflagged && (
                <div className="mt-2 -mx-4 sm:-mx-6">
                  <UpsellRows rows={unflagged} isContacted={isContacted} toggleContacted={toggleContacted} getContactedAt={getContactedAt} onAccountClick={onAccountClick} />
                </div>
              )}
            </div>
          )}

          {rest.length > 0 && (
            <>
              <div className="px-4 sm:px-6 pt-4 pb-1.5 border-t border-brand-border">
                <p className="text-[10px] font-bold uppercase tracking-widest text-brand-muted">
                  🟡 To-Do — {rest.length} more, lower priority
                </p>
              </div>
              <UpsellRows rows={pageData} isContacted={isContacted} toggleContacted={toggleContacted} getContactedAt={getContactedAt} onAccountClick={onAccountClick} />

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-5 py-3 border-t border-brand-border flex items-center justify-between">
                  <span className="text-[11px] text-brand-muted">
                    Page {page} of {totalPages} · {rest.length} accounts
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      disabled={page === 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded-lg border text-[11px] font-semibold disabled:opacity-40 text-brand-muted border-brand-border hover:bg-brand-bg"
                    >
                      ← Prev
                    </button>
                    <button
                      disabled={page === totalPages}
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      className="px-2.5 py-1 rounded-lg border text-[11px] font-semibold disabled:opacity-40 text-brand-muted border-brand-border hover:bg-brand-bg"
                    >
                      Next →
                    </button>
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
