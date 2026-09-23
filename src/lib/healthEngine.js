import { HEALTH_BANDS, FLAG_NO_SALE_DAYS } from './healthConfig'

const daysSince = (iso) => iso
  ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
  : null

// The three GHL signals John wants scored: contact created, contact updated, won sale.
// `newest` is the smallest day-count; falls back to account.lastActivity (LC wallet month)
// only when none of the three exist.
export function activitySignals(account) {
  const contactCreated = daysSince(account?.lastContactCreated)
  const contactUpdated = daysSince(account?.lastContactUpdate)
  const sale           = daysSince(account?.lastSaleDate)
  const ghl = [contactCreated, contactUpdated, sale].filter(d => d !== null)
  const hasGhl = ghl.length > 0
  const newest = hasGhl ? Math.min(...ghl) : (account?.lastActivity ?? null)
  return { contactCreated, contactUpdated, sale, newest, hasGhl }
}

// First user on every account is free — only additional seats are billable.
export function billableUsers(account) {
  return Math.max(0, (account.users ?? 0) - 1)
}

// Score based purely on GHL activity recency (tenure removed per John's feedback).

function activityScore(daysSinceUpdate) {
  if (daysSinceUpdate === null || daysSinceUpdate === undefined) return 50
  const d = Number(daysSinceUpdate)
  if (isNaN(d))   return 50
  if (d <= 3)     return 100
  if (d <= 7)     return 90
  if (d <= 14)    return 80
  if (d <= 30)    return 70   // active within 30 days = healthy band (matches Active Accounts KPI)
  if (d <= 60)    return 40
  if (d <= 90)    return 20
  return 5
}

// Score = the best (most recent) of the three GHL signals. Each signal is scored on the same
// day table; the account's score is the highest of them. Contact count / opportunity count are
// deliberately NOT part of the score (per John). Null everywhere → 50 (neutral).
export function scoreAccount(account) {
  const s = activitySignals(account)
  const parts = {
    contactCreated: s.contactCreated !== null ? activityScore(s.contactCreated) : null,
    contactUpdated: s.contactUpdated !== null ? activityScore(s.contactUpdated) : null,
    sale:           s.sale           !== null ? activityScore(s.sale)           : null,
  }
  const activity = activityScore(s.newest)
  return {
    score: Math.min(100, Math.max(0, activity)),
    parts: { ...parts, activity },
    signalDays: s,
  }
}

export function classify(score) {
  if (score >= HEALTH_BANDS.healthy) return 'healthy'
  if (score >= HEALTH_BANDS.watch)   return 'watch'
  return 'at_risk'
}

// At-risk = no GHL contact activity for 30+ days (only when we have real data)
export function isAtRisk(account) {
  const days = account.lastActivity
  if (days === null || days === undefined) return false
  return Number(days) > 30
}

// Flag rule (John): no won sale for more than FLAG_NO_SALE_DAYS. Only evaluated once the
// account has synced GHL data (otherwise every unsynced account would be flagged).
export function isFlagged(account) {
  const s = activitySignals(account)
  if (!s.hasGhl) return false
  return s.sale === null || s.sale > FLAG_NO_SALE_DAYS
}

// "Needs attention" — account hasn't been touched in 14+ days (watch zone)
export function isWatch(account) {
  const days = account.lastActivity
  if (days === null || days === undefined) return false
  const d = Number(days)
  return d > 14 && d <= 30
}

export function isUpsellReady(account) {
  if (!account?.planPrice || account.planPrice <= 0) return false
  const days = account.lastActivity
  if (days === null || days === undefined) return false
  if (Number(days) > 60) return false
  // Must show engagement: users billed OR LC wallet activity
  const engaged = (account.users ?? 0) >= 1 || (account.lcWalletCharges ?? 0) > 0
  if (!engaged) return false
  // Has upsell headroom: fewer than 4 users, or no add-ons yet
  return (account.users ?? 0) < 4 || (account.addOns ?? 0) === 0
}

export function suggestAddon(account) {
  if (!account?.planPrice || account.planPrice <= 0) {
    return { label: 'Connect billing to identify opportunities', estExtra: 0 }
  }

  const lc        = account.lcWalletCharges ?? 0
  const addOns    = account.addOns ?? 0
  const seats     = account.users ?? 0
  const rev       = account.planPrice ?? 0
  const isMonthly = (account.planInterval ?? 'month') === 'month'
  const isDM      = account.accountType === 'DM'

  // High LC spend + no add-ons → AI automation is a clear fit
  if (lc > 100 && addOns === 0) {
    return { label: 'LeadFlow AI (active LC user — ready for automation)', estExtra: 50 }
  }
  // No add-ons → LeadFlow AI first pitch
  if (addOns === 0) {
    return { label: 'LeadFlow AI Assistant', estExtra: 50 }
  }
  // Has add-ons, low seat count → expand seats
  if (seats > 0 && seats < 3) {
    const add = 3 - seats
    return { label: `Add ${add} User Seat${add > 1 ? 's' : ''} ($64/ea)`, estExtra: add * 64 }
  }
  // Monthly DM account → annual plan upgrade
  if (isDM && isMonthly && rev >= 200) {
    const annualSavings = Math.round(rev * 0.16 * 12)
    return { label: `Annual plan (save ~$${annualSavings}/yr)`, estExtra: Math.round(rev * 0.20) }
  }
  return { label: 'Seat expansion or plan upgrade', estExtra: Math.round(rev * 0.20) }
}

// Derived from the same score bands as the health pill so the two can never disagree,
// plus the no-sale flag rule on top.
export function recommendAction(account) {
  const s = activitySignals(account)
  if (s.newest === null || s.newest === undefined) return 'No activity data yet — sync GHL activity'
  const band = classify(activityScore(s.newest))
  if (band === 'at_risk') return `Critical: ${s.newest} days since any GHL activity — schedule a call`
  if (band === 'watch')   return `Reach out — ${s.newest} days since last GHL activity`
  if (isFlagged(account)) {
    return s.sale === null
      ? `Active, but no won sale recorded — review pipeline (flag: >${FLAG_NO_SALE_DAYS} days)`
      : `Active, but last sale was ${s.sale} days ago — review pipeline (flag: >${FLAG_NO_SALE_DAYS} days)`
  }
  return 'Active — no action needed'
}

// Summaries used by dashboard KPIs
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
