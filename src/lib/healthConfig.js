export const CHURN_TXN_THRESHOLD = 3500
export const UPSELL_MIN_USERS    = 3
// Bands on John's 100-point score (2026-09-24). Tune once the client distribution is known.
export const HEALTH_BANDS        = { healthy: 70, watch: 55 }
// Warning rule (John): flag when there has been no won sale for more than this many days
export const FLAG_NO_SALE_DAYS   = 10
export const WEIGHTS             = { transactions: 0.40, users: 0.20, revenue: 0.15, tenure: 0.15, activity: 0.10 }
export const COLORS              = { green: '#8CC63F', amber: '#EAB308', red: '#EF4444', charcoal: '#4A4A4A' }
// Upsell rule (John, 2026-10-05): 300+ calls in the past 7 days and room for an add-on.
// No add-ons → upsell · exactly one add-on → HIGH priority upsell. An unflagged account drops
// off the list for UPSELL_DISMISS_DAYS, then qualifies again.
export const UPSELL_CALLS_7D     = 300
export const UPSELL_DISMISS_DAYS = 30
export const ADD_ON_PRICES       = { leadFlow: 50, callCoachPerUser: 50 }
