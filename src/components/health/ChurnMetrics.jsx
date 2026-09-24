import { useState } from 'react'
import { format } from 'date-fns'
import InfoTip from './InfoTip'

const G   = '#8CC63F'
const AMB = '#EAB308'
const RED = '#EF4444'

function rateColor(r) {
  if (r === null) return '#6B7280'
  if (r < 5)  return G
  if (r < 15) return AMB
  return RED
}

function fmt$(n) {
  if (!n && n !== 0) return '—'
  return '$' + Math.round(n).toLocaleString()
}

function fmtDate(s) {
  if (!s) return '—'
  try { return format(new Date(s + (s.length === 10 ? 'T12:00:00' : '')), 'MMM d, yyyy') } catch { return s }
}

function ScorePill({ score }) {
  if (score == null) return <span className="text-brand-muted text-[10px]">—</span>
  const bg = score >= 70 ? '#8CC63F18' : score >= 55 ? '#EAB30818' : '#EF444418'
  const c  = score >= 70 ? G           : score >= 55 ? AMB          : RED
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums"
      style={{ background: bg, color: c }}>
      {Math.round(score)}
    </span>
  )
}

function TypeBadge({ type }) {
  if (!type || type === 'Unknown') return null
  const isDm = type === 'DM' || type === 'dm'
  return (
    <span className="ml-1.5 text-[9px] uppercase tracking-wider font-semibold"
      style={{ color: isDm ? '#7C3AED' : '#0369A1' }}>
      {type}
    </span>
  )
}

// ── Churned account row ────────────────────────────────────────────────────────
function ChurnedRow({ a, onAccountClick }) {
  return (
    <tr
      className="hover:bg-red-50/60 cursor-pointer transition-colors"
      onClick={() => onAccountClick?.(a)}
    >
      <td className="py-2.5 pl-4 pr-2 max-w-[180px]">
        <span className="text-[12px] font-medium text-brand-heading truncate block hover:text-red-700">
          {a.accountName}
        </span>
        <TypeBadge type={a.accountType} />
      </td>
      <td className="py-2.5 px-2 text-[11px] text-brand-muted max-w-[120px]">
        <span className="truncate block">{a.planNickname || '—'}</span>
      </td>
      <td className="py-2.5 px-2 text-[12px] font-semibold text-brand-text tabular-nums">
        {fmt$(a.planPrice)}
        <span className="text-brand-muted font-normal text-[10px]">/mo</span>
      </td>
      <td className="py-2.5 px-2 text-[11px] text-brand-muted tabular-nums whitespace-nowrap">
        {a.stripeStartDate ? fmtDate(a.stripeStartDate) : <span className="text-brand-muted/50 italic">no Stripe date</span>}
      </td>
      <td className="py-2.5 px-2 text-[11px] tabular-nums whitespace-nowrap" style={{ color: RED }}>
        {fmtDate(a.canceledAt)}
      </td>
      <td className="py-2.5 pr-4 pl-2">
        <ScorePill score={a._health?.score} />
      </td>
    </tr>
  )
}

// ── Scheduled-cancel row ───────────────────────────────────────────────────────
function RiskRow({ a, onAccountClick }) {
  let cancelLabel = 'Cancels at period end'
  if (a.cancelAt) {
    try {
      cancelLabel = 'Cancels ' + format(new Date(a.cancelAt * 1000), 'MMM d, yyyy')
    } catch {}
  }
  return (
    <tr
      className="hover:bg-amber-50/60 cursor-pointer transition-colors"
      onClick={() => onAccountClick?.(a)}
    >
      <td className="py-2.5 pl-4 pr-2 max-w-[180px]">
        <span className="text-[12px] font-medium text-brand-heading truncate block hover:text-amber-700">
          {a.accountName}
        </span>
        <TypeBadge type={a.accountType} />
      </td>
      <td className="py-2.5 px-2 text-[11px] text-brand-muted max-w-[120px]">
        <span className="truncate block">{a.planNickname || '—'}</span>
      </td>
      <td className="py-2.5 px-2 text-[12px] font-semibold text-brand-text tabular-nums">
        {fmt$(a.planPrice)}
        <span className="text-brand-muted font-normal text-[10px]">/mo</span>
      </td>
      <td className="py-2.5 pr-4 pl-2 text-[11px] font-medium whitespace-nowrap" style={{ color: AMB }}>
        {cancelLabel}
      </td>
      <td className="py-2.5 pr-4 pl-2">
        <ScorePill score={a._health?.score} />
      </td>
    </tr>
  )
}

