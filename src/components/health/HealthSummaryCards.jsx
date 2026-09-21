import { useCountUp } from '../../hooks/useCountUp'
import InfoTip from './InfoTip'

const G   = '#8CC63F'
const RED = '#EF4444'
const AMB = '#EAB308'

function fmt(n) { return '$' + Math.round(n).toLocaleString() }

function Card({ label, value, sub, icon, accentColor, delay, decimals = 0, prefix = '', suffix = '', infoText, onClick, clickable, highlighted }) {
  const displayed = useCountUp(typeof value === 'number' ? value : 0, { duration: 1200, delay, decimals })
  return (
    <div
      onClick={onClick}
      className={`card-hover animate-fade-in-up rounded-2xl border bg-white p-5 sm:p-6 flex flex-col gap-2 ${clickable ? 'cursor-pointer' : ''}`}
      style={{
        animationDelay: `${delay}ms`,
        boxShadow: highlighted
          ? '0 4px 24px rgba(140,198,63,0.18), 0 1px 4px rgba(140,198,63,0.10)'
          : '0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.04)',
        borderLeft:  accentColor ? `3px solid ${accentColor}` : undefined,
        borderColor: highlighted ? 'rgba(140,198,63,0.55)' : undefined,
        outline:     highlighted ? '2px solid rgba(140,198,63,0.35)' : undefined,
        outlineOffset: highlighted ? '2px' : undefined,
        transition: 'box-shadow 0.3s, border-color 0.3s, outline 0.3s',
      }}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-brand-muted text-[10px] font-bold uppercase tracking-[0.18em] leading-tight">{label}</span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {infoText && <InfoTip text={infoText} position="top-end" />}
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base border border-brand-border bg-brand-bg">{icon}</div>
        </div>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="num text-[38px] sm:text-[48px] font-bold leading-none text-brand-text tracking-tight">
          {prefix}{decimals > 0 ? displayed.toFixed(decimals) : Math.round(displayed)}{suffix}
        </span>
      </div>
      <p className="text-brand-muted text-[11px] leading-snug">{sub}</p>
      {clickable && <p className="text-[10px] text-brand-muted/60 font-medium mt-0.5">Click to expand ↓</p>}
    </div>
  )
}

