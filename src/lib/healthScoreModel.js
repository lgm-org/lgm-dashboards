// Customer health score — John's 100-point model (2026-09-24).
// Pure functions, shared by the batch sync (server) and the dashboard (client).
//
//   Platform Activity  45  = rolling 7-day calls (30) + days since last call (15)
//   Sales Activity     40  = days since last won sale (25) + won sales last 30 days (15)
//   Account Health     15  = Freshdesk tickets last 7 days
//
// Not scored (display only): new contacts, contact updates, yesterday's in/out calls,
// 30-day sales trend, add-ons, billing, LC wallet.

import { HEALTH_BANDS, FLAG_NO_SALE_DAYS } from './healthConfig.js'

export const CATEGORY_MAX = { platform: 45, sales: 40, support: 15 }
export const SCORE_BANDS = HEALTH_BANDS
export const NO_SALE_WARNING_DAYS = FLAG_NO_SALE_DAYS

export function scoreCalls7d(n) {
  if (n === null || n === undefined) return 0
  if (n >= 100) return 30
  if (n >= 75)  return 25
  if (n >= 50)  return 20
  if (n >= 25)  return 12
  if (n >= 1)   return 5
  return 0
}

export function scoreLastCall(days) {
  if (days === null || days === undefined) return 0
  if (days <= 1)  return 15
  if (days <= 3)  return 12
  if (days <= 7)  return 8
  if (days <= 14) return 4
  return 0
}

export function scoreLastSale(days) {
  if (days === null || days === undefined) return 0
  if (days <= 7)  return 25
  if (days <= 14) return 20
  if (days <= 30) return 12
  if (days <= 60) return 5
  return 0
}

// John left the ranges to us — start simple, tune after seeing real distributions.
export function scoreWon30d(n) {
  if (n === null || n === undefined) return 0
  if (n >= 10) return 15
  if (n >= 6)  return 12
  if (n >= 3)  return 9
  if (n >= 1)  return 5
  return 0
}

export function scoreTickets7d(n) {
  if (n === null || n === undefined) return 15 // no Freshdesk company for this account → no ticket signal
  if (n <= 1) return 15
  if (n === 2) return 12
  if (n === 3) return 8
  if (n <= 5)  return 4
  return 0
}

export function classifyScore(score) {
  if (score === null || score === undefined) return 'no_data'
  if (score >= SCORE_BANDS.healthy) return 'healthy'
  if (score >= SCORE_BANDS.watch)   return 'watch'
  return 'at_risk'
}

export const daysSince = (iso) => iso
  ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
  : null

// signals: { calls7d, lastCallAt, lastSaleAt, won30d, wonPrior30d, tickets7d,
//            callsYesterdayIn, callsYesterdayOut, lastContactCreatedAt, hasGhlData }
export function computeHealth(signals = {}) {
  const s = signals
  if (!s.hasGhlData) {
    return { score: null, band: 'no_data', platform: null, sales: null, support: null, warnings: [], meaningfulActivityAt: null }
  }

  const lastCallDays = daysSince(s.lastCallAt)
  const lastSaleDays = daysSince(s.lastSaleAt)

  const platform = {
    max: CATEGORY_MAX.platform,
    calls7d:      { value: s.calls7d ?? 0, pts: scoreCalls7d(s.calls7d), max: 30 },
    lastCall:     { days: lastCallDays,     pts: scoreLastCall(lastCallDays), max: 15 },
  }
  platform.pts = platform.calls7d.pts + platform.lastCall.pts

  const sales = {
    max: CATEGORY_MAX.sales,
    lastSale: { days: lastSaleDays,      pts: scoreLastSale(lastSaleDays), max: 25 },
    won30d:   { value: s.won30d ?? 0,    pts: scoreWon30d(s.won30d),       max: 15 },
    wonPrior30d: s.wonPrior30d ?? 0,
  }
  sales.pts = sales.lastSale.pts + sales.won30d.pts
  sales.trendPct = sales.wonPrior30d > 0
    ? Math.round(((sales.won30d.value - sales.wonPrior30d) / sales.wonPrior30d) * 100)
    : null

  const support = {
    max: CATEGORY_MAX.support,
    tickets7d: { value: s.tickets7d ?? null, pts: scoreTickets7d(s.tickets7d), max: 15 },
  }
  support.pts = support.tickets7d.pts

  const score = platform.pts + sales.pts + support.pts

  const warnings = []
  if (lastSaleDays === null)                          warnings.push('No won sale recorded')
  else if (lastSaleDays > NO_SALE_WARNING_DAYS)       warnings.push(`No sale in ${lastSaleDays} days`)
  if (sales.wonPrior30d > 0 && sales.won30d.value < sales.wonPrior30d)
    warnings.push(`Sales declined from ${sales.wonPrior30d} → ${sales.won30d.value}`)
  if (lastCallDays === null)                          warnings.push('No calls recorded')
  else if (lastCallDays > 7)                          warnings.push(`No calls in ${lastCallDays} days`)
  if ((s.calls7d ?? 0) > 0 && (s.calls7d ?? 0) < 25)  warnings.push(`Only ${s.calls7d} calls in the last 7 days`)
  if ((s.tickets7d ?? 0) >= 2)                        warnings.push(`${s.tickets7d} support tickets in the last 7 days`)

  // Last meaningful activity = most recent of call, new contact created, won sale
  const candidates = [s.lastCallAt, s.lastContactCreatedAt, s.lastSaleAt].filter(Boolean)
  const meaningfulActivityAt = candidates.length
    ? candidates.reduce((a, b) => (new Date(b) > new Date(a) ? b : a))
    : null

  return { score, band: classifyScore(score), platform, sales, support, warnings, meaningfulActivityAt }
}

export function recommendedAction(health) {
  if (!health || health.band === 'no_data') return 'No GHL data for this sub-account — check its status in GHL'
  if (health.band === 'healthy') return 'Healthy — no action needed'
  const parts = []
  if (health.warnings.some(w => /sale/i.test(w)))    parts.push('review pipeline and recent sales')
  if (health.warnings.some(w => /call/i.test(w)))    parts.push('check platform usage (calls)')
  if (health.warnings.some(w => /ticket/i.test(w)))  parts.push('review recent support issues')
  const detail = parts.length ? parts.join(', ') : 'review account activity'
  return health.band === 'at_risk'
    ? `Customer Success follow-up recommended — ${detail}.`
    : `Keep an eye on this account — ${detail}.`
}