// ── Cohort card ────────────────────────────────────────────────────────────────
function CohortCard({ days, cohortSize, churned, mrrLost, rate, loading, isSelected, onSelect }) {
  const color = rateColor(rate)
  return (
    <button
      className={`flex flex-col items-center justify-center px-4 py-5 text-center w-full transition-colors focus:outline-none ${
        isSelected ? 'bg-red-50/70' : 'hover:bg-brand-bg/60'
      }`}
      onClick={() => onSelect(isSelected ? null : days)}
    >
      <p className="text-[10px] font-bold text-brand-muted uppercase tracking-wider mb-3">
        {days}-Day Cohort
      </p>

      {loading ? (
        <div className="h-8 w-16 mx-auto rounded-lg bg-brand-bg animate-pulse mb-2" />
      ) : cohortSize === 0 ? (
        <p className="text-3xl font-bold text-brand-muted tabular-nums mb-1">—</p>
      ) : (
        <p className="text-3xl font-bold tabular-nums mb-1" style={{ color }}>
          {rate != null ? rate.toFixed(1) + '%' : '0%'}
        </p>
      )}

      <p className="text-[11px] text-brand-muted leading-snug">
        {cohortSize === 0
          ? 'No new signups'
          : `${churned} of ${cohortSize} cancelled`}
      </p>

      {mrrLost > 0 && (
        <p className="text-[11px] font-semibold mt-1.5 tabular-nums" style={{ color: RED }}>
          −{fmt$(mrrLost)}/mo lost
        </p>
      )}

      {churned > 0 && !loading && (
        <span className="mt-2 text-[10px] text-brand-muted" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
          {isSelected ? 'hide ↑' : 'see who ↓'}
        </span>
      )}
    </button>
  )
}

