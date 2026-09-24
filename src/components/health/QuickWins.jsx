import InfoTip from './InfoTip'
import { differenceInDays, parseISO, isValid } from 'date-fns'

const G   = '#8CC63F'
const RED = '#EF4444'
const AMB = '#EAB308'

function bandColor(band) {
  if (band === 'healthy') return G
  if (band === 'watch')   return AMB
  if (band === 'no_data') return '#9CA3AF'
  return RED
}

function tenureLabel(dateAdded) {
  if (!dateAdded) return '—'
  try {
    const d = parseISO(dateAdded)
    if (!isValid(d)) return '—'
    const days = differenceInDays(new Date(), d)
    if (days < 30)  return `${days}d old`
    if (days < 365) return `${Math.round(days / 30)}mo`
    return `${(days / 365).toFixed(1)}yr`
  } catch { return '—' }
}

export default function QuickWins({ topStale, topNew, topUpsell = [], onAccountClick }) {
  const hasUpsell = topUpsell.length > 0

  return (
    <div
      className="animate-fade-in-up rounded-2xl border border-brand-border bg-white"
      style={{ animationDelay: '520ms', boxShadow: '0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.04)' }}
    >
      <div className="px-5 sm:px-6 py-4 border-b border-brand-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base">⚡</span>
          <div>
            <h2 className="text-brand-heading font-semibold text-sm">Quick Wins — Do These Today</h2>
            <p className="text-brand-muted text-[11px] mt-0.5">Urgent inactive accounts · Top upsell opportunities · Newest clients needing onboarding</p>
          </div>
        </div>
        <InfoTip
          text="Left: the 3 accounts with longest GHL inactivity — call them immediately. Middle: top upsell opportunities by estimated additional MRR (requires billing data). Right: the 3 most recently joined clients — confirm onboarding is on track."
          position="top-end"
        />
      </div>

      <div className="px-5 sm:px-6 py-5 grid grid-cols-1 sm:grid-cols-3 gap-5">

        {/* Most inactive / stale */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-3" style={{ color: RED }}>
            Most Urgent — Inactive Accounts
          </p>
          <div className="space-y-2.5">
            {topStale.length === 0 && (
              <p className="text-brand-muted text-[12px]">No stale accounts — all clients active.</p>
            )}
            {topStale.map((a, i) => {
              // No LC data → the only fallback is GHL's record-updated date, which isn't
              // a real usage signal and can show absurd values for untouched legacy accounts.
              const days = a.lastLcActivityMonth ? Number(a.lastActivity) : NaN
              return (
                <div key={a.id} className="flex items-start gap-3 p-3 rounded-xl border border-brand-border bg-brand-bg/50">
                  <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 text-white mt-0.5"
                    style={{ background: RED }}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button onClick={() => onAccountClick?.(a)}
                      className="text-[12px] font-semibold hover:underline text-left truncate block w-full"
                      style={{ color: RED }}>
                      {a.accountName}
                    </button>
                    <p className="text-[11px] text-brand-muted truncate">
                      {[a.ghlCity, a.ghlState].filter(Boolean).join(', ') || a.ghlEmail || '—'}
                    </p>
                  </div>
                  <span className="num text-[11px] font-bold flex-shrink-0 px-2 py-0.5 rounded-full border"
                    style={{ color: RED, background: `${RED}10`, borderColor: `${RED}28` }}>
                    {isNaN(days) ? '—' : `${days}d`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Upsell opportunities */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-3" style={{ color: G }}>
            Top Upsell Opportunities
          </p>
          {!hasUpsell ? (
            <div className="flex flex-col items-center gap-2.5 p-4 rounded-xl border border-dashed border-brand-border bg-brand-bg/50 h-full min-h-[100px] justify-center text-center">
              <span className="text-xl">📈</span>
              <p className="text-[11px] text-brand-muted leading-snug">Requires billing data</p>
              <p className="text-[10px] text-amber-600 font-medium">⚠ Connect Stripe or billing sheet to identify upsell-ready accounts (3,500+ transactions, 3+ users)</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {topUpsell.map((a, i) => (
                <div key={a.id} className="flex items-start gap-3 p-3 rounded-xl border border-brand-border bg-brand-bg/50">
                  <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 text-white mt-0.5"
                    style={{ background: G }}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button onClick={() => onAccountClick?.(a)}
                      className="text-[12px] font-semibold hover:underline text-left truncate block w-full"
                      style={{ color: G }}>
                      {a.accountName}
                    </button>
                    <p className="text-[11px] text-brand-muted truncate">
                      {a._upsell?.label || 'Upsell opportunity'}
                    </p>
                  </div>
                  {a._upsell?.estExtra > 0 && (
                    <span className="num text-[11px] font-bold flex-shrink-0 px-2 py-0.5 rounded-full border"
                      style={{ color: G, background: `${G}10`, borderColor: `${G}28` }}>
                      +${Math.round(a._upsell.estExtra)}/mo
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Newest clients */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-3" style={{ color: G }}>
            Newest Clients — Check Onboarding
          </p>
          <div className="space-y-2.5">
            {topNew.length === 0 && (
              <p className="text-brand-muted text-[12px]">No recently joined clients.</p>
            )}
            {topNew.map((a, i) => (
              <div key={a.id} className="flex items-start gap-3 p-3 rounded-xl border border-brand-border bg-brand-bg/50">
                <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 text-white mt-0.5"
                  style={{ background: G }}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <button onClick={() => onAccountClick?.(a)}
                    className="text-[12px] font-semibold text-brand-text hover:underline text-left truncate block w-full">
                    {a.accountName}
                  </button>
                  <p className="text-[11px] text-brand-muted truncate">
                    {[a.ghlCity, a.ghlState].filter(Boolean).join(', ') || a.ghlEmail || '—'}
                  </p>
                </div>
                <span className="num text-[11px] font-bold flex-shrink-0 px-2 py-0.5 rounded-full border"
                  style={{ color: bandColor(a._health?.band), background: `${bandColor(a._health?.band)}10`, borderColor: `${bandColor(a._health?.band)}28` }}>
                  {tenureLabel(a.ghlDateAdded)}
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
