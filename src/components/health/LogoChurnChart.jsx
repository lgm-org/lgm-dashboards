import { useState, useMemo } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import { format } from 'date-fns'

const G   = '#8CC63F'
const AMB = '#EAB308'
const RED = '#EF4444'

function rateColor(r) {
  if (r == null) return '#6B7280'
  if (r <= 5)  return G
  if (r <= 10) return AMB
  return RED
}

function pct(n) { return n != null ? n.toFixed(1) + '%' : '—' }

// ── Custom tooltip ─────────────────────────────────────────────────────────────
function ChurnTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="rounded-xl border border-brand-border bg-white px-4 py-3 text-[11px] shadow-lg space-y-1"
      style={{ minWidth: 180 }}>
      <p className="font-bold text-brand-heading text-[12px]">{label}</p>
      <p className="text-brand-muted">{d.activeStart} active accounts at start</p>
      <p style={{ color: RED }}>
        {d.cancelsConfirmed} cancelled
        {d.reinstated28d > 0 && <span className="text-brand-muted"> ({d.reinstated28d} reinstated ≤28d)</span>}
      </p>
      {d.cancelsPending > 0 && (
        <p style={{ color: AMB }}>{d.cancelsPending} pending cancellation</p>
      )}
      <p className="font-semibold border-t border-brand-border/50 pt-1 mt-1" style={{ color: rateColor(d.churnRateConfirmed) }}>
        {pct(d.churnRateConfirmed)} confirmed churn
      </p>
      {d.isCurrentMonth && <p className="text-[10px] text-brand-muted italic">Partial month</p>}
    </div>
  )
}

// ── Summary stat card ──────────────────────────────────────────────────────────
function Stat({ label, value, sub, color }) {
  return (
    <div className="flex flex-col items-center text-center px-4 py-4">
      <p className="text-[10px] font-bold text-brand-muted uppercase tracking-wider mb-2">{label}</p>
      <p className="text-2xl font-bold tabular-nums" style={{ color: color || '#4A4A4A' }}>
        {value ?? '—'}
      </p>
      {sub && <p className="text-[10px] text-brand-muted mt-1 leading-tight">{sub}</p>}
    </div>
  )
}

