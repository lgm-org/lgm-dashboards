import { useCountUp } from '../../hooks/useCountUp'
import InfoTip from '../health/InfoTip'

const G   = '#8CC63F'
const ORG = '#FF6112'
const AMB = '#EAB308'
const RED = '#EF4444'

function fmt(n, decimals = 0) {
  if (n === null || n === undefined) return '—'
  return decimals > 0 ? Number(n).toFixed(decimals) : Math.round(n).toLocaleString()
}

// Per John (2026-09-12): when a client's GHL account genuinely doesn't have
// this custom field set up, the message itself should tell them what to do
// about it, not just report the gap.
const FIELD_MISSING_TEXT = "Field not found in GHL — let us know and we'll add it"

function Card({ label, value, prefix = '', suffix = '', decimals = 0, sub, icon, accentColor, delay, infoText, naText = FIELD_MISSING_TEXT }) {
  const num = typeof value === 'number' ? value : 0
  const displayed = useCountUp(num, { duration: 1100, delay, decimals })
  const isNull = value === null || value === undefined

  return (
    <div
      className="card-hover animate-fade-in-up rounded-2xl border bg-white p-4 sm:p-5 flex flex-col gap-2"
      style={{
        animationDelay: `${delay}ms`,
        boxShadow: '0 4px 20px rgba(0,0,0,0.07), 0 1px 4px rgba(0,0,0,0.04)',
        borderLeft: accentColor ? `3px solid ${accentColor}` : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-brand-muted text-[10px] font-bold uppercase tracking-[0.16em] leading-tight">{label}</span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {infoText && <InfoTip text={infoText} position="top-end" />}
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm border border-brand-border bg-brand-bg">{icon}</div>
        </div>
      </div>
      <div className="flex items-baseline gap-0.5">
        {isNull ? (
          <span className="text-[32px] sm:text-[38px] font-bold leading-none text-brand-border tracking-tight">—</span>
        ) : (
          <span className="num text-[32px] sm:text-[38px] font-bold leading-none text-brand-text tracking-tight">
            {prefix}{decimals > 0 ? displayed.toFixed(decimals) : Math.round(displayed).toLocaleString()}{suffix}
          </span>
        )}
      </div>
      {sub && <p className="text-brand-muted text-[11px] leading-snug">{sub}</p>}
      {isNull && <p className="text-[10px] text-amber-500 font-medium">{naText}</p>}
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div className="col-span-4 flex items-center gap-3 pt-2">
      <span className="text-brand-heading text-[11px] font-bold uppercase tracking-[0.2em]">{children}</span>
      <div className="flex-1 h-px bg-brand-border" />
    </div>
  )
}

export default function OverviewCards({ overview, leadBuyingEnabled = true, commissionRate = 0.105 }) {
  const {
    leadCount, newCustomers, writtenPremium, premiumAvgPerCustomer,
    leadCost, commission, profit, ppl,
    closeRate, cpp,
    totalCalls, callsPerLead, callsForCustomers, callsToClose,
    dispositionCount, dispoRate,
    smsReplies, smsReplyRate,
    badLeads, badLeadRate,
    quotes, quoteRate,
    rateTooHigh, rateTooHighRate,
    quotesToCloseRate,
    optOuts, optOutRate,
  } = overview

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">

      {/* ── PRODUCTION ───────────────────────────────────────────── */}
      <SectionLabel>Production</SectionLabel>

      <Card label="Leads" value={leadCount} icon="👥" delay={0} accentColor={G}
        sub="Total contacts in date range"
        infoText="count(crm_id) — total contacts created in the selected window." />

      <Card label="New Customers" value={newCustomers} icon="🏆" delay={40} accentColor={G}
        sub={leadCount ? `${fmt(closeRate, 1)}% close rate` : undefined}
        infoText="count({Opp Sold Date}) — contacts with a won / Policy Sold opportunity." />

      <Card label="Written Premium" value={writtenPremium} prefix="$" icon="💰" delay={80} accentColor={G}
        sub="Sum of won opportunity value"
        infoText="sumIf(monetaryValue, pipelineStageId = 'Policy Sold')" />

      <Card label="Avg Premium / Customer" value={premiumAvgPerCustomer} prefix="$" decimals={0} icon="📊" delay={120}
        sub="Written Premium ÷ New Customers"
        naText={writtenPremium === 0 ? 'No Policy Sold opportunities in this window' : FIELD_MISSING_TEXT}
        infoText="avgIf(monetaryValue, pipelineStageId = 'Policy Sold')" />

      {/* ── FINANCIALS ───────────────────────────────────────────── */}
      <SectionLabel>Financials</SectionLabel>

      {leadBuyingEnabled && (
        <Card label="Lead Cost" value={leadCost} prefix="$" icon="🧾" delay={160}
          sub="sum({Lead Price}) across all leads"
          infoText="sum({Lead Price}) — total spend on leads in the date range." />
      )}

      <Card label={`Commission (${fmt(commissionRate * 100, commissionRate * 100 % 1 === 0 ? 0 : 1)}%)`} value={commission} prefix="$" icon="💼" delay={200} accentColor={G}
        sub={`Written Premium × ${fmt(commissionRate * 100, 1)}%`}
        infoText="{Written Premium} × commission rate — set the rate in the controls above." />

      {leadBuyingEnabled && (
        <Card label="Profit" value={profit} prefix="$" icon="📈" delay={240}
          accentColor={profit !== null ? (profit >= 0 ? G : RED) : undefined}
          sub="Commission − Lead Cost"
          infoText="Commission − {Lead Cost}" />
      )}

      {leadBuyingEnabled && (
        <Card label="PPL (Profit Per Lead)" value={ppl} prefix="$" decimals={2} icon="💹" delay={280}
          accentColor={ppl !== null ? (ppl >= 0 ? G : RED) : undefined}
          sub="Profit ÷ Leads"
          infoText="Profit / Leads — how much profit each lead generates on average." />
      )}

      {/* ── SALES EFFICIENCY ─────────────────────────────────────── */}
      <SectionLabel>Sales Efficiency</SectionLabel>

      <Card label="Close Rate" value={closeRate} suffix="%" decimals={1} icon="🎯" delay={320} accentColor={G}
        sub="New Customers ÷ Leads"
        infoText="{New Customers} / Leads" />

      {leadBuyingEnabled && (
        <Card label="Cost Per Policy (CPP)" value={cpp} prefix="$" decimals={0} icon="🧮" delay={360}
          sub="Lead Cost ÷ New Customers"
          naText={leadCost === null ? FIELD_MISSING_TEXT : 'No new customers in this window'}
          infoText="{Lead Cost} / {New Customers}" />
      )}

      <Card label="Quote Rate" value={quoteRate} suffix="%" decimals={1} icon="📋" delay={400}
        sub="Quotes ÷ Leads"
        infoText="Quotes / Leads" />

      <Card label="Quotes to Close" value={quotesToCloseRate} suffix="%" decimals={1} icon="🔒" delay={440}
        sub="New Customers ÷ Quotes"
        naText={quotes === null || newCustomers === null ? FIELD_MISSING_TEXT : 'No quotes in this window'}
        infoText="{New Customers} / Quotes" />

      {/* ── CALL ACTIVITY ────────────────────────────────────────── */}
      <SectionLabel>Call Activity</SectionLabel>

      <Card label="Total Calls" value={totalCalls} icon="📞" delay={480}
        sub="sum({Call Count}) across all leads"
        infoText="sum({Call Count})" />

      <Card label="Calls Per Lead" value={callsPerLead} decimals={2} icon="📱" delay={520}
        sub="Total Calls ÷ Leads"
        infoText="sum({Call Count}) / Leads" />

      <Card label="Calls for Customers" value={callsForCustomers} icon="🤝" delay={560}
        sub="Call count on won leads only"
        infoText="sumIf({Call Count}, pipelineStageId = 'Policy Sold')" />

      <Card label="Calls to Close" value={callsToClose} decimals={1} icon="🏁" delay={600} accentColor={AMB}
        sub="Calls for Customers ÷ New Customers"
        naText={callsForCustomers === null ? FIELD_MISSING_TEXT : 'No new customers in this window'}
        infoText="{Calls for Customers} / {New Customers} — avg calls to win a deal." />

      {/* ── LEAD QUALITY ─────────────────────────────────────────── */}
      <SectionLabel>Lead Quality</SectionLabel>

      <Card label="Dispositions" value={dispositionCount} icon="✅" delay={640}
        sub="count({Disposition Date and Time})"
        infoText="Leads with a disposition date filled in." />

      <Card label="Dispo Rate" value={dispoRate} suffix="%" decimals={1} icon="📅" delay={680} accentColor={AMB}
        sub="Dispositions ÷ Leads"
        infoText="Dispositions / Leads" />

      <Card label="Bad Leads" value={badLeads} icon="🚫" delay={720}
        accentColor={badLeads ? RED : undefined}
        sub="count({Bad Lead Date})"
        infoText="Leads where the Bad Lead Date field is set." />

      <Card label="Bad Lead Rate" value={badLeadRate} suffix="%" decimals={1} icon="⚠️" delay={760}
        accentColor={badLeadRate !== null && badLeadRate > 10 ? RED : undefined}
        sub="{Bad Leads} ÷ Leads"
        infoText="{Bad Leads} / Leads" />

      {/* ── ENGAGEMENT ───────────────────────────────────────────── */}
      <SectionLabel>Engagement</SectionLabel>

      <Card label="Quotes" value={quotes} icon="📝" delay={800}
        sub="count({Quoted Timestamp})"
        infoText="Leads where the Quoted Timestamp field is set." />

      <Card label="SMS Replies" value={smsReplies} icon="💬" delay={840}
        sub="SMS replied, excl. Bad Lead / DNC"
        infoText="countIf({SMS reply date}, pipelineStageId <> 'Bad Lead / DNC')" />

      <Card label="SMS Reply Rate" value={smsReplyRate} suffix="%" decimals={1} icon="📲" delay={880} accentColor={AMB}
        sub="{SMS Replies} ÷ Leads"
        infoText="{SMS Replies} / Leads" />

      <Card label="Rate Too High" value={rateTooHigh} icon="💸" delay={920}
        accentColor={rateTooHigh ? ORG : undefined}
        sub={rateTooHighRate !== null ? `${fmt(rateTooHighRate, 1)}% of leads` : 'countIf(X-dated Reason = "Rate too high")'}
        infoText="countIf(Id, {X-dated Reason} = 'Rate is too high')" />

      <Card label="Opt Outs" value={optOuts} icon="🔕" delay={960}
        accentColor={optOuts ? RED : undefined}
        sub={optOutRate !== null ? `${fmt(optOutRate, 1)}% of leads` : 'count({Opt Out Date})'}
        infoText="count({Opt Out Date}) — leads who opted out of communication." />

    </div>
  )
}
