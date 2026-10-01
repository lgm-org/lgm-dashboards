// Single source of truth for GHL sub-accounts that are NOT Little Giant clients and must be
// excluded from every report: internal/test/sandbox accounts and accounts given away to friends.
// Shared by the API routes (api/ghl-accounts.js, api/field-audit.js, api/stripe-unmatched.js,
// api/ghl-sync-activity-batch.js) and the dashboard (src/hooks/useMergedHealthData.js).
// Prefer the ID list — names get edited in GHL, IDs don't.

export const EXCLUDED_LOCATION_IDS = new Set([
  '3A7RQhEGhtFa322efc19', // The Barber Shoppe & Company — John's friend's account, not a client (2026-10-01)
])

export const SANDBOX_PATTERNS = /sandbox|test account|test 2|in progress|bilingual snapshot/i

export const EXCLUDED_NAMES = new Set([
  'little giant dev',
  'recruitment account - dm',
  "clifford berman's account",
  'kitajima insurance',
  'lgm add-ons',
  'data forest',
  'lgm nps survey',
  "joe perniciaro's account",
  'hlpt saas snapshot',
  'tippy taps',
  'farmers sandbox',
  '(new) sandbox',
  'mallard',
  'lgm add-on',
  'lgm add on',
  'lgm addon',
  'lgm training',
  'lgm training account',
  'lgm test',
  'lgm test account',
  'lgm demo',
  'lgm demo account',
  'little giant marketing',
  'little giant marketing agency',
  'data forest lgm add-on',
  'data forest lgm add on',
  'the barber shoppe & company',
])

export function isExcludedLocation({ id, name } = {}) {
  if (id && EXCLUDED_LOCATION_IDS.has(id)) return true
  const n = (name || '').trim()
  if (!n) return false
  return SANDBOX_PATTERNS.test(n) || EXCLUDED_NAMES.has(n.toLowerCase())
}
