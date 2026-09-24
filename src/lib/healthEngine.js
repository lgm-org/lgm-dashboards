import { HEALTH_BANDS, FLAG_NO_SALE_DAYS } from './healthConfig'
import { computeHealth, recommendedAction } from './healthScoreModel'

// First user on every account is free — only additional seats are billable.
export function billableUsers(account) {
  return Math.max(0, (account.users ?? 0) - 1)
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