// ── Recent months table ────────────────────────────────────────────────────────
function RecentTable({ months }) {
  const recent = [...months].reverse().slice(0, 12)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left min-w-[560px]">
        <thead>
          <tr className="border-y border-brand-border/60 bg-brand-bg/60">
            {['Month', 'Active (start)', 'Cancels', 'Reinstated ≤28d', 'Rate', 'Pending'].map(h => (
              <th key={h} className="py-2 px-3 text-[10px] uppercase tracking-wider text-brand-muted font-semibold first:pl-5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-border/30">
          {recent.map(m => {
            const color = rateColor(m.churnRateConfirmed)
            const label = m.isCurrentMonth ? `${m.month} ▸` : m.month
            return (
              <tr key={m.month} className={m.isCurrentMonth ? 'bg-amber-50/40' : 'hover:bg-brand-bg/40'}>
                <td className="py-2.5 pl-5 pr-3 text-[11px] font-medium text-brand-heading tabular-nums whitespace-nowrap">
                  {label}
                </td>
                <td className="py-2.5 px-3 text-[11px] tabular-nums text-brand-text">{m.activeStart}</td>
                <td className="py-2.5 px-3 text-[11px] tabular-nums font-medium" style={{ color: m.cancelsConfirmed > 0 ? RED : '#6B7280' }}>
                  {m.cancelsConfirmed}
                </td>
                <td className="py-2.5 px-3 text-[11px] tabular-nums text-brand-muted">
                  {m.reinstated28d > 0 ? m.reinstated28d : '—'}
                </td>
                <td className="py-2.5 px-3 text-[11px] font-semibold tabular-nums" style={{ color }}>
                  {m.activeStart > 0 ? pct(m.churnRateConfirmed) : '—'}
                </td>
                <td className="py-2.5 px-3 text-[11px] tabular-nums" style={{ color: m.cancelsPending > 0 ? AMB : '#6B7280' }}>
                  {m.cancelsPending > 0 ? m.cancelsPending : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main export ────────────────────────────────────────────────────────────────
export default function LogoChurnChart({ data, loading, error }) {
  const [showAll, setShowAll] = useState(false)

  const chartMonths = useMemo(() => {
    if (!data?.months) return []
    const months = data.months.filter(m => m.activeStart > 0)
    return showAll ? months : months.slice(-18)
  }, [data, showAll])

  const { summary } = data || {}

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="animate-fade-in-up rounded-2xl border border-brand-border bg-white overflow-hidden"
        style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.09)' }}>
        <div className="px-5 py-4 border-b border-brand-border bg-brand-bg/40">
          <div className="h-4 w-48 rounded bg-brand-border animate-pulse" />
          <div className="h-3 w-72 rounded bg-brand-border/60 animate-pulse mt-2" />
        </div>
        <div className="p-6 h-64 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-4 border-brand-border border-t-brand-green animate-spin" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="animate-fade-in-up rounded-2xl border border-red-200 bg-red-50 px-6 py-6 text-center">
        <p className="text-sm font-semibold text-red-700">Could not load Logo Churn data</p>
        <p className="text-[11px] text-red-500 mt-1">{error}</p>
      </div>
    )
  }

  return (
    <div className="animate-fade-in-up rounded-2xl border border-brand-border bg-white overflow-hidden"
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.04)' }}>

      {/* ── Header ── */}
      <div className="px-5 sm:px-6 py-4 border-b border-brand-border bg-brand-bg/40 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-brand-heading flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-green flex-shrink-0" />
            Logo Churn — Monthly
          </h2>
          <p className="text-[11px] text-brand-muted mt-0.5">
            Active SaaS accounts at month start vs. confirmed cancellations · 28-day reinstatements excluded
          </p>
        </div>
        <div className="text-[10px] text-brand-muted text-right leading-relaxed">
          <p className="font-semibold text-brand-heading">Cliff's formula</p>
          <p>Rate = confirmed cancels / active start</p>
          <p>Win-backs ≤28d not counted as churned</p>
        </div>
      </div>

      {/* ── Summary stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-brand-border border-b border-brand-border">
        <Stat
          label={`Last Month (${summary?.lastCompleteMonth || '—'})`}
          value={summary?.lastMonthRate != null ? pct(summary.lastMonthRate) : '—'}
          sub={`${summary?.lastMonthCancels ?? 0} of ${summary?.lastMonthActive ?? 0} accounts`}
          color={rateColor(summary?.lastMonthRate)}
        />
        <Stat
          label="6-Month Avg Rate"
          value={summary?.avg6mRate != null ? pct(summary.avg6mRate) : '—'}
          sub="rolling 6-month confirmed"
          color={rateColor(summary?.avg6mRate)}
        />
        <Stat
          label="Total Cancels (all time)"
          value={summary?.totalCancels ?? '—'}
          sub="confirmed, excl. reinstated"
          color={RED}
        />
        <Stat
          label={`${summary?.currentMonth || 'This Month'} Pending`}
          value={summary?.currentPending ?? '—'}
          sub={`of ${summary?.currentActiveStart ?? 0} active, not yet cancelled`}
          color={summary?.currentPending > 0 ? AMB : '#6B7280'}
        />
      </div>

      {/* ── Chart ── */}
      <div className="px-4 pt-5 pb-2">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartMonths} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7E5" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 10, fill: '#6B7280' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              tickFormatter={m => {
                const [y, mo] = m.split('-')
                return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(mo)-1]} ${y.slice(2)}`
              }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#6B7280' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => v + '%'}
              domain={[0, 'auto']}
            />
            <Tooltip content={<ChurnTooltip />} />
            <ReferenceLine y={5}  stroke={G}   strokeDasharray="4 3" strokeWidth={1} />
            <ReferenceLine y={10} stroke={AMB} strokeDasharray="4 3" strokeWidth={1} />
            <Bar dataKey="churnRateConfirmed" radius={[3, 3, 0, 0]} maxBarSize={36}>
              {chartMonths.map(m => (
                <Cell
                  key={m.month}
                  fill={m.isCurrentMonth ? '#94A3B8' : rateColor(m.churnRateConfirmed)}
                  fillOpacity={m.isCurrentMonth ? 0.5 : 0.85}
                />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="churnRateConfirmed"
              dot={false}
              strokeWidth={1.5}
              stroke="#4A4A4A"
              strokeOpacity={0.25}
            />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-1 px-1 flex-wrap">
          <div className="flex items-center gap-1.5 text-[10px] text-brand-muted">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: G, opacity: 0.85 }} />
            ≤5% healthy
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-brand-muted">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: AMB, opacity: 0.85 }} />
            5–10% watch
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-brand-muted">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: RED, opacity: 0.85 }} />
            &gt;10% critical
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-brand-muted">
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-400 opacity-50" />
            Current month (partial)
          </div>
          {(data?.months?.filter(m => m.activeStart > 0).length ?? 0) > 18 && (
            <button
              className="ml-auto text-[10px] text-brand-green underline underline-offset-2"
              onClick={() => setShowAll(v => !v)}
            >
              {showAll ? 'Show last 18 months' : `Show all ${data.months.filter(m => m.activeStart > 0).length} months`}
            </button>
          )}
        </div>
      </div>

      {/* ── Recent months table ── */}
      <div className="border-t border-brand-border/40 mt-2">
        <RecentTable months={data?.months?.filter(m => m.activeStart > 0) || []} />
      </div>

      {/* ── Footer ── */}
      <div className="px-5 py-2 border-t border-brand-border/40 bg-brand-bg/60 text-[10px] text-brand-muted">
        Stripe-matched SaaS subscriptions only (≥$50/mo base plan) · Reactivations within 28 days excluded from confirmed churn
      </div>
    </div>
  )
}