// ── Main export ────────────────────────────────────────────────────────────────
export default function ChurnMetrics({ metrics = [], scheduledToCancel = [], stripeLoading, onAccountClick }) {
  const [selected, setSelected] = useState(null)

  const selectedMetric   = metrics.find(m => m.days === selected) ?? null
  const totalMrrAtRisk   = scheduledToCancel.reduce((s, a) => s + (a.planPrice || 0), 0)
  const totalMrrLost     = metrics.reduce((s, m) => Math.max(s, m.mrrLost || 0), 0) // max of windows (avoid double-counting)

  return (
    <div
      className="animate-fade-in-up rounded-2xl border border-red-200 bg-white overflow-hidden"
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.04)' }}
    >
      {/* ── Header ── */}
      <div className="px-5 sm:px-6 py-4 border-b border-red-100 bg-red-50/40 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-red-700 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
            Cohort Churn Rate
            <InfoTip
              position="bottom-start"
              text={"Rule per window (30 / 60 / 90 days):\nCohort = Stripe-matched accounts whose Stripe subscription start date falls inside the window.\nChurned = cohort members whose Stripe canceled_at is set.\nRate = churned ÷ cohort.\nMRR lost = sum of their Stripe plan prices.\n\nStarted and Cancelled dates come from Stripe only — GHL dates are not used here.\n'At risk' = Stripe cancel_at_period_end set but not yet cancelled."}
            />
            {scheduledToCancel.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white"
                style={{ background: AMB }}>
                {scheduledToCancel.length} at risk
              </span>
            )}
          </h2>
          <p className="text-[11px] text-red-500 mt-0.5">
            Of clients who <strong>signed up</strong> in each window — how many have since cancelled
          </p>
        </div>
        <div className="text-[10px] text-red-400 text-right leading-relaxed">
          <p className="font-semibold text-red-500">John's formula</p>
          <p>Cohort denominator = new signups in that window</p>
          <p>Cancels from OTHER cohorts excluded from numerator</p>
        </div>
      </div>

      {/* ── 3 rate cards ── */}
      <div className="grid grid-cols-3 divide-x divide-brand-border">
        {metrics.map(m => (
          <CohortCard
            key={m.days}
            {...m}
            loading={stripeLoading}
            isSelected={selected === m.days}
            onSelect={setSelected}
          />
        ))}
      </div>

      {/* ── Expanded drilldown — which accounts churned ── */}
      {selectedMetric && selectedMetric.churnedAccounts?.length > 0 && (
        <div className="border-t border-red-100">
          <div className="px-5 py-3 bg-red-50/30 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] font-semibold text-red-700">
              {selectedMetric.days}-day cohort — {selectedMetric.churnedAccounts.length} cancelled account{selectedMetric.churnedAccounts.length !== 1 ? 's' : ''}
            </p>
            <p className="text-[11px] font-medium tabular-nums" style={{ color: RED }}>
              −{fmt$(selectedMetric.mrrLost)}/mo MRR lost from this cohort
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[600px]">
              <thead>
                <tr className="border-y border-red-100/80 bg-red-50/50">
                  {['Account', 'Plan', 'MRR', 'Started (Stripe)', 'Cancelled (Stripe)', 'Score'].map(h => (
                    <th key={h} className={`py-2 text-[10px] uppercase tracking-wider text-brand-muted font-semibold ${
                      h === 'Account' ? 'pl-4 pr-2' : h === 'Score' ? 'pr-4 pl-2' : 'px-2'
                    }`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border/30">
                {[...selectedMetric.churnedAccounts]
                  .sort((a, b) => (b.planPrice || 0) - (a.planPrice || 0))
                  .map(a => (
                    <ChurnedRow key={a.id} a={a} onAccountClick={onAccountClick} />
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Scheduled cancellations — "pipeline at risk" ── */}
      {scheduledToCancel.length > 0 && (
        <div className="border-t border-amber-200">
          <div className="px-5 py-3 bg-amber-50/40 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] font-semibold text-amber-700 flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[9px] font-bold flex-shrink-0"
                style={{ background: AMB }}>
                {scheduledToCancel.length}
              </span>
              Scheduled to cancel — still active but will churn
            </p>
            <p className="text-[11px] font-medium tabular-nums" style={{ color: AMB }}>
              {fmt$(totalMrrAtRisk)}/mo MRR at risk
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[520px]">
              <thead>
                <tr className="border-y border-amber-100 bg-amber-50/50">
                  {['Account', 'Plan', 'MRR', 'Cancels', 'Score'].map(h => (
                    <th key={h} className={`py-2 text-[10px] uppercase tracking-wider text-brand-muted font-semibold ${
                      h === 'Account' ? 'pl-4 pr-2' : h === 'Score' ? 'pr-4 pl-2' : 'px-2'
                    }`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border/30">
                {[...scheduledToCancel]
                  .sort((a, b) => (b.planPrice || 0) - (a.planPrice || 0))
                  .map(a => (
                    <RiskRow key={a.id} a={a} onAccountClick={onAccountClick} />
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="px-5 py-2 border-t border-brand-border/40 bg-brand-bg/60 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] text-brand-muted">
          Stripe-matched accounts only
          &nbsp;·&nbsp; <span style={{ color: G }}>●</span> &lt;5% healthy
          &nbsp;·&nbsp; <span style={{ color: AMB }}>●</span> 5–15% watch
          &nbsp;·&nbsp; <span style={{ color: RED }}>●</span> 15%+ critical
          &nbsp;·&nbsp; Click a cohort to drill into who churned
        </p>
      </div>
    </div>
  )
}
