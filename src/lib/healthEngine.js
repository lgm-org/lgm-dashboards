import { HEALTH_BANDS, FLAG_NO_SALE_DAYS, UPSELL_CALLS_7D, ADD_ON_PRICES } from './healthConfig.js'
import { computeHealth, recommendedAction } from './healthScoreModel.js'

// `account.users` is Stripe's quantity on the "additional user" line items — i.e. the seats the
// client is billed for. The real number of users in the sub-account comes from GHL
// (`account.ghlUsers`, synced by the batch job); Stripe cannot tell us that, so never derive it.
export function billableUsers(account) {
  return Math.max(0, account.users ?? 0)
}
export function totalUsers(account) {
  return account.ghlUsers ?? null
}

// John's 100-point model: platform activity 45 · sales activity 40 · account health 15.
// The merged data hook attaches `_signals` (from the batch sync) and memoizes `_healthV2`.
export function accountHealth(account) {
  if (account?._healthV2) return account._healthV2
  return computeHealth(account?._signals || { hasGhlData: false })
}

export function scoreAccount(account) {
  const h = accountHealth(account)
  return {
    score: h.score,
    band:  h.band,
    health: h,
    parts: {
      platform: h.platform?.pts ?? null,
      sales:    h.sales?.pts    ?? null,
      support:  h.support?.pts  ?? null,
    },
  }
}

export function classify(score) {
  if (score === null || score === undefined) return 'no_data'
  if (score >= HEALTH_BANDS.healthy) return 'healthy'
  if (score >= HEALTH_BANDS.watch)   return 'watch'
  return 'at_risk'
}

// At risk = score below the watch band. These are the accounts Customer Success should investigate.
export function isAtRisk(account) {
  return accountHealth(account).band === 'at_risk'
}

export function isWatch(account) {
  return accountHealth(account).band === 'watch'
}

// Warning rule (John): no won sale for more than FLAG_NO_SALE_DAYS, or none recorded.
// Only evaluated once the account has GHL data.
export function isFlagged(account) {
  const h = accountHealth(account)
  if (h.band === 'no_data') return false
  const d = h.sales?.lastSale?.days
  return d === null || d === undefined || d > FLAG_NO_SALE_DAYS
}

// ── Upsell (John, 2026-10-05) ────────────────────────────────────────────────
// Qualifies when the account made UPSELL_CALLS_7D+ calls in the past 7 days (GHL) and has
// room for an add-on. Add-ons are LeadFlow AI ($50/mo) and AI Call Coach ($50/user/mo).
//   0 add-ons → 'upsell'   ·   1 add-on → 'high' (already buying; sell the second)
// Returns null when the account does not qualify.
export function upsellTier(account) {
  if (!account) return null
  if ((account.calls7d ?? 0) < UPSELL_CALLS_7D) return null
  const n = account.addOnCount ?? ((account.addOns ?? 0) > 0 ? 1 : 0)
  if (n === 0) return 'upsell'
  if (n === 1) return 'high'
  return null
}

export function isUpsellReady(account) {
  return upsellTier(account) !== null
}

// Which add-on to pitch and what it is worth per month
export function suggestAddon(account) {
  const tier    = upsellTier(account)
  const seats   = (account?.users ?? 0) + 1 // billed seats + the admin seat included in the base plan
  const coach   = ADD_ON_PRICES.callCoachPerUser * seats
  const calls   = account?.calls7d ?? 0
  if (tier === 'high') {
    if (account.hasLeadFlow && !account.hasCallCoach) return { label: `AI Call Coach (${seats} user${seats > 1 ? 's' : ''} × $50) — ${calls} calls/7d, already on LeadFlow AI`, estExtra: coach, addOn: 'AI Call Coach', priority: 'High' }
    if (account.hasCallCoach && !account.hasLeadFlow) return { label: `LeadFlow AI ($50) — ${calls} calls/7d, already on AI Call Coach`, estExtra: ADD_ON_PRICES.leadFlow, addOn: 'LeadFlow AI', priority: 'High' }
    return { label: `Second add-on — ${calls} calls/7d, one add-on already`, estExtra: Math.min(coach, ADD_ON_PRICES.leadFlow), addOn: 'LeadFlow AI or AI Call Coach', priority: 'High' }
  }
  if (tier === 'upsell') {
    return { label: `LeadFlow AI ($50) + AI Call Coach (${seats} × $50) — ${calls} calls/7d, no add-ons`, estExtra: ADD_ON_PRICES.leadFlow + coach, addOn: 'LeadFlow AI, AI Call Coach', priority: 'Medium' }
  }
  return { label: 'Does not meet the 300-calls / add-on rule', estExtra: 0, addOn: null, priority: null }
}

export function recommendAction(account) {
  return recommendedAction(accountHealth(account))
}

// Summaries used by dashboard KPIs — "active" = meaningful activity within 30 days
export function activeAccounts(accounts) {
  return accounts.filter(a => {
    const d = Number(a.lastActivity)
    return !isNaN(d) && d <= 30
  })
}

export function staleAccounts(accounts) {
  return accounts.filter(isAtRisk)
}

// Stubs for functions HealthDashboard still imports
export function revenueAtRisk()     { return 0 }
export function potentialUpsellMRR(){ return 0 }
export function concentrationRisk() { return 0 }
export function avgSubscription()   { return { mean: 0, median: 0 } }
export function avgWalletSpend()    { return { mean: 0, median: 0, count: 0 } }
export function lcCostLeakage()     { return { count: 0, totalLoss: 0, accounts: [] } }
export function dataHealthSummary(accounts) { return { flaggedCount: 0, totalCount: accounts.length, accounts: [] } }
export function dmVsAgent(accounts) {
  return {
    dm:    { count: 0, rev: 0, pct: 0 },
    agent: { count: accounts.length, rev: 0, pct: 100 },
    total: 0,
  }
}