// Card shown when we have no data source for the metric yet
function PendingCard({ label, icon, delay, infoText, pendingNote }) {
  return (
    <div
      className="animate-fade-in-up rounded-2xl border border-dashed border-brand-border bg-white p-5 sm:p-6 flex flex-col gap-2 opacity-70"
      style={{ animationDelay: `${delay}ms`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-brand-muted text-[10px] font-bold uppercase tracking-[0.18em] leading-tight">{label}</span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {infoText && <InfoTip text={infoText} position="top-end" />}
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base border border-dashed border-brand-border bg-brand-bg">{icon}</div>
        </div>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-[38px] sm:text-[48px] font-bold leading-none text-brand-border tracking-tight">—</span>
      </div>
      <p className="text-[11px] leading-snug text-amber-600 font-medium">⚠ {pendingNote}</p>
    </div>
  )
}

export default function HealthSummaryCards({
  total = 0,
  filteredCount = null,
  activeCount = 0,
  staleCount = 0,
  newCount = 0,
  newPeriodLabel = 'last 30 days',
  avgScore = 0,
  avgTenureDays = 0,
  dateFiltered = false,
  // billing fields — all 0 until Stripe / billing sheet connected
  billedCount = 0,
  atRisk = 0,
  healthy = 0,
  riskRevenue = 0,
  avgSub = 0,
  medianSub = 0,
  avgUsers = 0,
  newMRR = 0,
  onNewClientsClick,
  onNeedsCheckinClick,
  // Freshdesk ticket totals — agency-wide, independent of billing data
  freshdeskLoaded = false,
  openTickets = 0,
  pendingTickets = 0,
  urgentTickets = 0,
  onOpenTicketsClick,
  onPendingTicketsClick,
  // Role-based: admins see billing cards, account managers do not
  isAdmin = true,
}) {
  const hasBilling = billedCount > 0

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">

      {/* ── Live GHL data ─────────────────────────────────── */}
      <Card
        label="Total GHL Sub-accounts"
        value={total}
        sub={filteredCount !== null && filteredCount < total
          ? `Showing ${filteredCount} of ${total} · filter active`
          : 'Live from GoHighLevel API · sandbox excluded'}
        icon="🔗"
        delay={0}
        infoText="Total active client sub-accounts pulled live from GoHighLevel on every dashboard load. Internal sandbox and test accounts are excluded."
      />

      <Card
        label="Active Accounts"
        value={activeCount}
        sub={`${total ? Math.round(activeCount / total * 100) : 0}% of portfolio · active in last 30 days`}
        icon="🟢"
        accentColor={G}
        delay={20}
        infoText="Accounts with a detected platform signal in the last 30 days — LC wallet charge (month-end bucket) or GHL sub-account settings update, whichever is more recent. ⚠ This is NOT a user-login count — GHL does not expose login timestamps via API. Click any account to see real-time CRM & portal-login data in the detail modal."
      />

      <Card
        label={dateFiltered ? 'New Clients' : 'New Clients — Last 30 Days'}
        value={newCount}
        sub={`Joined GHL in ${newPeriodLabel}${isAdmin && hasBilling && newMRR ? ` · ${fmt(newMRR)}/mo` : ''}`}
        icon="✨"
        accentColor={G}
        delay={40}
        highlighted={dateFiltered}
        infoText={dateFiltered
          ? `Clients whose GHL sub-account was created in the ${newPeriodLabel} selected above. Click to jump to the accounts table.`
          : "Showing clients joined in the last 30 days by default. Use the 'Today' or 'Yesterday' date filter above to reconcile new sign-ups daily. Click to jump to the accounts table."
        }
        clickable={!!onNewClientsClick}
        onClick={onNewClientsClick}
      />

      <Card
        label="Needs Check-in"
        value={staleCount}
        sub={`${total ? Math.round(staleCount / total * 100) : 0}% of portfolio · no activity in 30+ days`}
        icon="⚠️"
        accentColor={RED}
        delay={60}
        infoText="Accounts with no detected platform signal in over 30 days — LC wallet charges or GHL sub-account settings update. Not a user-login metric. Click to jump to the Needs Attention table."
        clickable={!!onNeedsCheckinClick}
        onClick={onNeedsCheckinClick}
      />

      <Card
        label="Avg Health Score"
        value={Math.round(avgScore)}
        sub="Portfolio average · 0–100"
        icon="📊"
        suffix="/100"
        accentColor={avgScore >= 70 ? G : avgScore >= 40 ? AMB : RED}
        delay={80}
        infoText="Average health score across all accounts (0–100). Based on real LC platform activity recency (falls back to GHL settings date when no LC data). Enhanced score per account (activity 30% · CRM contacts 40% · pipeline 30%) appears when you open each account's detail modal."
      />

      <Card
        label="Avg Client Tenure"
        value={Math.round(avgTenureDays / 30)}
        sub={`~${Math.round(avgTenureDays)} days avg · since joining GHL`}
        icon="📅"
        suffix=" mo"
        delay={100}
        infoText="Average months clients have been active GHL sub-accounts. Longer tenure = lower churn risk."
      />

      {/* ── Billing-dependent fields — admin only ───────────────────────────── */}
      {isAdmin && hasBilling ? (
        <>
          <Card
            label="At-Risk Accounts"
            value={atRisk}
            sub={`Revenue at risk: ${fmt(riskRevenue)}/mo`}
            icon="🚨"
            accentColor={RED}
            delay={120}
            infoText="Accounts inactive in GHL for 30+ days with an active Stripe subscription. These are churn risks — flag for a check-in call."
          />
          <Card
            label="Healthy Accounts"
            value={healthy}
            sub={`Score 70+ · ${billedCount ? Math.round(healthy / billedCount * 100) : 0}% of billed`}
            icon="✅"
            accentColor={G}
            delay={140}
            infoText="Accounts scoring 70+ on the activity-based health score. Active in GHL recently and in good standing."
          />
          <Card
            label="Avg Subscription"
            value={Math.round(avgSub)}
            sub={`Median ${fmt(medianSub)}/mo per billed account`}
            icon="💰"
            prefix="$"
            delay={160}
            infoText="Average total monthly charges per Stripe-matched account — base plan + billed user seats + add-ons. Does not include LC wallet usage."
          />
          <Card
            label="Avg Users / Account"
            value={+avgUsers}
            sub="Billed seat count · across accounts with ≥ 1 user"
            icon="👥"
            decimals={1}
            delay={180}
            infoText="Average billed GHL user seats per Stripe-matched account. Low seat count = upsell opportunity. Seats are billed through Stripe — total GHL members (including free seats) will show once Cliff's daily sync is live."
          />
        </>
      ) : isAdmin ? (
        <>
          <PendingCard label="At-Risk Accounts (by Revenue)"  icon="🚨" delay={120} pendingNote="Requires billing data to calculate revenue at risk" infoText="Will show: accounts inactive 30+ days with revenue at churn risk. Needs Stripe or billing sheet." />
          <PendingCard label="Healthy Accounts (by Score)"    icon="✅" delay={140} pendingNote="Health band available — revenue breakdown needs billing data" infoText="Count of accounts scoring 70+ is computable now; revenue split needs billing sheet." />
          <PendingCard label="Avg Monthly Subscription (MRR)" icon="💰" delay={160} pendingNote="Requires billing data — connect Stripe or billing sheet" infoText="Will show: average monthly charges per client (plan + seats + add-ons). Requires Stripe or the LGM billing sheet." />
          <PendingCard label="Avg Users / Account"            icon="👥" delay={180} pendingNote="Available per account via OAuth — bulk aggregate pending" infoText="Billed user seat average. Available per account in the detail modal now; bulk average requires Stripe matching." />
        </>
      ) : null}

      {/* ── Freshdesk support tickets — agency-wide ─────────────────────────── */}
      {freshdeskLoaded ? (
        <>
          <Card
            label="Open Tickets"
            value={openTickets + pendingTickets}
            sub="Open + pending · click to view"
            icon="🎫"
            accentColor={(openTickets + pendingTickets) > 0 ? RED : G}
            delay={220}
            infoText="All unresolved support tickets (open + pending customer reply) across every client account, pulled live from Freshdesk. Click to see subjects and which account each one belongs to."
            clickable={!!onOpenTicketsClick}
            onClick={onOpenTicketsClick}
          />
          <Card
            label="Urgent Tickets"
            value={urgentTickets}
            sub="High/urgent priority · needs action · click to view"
            icon="🔥"
            accentColor={urgentTickets > 0 ? RED : G}
            delay={240}
            infoText="Open or pending tickets flagged High or Urgent priority in Freshdesk — the ones that actually need action now. Click to see subjects and which account each one belongs to."
            clickable={!!onPendingTicketsClick}
            onClick={onPendingTicketsClick}
          />
        </>
      ) : (
        <>
          <PendingCard label="Open Tickets"    icon="🎫" delay={220} pendingNote="Loading Freshdesk ticket data…" infoText="Will show: open support tickets across all client accounts." />
          <PendingCard label="Pending Tickets" icon="⏳" delay={240} pendingNote="Loading Freshdesk ticket data…" infoText="Will show: tickets awaiting customer reply across all client accounts." />
        </>
      )}

    </div>
  )
}
