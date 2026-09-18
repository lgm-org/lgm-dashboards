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

function UpsellRow({ a, i, isContacted, toggleContacted, getContactedAt, onAccountClick }) {
  const { label, estExtra } = suggestAddon(a)
  const contacted           = isContacted(a.id)
  const contactedAt         = getContactedAt(a.id)
  const lcWallet            = a.lcWalletCharges ?? 0

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
              a.accountType === 'DM' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-purple-50 border-purple-200 text-purple-700'
            }`}>{a.accountType}</span>
          )}
        </div>
      </td>

      {/* LC Wallet — actual platform usage signal */}
      <td className="px-3 sm:px-4 py-3">
        {lcWallet > 0
          ? <span className="num text-[12px] font-semibold" style={{ color: '#7c3aed' }}>${Math.round(lcWallet).toLocaleString()}</span>
          : <span className="text-brand-muted text-[11px]">—</span>}
      </td>

      {/* Users */}
      <td className="px-3 sm:px-4 py-3">
        <span className="num text-[12px] text-brand-text">{a.users > 0 ? a.users : '—'}</span>
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
            {contacted ? 'Undo' : 'Mark Contacted'}
          </button>
          {contacted && contactedAt && (
            <span className="text-[10px] text-brand-muted">Contacted {contactedAgo(contactedAt)}</span>
          )}
        </div>
      </td>
    </tr>
  )
}

const UPSELL_HEADERS = [
  { label: 'Account',        tip: 'Account name + plan type (DM = Digital Marketing, Agent = AI platform).' },
  { label: 'LC Wallet',      tip: 'Cumulative LC platform spend (SMS, AI, calls, email). High spend = actively using the platform = strongest upsell signal.' },
  { label: 'Users',          tip: 'Current billed user seat count from Stripe. Fewer than 4 = room to grow seats.' },
  { label: 'Current Rev',    tip: 'Total monthly charges currently billed — the baseline before any upsell.' },
  { label: 'Suggested Add-on', tip: 'Best upsell based on LC usage, seat count, add-on gaps, and plan type.' },
  { label: 'Est. Extra/mo',  tip: 'Estimated MRR increase if the suggested add-on or upgrade is sold.' },
  { label: 'Action',         tip: 'Track whether your team has reached out. Marked contacts are dimmed so you focus on fresh opportunities.' },
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

  const sorted = useMemo(() =>
    [...accounts].sort((a, b) => suggestAddon(b).estExtra - suggestAddon(a).estExtra),
    [accounts]
  )
  const contacted = sorted.filter(a => isContacted(a.id)).length

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
              {accounts.length} accounts ready · {contacted} contacted
            </p>
          </div>
          <InfoTip
            text="Upsell qualification rules: (1) Has an active Stripe subscription · (2) Platform activity within last 60 days · (3) Engagement confirmed — at least 1 billed user seat OR any LC wallet spend · (4) Room to grow — fewer than 4 total user seats OR no add-ons yet. Billable users = total users minus 1 (first seat is free). Sorted by estimated additional MRR highest-first. LC wallet spend is the strongest signal — these clients are already paying for platform usage."
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
              Accounts qualify when they have high platform usage (DataHealthStatus) and 3+ users.
              This will populate once DataHealthStatus data is synced from Cliff's system.
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
