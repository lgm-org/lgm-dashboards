import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import InfoTip from './InfoTip'

const G   = '#8CC63F'
const AMB = '#EAB308'

function fmt(n) { return '$' + Math.round(n).toLocaleString() }

function StatLine({ dot, label, count, rev, pct, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between py-2.5 border-b border-brand-border/60 last:border-0 ${onClick ? 'cursor-pointer hover:bg-brand-bg/60 rounded-lg -mx-1.5 px-1.5' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: dot }} />
        <span className="text-brand-heading font-semibold text-[13px]">{label}</span>
        <span className="text-brand-muted text-[11px]">({count} accounts)</span>
      </div>
      <div className="text-right">
        <p className="num text-[13px] font-bold text-brand-text">{fmt(rev)}</p>
        <p className="text-[10px] text-brand-muted">{pct}% of total</p>
      </div>
    </div>
  )
}

function BillingShimmer() {
  return (
    <div className="px-5 sm:px-6 py-6 animate-pulse">
      <div className="flex gap-6">
        <div className="w-28 h-28 rounded-full bg-brand-border/30 flex-shrink-0" />
        <div className="flex-1 space-y-3 pt-2">
          <div className="h-3 bg-brand-border/30 rounded w-3/4" />
          <div className="h-3 bg-brand-border/30 rounded w-1/2" />
          <div className="h-3 bg-brand-border/30 rounded w-2/3" />
          <div className="h-3 bg-brand-border/30 rounded w-2/5" />
        </div>
      </div>
    </div>
  )
}

function PendingBanner() {
  return (
    <div className="px-5 sm:px-6 py-8 flex flex-col items-center gap-3 text-center">
      <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-xl">
        📊
      </div>
      <div>
        <p className="text-brand-heading font-semibold text-sm">Billing Data Not Connected</p>
        <p className="text-brand-muted text-[12px] mt-1.5 max-w-[320px] leading-relaxed">
          Revenue split between DM and Agent account types will appear here once billing data is connected.
          Requires: Stripe API key or the LGM billing sheet (plan type, account type, monthly charges per client).
        </p>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-3 w-full max-w-[280px]">
        <div className="rounded-xl border border-dashed border-brand-border bg-brand-bg p-3 text-center">
          <p className="text-[10px] text-brand-muted uppercase tracking-wider">DM Revenue</p>
          <p className="text-[18px] font-bold text-brand-border mt-0.5">—</p>
          <p className="text-[10px] text-amber-600 mt-0.5">⚠ Pending</p>
        </div>
        <div className="rounded-xl border border-dashed border-brand-border bg-brand-bg p-3 text-center">
          <p className="text-[10px] text-brand-muted uppercase tracking-wider">Agent Revenue</p>
          <p className="text-[18px] font-bold text-brand-border mt-0.5">—</p>
          <p className="text-[10px] text-amber-600 mt-0.5">⚠ Pending</p>
        </div>
      </div>
    </div>
  )
}

export default function DmAgentBreakdown({ breakdown, avgHealthDm, avgHealthAgent, hasBilling = false, stripeLoading = false, onTypeClick }) {
  return (
    <div
      className="animate-fade-in-up rounded-2xl border border-brand-border bg-white"
      style={{ animationDelay: '360ms', boxShadow: '0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.04)' }}
    >
      <div className="px-5 sm:px-6 py-4 border-b border-brand-border flex items-start justify-between gap-2">
        <div>
          <h2 className="text-brand-heading font-semibold text-sm">DM vs Agent Breakdown</h2>
          <p className="text-brand-muted text-[11px] mt-0.5">Revenue distribution by account type</p>
        </div>
        <InfoTip
          text={"Rule: Agent = sub-account is listed in the DM Footprint (Supabase dm_agent_map, synced hourly by n8n from the GHL contact custom field that assigns agents to a DM). DM = every other sub-account.\nRevenue and counts include Stripe-matched accounts only. Avg health = mean health score of each group."}
          position="top-end"
        />
      </div>

      {stripeLoading ? <BillingShimmer /> : !hasBilling ? <PendingBanner /> : (
        <div className="px-5 sm:px-6 py-5 flex flex-col sm:flex-row gap-6 items-center">
          {/* Donut */}
          <div className="w-28 h-28 flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={[
                  { name: 'DM',    value: breakdown?.dm?.rev    || 0.01, color: G   },
                  { name: 'Agent', value: breakdown?.agent?.rev || 0.01, color: AMB },
                ]} cx="50%" cy="50%" innerRadius={28} outerRadius={48}
                  dataKey="value" paddingAngle={3}>
                  <Cell fill={G} />
                  <Cell fill={AMB} />
                </Pie>
                <Tooltip
                  formatter={(v, n) => [fmt(v), n]}
                  contentStyle={{ fontSize: 11, border: '1px solid #E5E7E5', borderRadius: 8 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Stats */}
          <div className="flex-1 min-w-0 w-full">
            <StatLine dot={G}   label="DM"    count={breakdown?.dm?.count ?? 0}    rev={breakdown?.dm?.rev ?? 0}    pct={breakdown?.dm?.pct ?? 0}    onClick={onTypeClick ? () => onTypeClick('DM')    : undefined} />
            <StatLine dot={AMB} label="Agent" count={breakdown?.agent?.count ?? 0} rev={breakdown?.agent?.rev ?? 0} pct={breakdown?.agent?.pct ?? 0} onClick={onTypeClick ? () => onTypeClick('Agent') : undefined} />

            <div className="flex items-center justify-between pt-2.5">
              <span className="text-brand-muted text-[11px] font-semibold">Total Revenue</span>
              <span className="num text-[13px] font-bold text-brand-text">{fmt(breakdown?.total ?? 0)}</span>
            </div>

            {(avgHealthDm !== null || avgHealthAgent !== null) && (
              <div className="mt-3 pt-3 border-t border-brand-border/60 grid grid-cols-2 gap-3">
                <div className="text-center rounded-xl bg-brand-bg border border-brand-border p-2">
                  <p className="text-[10px] text-brand-muted uppercase tracking-wider">DM Avg Health</p>
                  <p className="num font-bold text-[15px] mt-0.5" style={{ color: G }}>{avgHealthDm ?? '—'}</p>
                </div>
                <div className="text-center rounded-xl bg-brand-bg border border-brand-border p-2">
                  <p className="text-[10px] text-brand-muted uppercase tracking-wider">Agent Avg Health</p>
                  <p className="num font-bold text-[15px] mt-0.5" style={{ color: AMB }}>{avgHealthAgent ?? '—'}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
