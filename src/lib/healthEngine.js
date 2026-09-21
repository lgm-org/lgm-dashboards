import { HEALTH_BANDS } from './healthConfig'

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

export function scoreAccount(account) {
  // Use only lastActivity — real contact activity from GHL (via Supabase cache or LC wallet proxy).
  // ghlDaysSinceUpdate (sub-account settings update) is intentionally NOT used here:
  // settings rarely change so it produces false at-risk classifications for active clients.
  // Null lastActivity → score 50 (Watch/neutral) until real data is available.
  const activity = activityScore(account.lastActivity)
  return {
    score: Math.min(100, Math.max(0, activity)),
    parts: { activity },
  }
}

// Enhanced score used in AccountModal once live metrics load.
// Weights: activity 30% · contacts 40% · opportunities 30% (tenure + team members removed per John)
function contactScore(n) {
  if (!n || n <= 0)      return 0
  if (n < 100)           return 10 + (n / 100) * 20           // 10–30
  if (n < 500)           return 30 + ((n - 100) / 400) * 20   // 30–50
  if (n < 2000)          return 50 + ((n - 500) / 1500) * 20  // 50–70
  if (n < 10000)         return 70 + ((n - 2000) / 8000) * 20 // 70–90
  return 90 + Math.min(10, ((n - 10000) / 40000) * 10)        // 90–100
}

function opportunityScore(n) {
  if (!n || n <= 0)   return 5
  if (n < 10)         return 10 + (n / 10) * 20           // 10–30
  if (n < 50)         return 30 + ((n - 10) / 40) * 25    // 30–55
  if (n < 200)        return 55 + ((n - 50) / 150) * 20   // 55–75
  if (n < 1000)       return 75 + ((n - 200) / 800) * 15  // 75–90
  return Math.min(100, 90 + ((n - 1000) / 4000) * 10)     // 90–100
}

export function enhancedScoreAccount(account, liveMetrics) {
  const activity = activityScore(account.lastActivity)
  const contacts = contactScore(liveMetrics?.contacts)
  const opps     = opportunityScore(liveMetrics?.opportunities)
  const score    = Math.round(
    activity * 0.30 +
    contacts * 0.40 +
    opps     * 0.30
  )
  return {
    score: Math.min(100, Math.max(0, score)),
    parts: { activity, contacts, opps },
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

export function recommendAction(account) {
  const days = account.lastActivity
  if (days === null || days === undefined) return 'Sync activity data — open account to load'
  const d = Number(days)
  if (d <= 3)   return 'Active — no action needed'
  if (d <= 14)  return 'Check in — account activity slowing'
  if (d <= 30)  return 'Reach out — 2+ weeks since last GHL activity'
  if (d <= 60)  return 'Urgent: 30+ days inactive — schedule a call'
  return 'Critical: 60+ days since any GHL activity'
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
