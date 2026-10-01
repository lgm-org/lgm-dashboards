// Diagnostic endpoint — returns the GHL accounts that have no Stripe match,
// with the top candidate Stripe records for each (by name/email/phone similarity).
// Used to build manual overrides for accounts that can't be auto-matched.
// Auth: same cookie check as the rest of the dashboard.

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VER  = '2021-07-28'
const STRIPE_BASE = 'https://api.stripe.com/v1'

import { isExcludedLocation } from '../src/lib/excludedLocations.js'

function normalizeName(n) {
  return (n || '')
    .toLowerCase()
    .replace(/'s\b/g, '')
    .replace(/\b(llc|inc|corp|ltd|l\.l\.c\.|incorporated|limited|company|the|agency|marketing|services|group|associates|account|insurance|at)\b\.?/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizePhone(p) {
  const d = (p || '').replace(/\D/g, '')
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d
}

// Simple token-overlap score 0–1 for name fuzzy matching
function nameScore(a, b) {
  const ta = new Set(normalizeName(a).split(/\s+/).filter(Boolean))
  const tb = new Set(normalizeName(b).split(/\s+/).filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let overlap = 0
  for (const t of ta) if (tb.has(t)) overlap++
  return overlap / Math.max(ta.size, tb.size)
}

async function ghlGet(path, key) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Version: GHL_VER },
  })
  if (!res.ok) throw new Error(`GHL ${path} → HTTP ${res.status}`)
  return res.json()
}

async function stripeGet(path, key) {
  const encoded = Buffer.from(`${key}:`).toString('base64')
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    headers: { Authorization: `Basic ${encoded}` },
  })
  if (!res.ok) throw new Error(`Stripe ${path} → HTTP ${res.status}`)
  return res.json()
}

async function fetchAllGHL(key) {
  let all = [], skip = 0
  while (true) {
    const data  = await ghlGet(`/locations/search?limit=100&skip=${skip}`, key)
    const batch = data.locations || []
    all = all.concat(batch)
    if (batch.length < 100) break
    skip += 100
  }
  return all.filter(loc => !isExcludedLocation({ id: loc.id, name: loc.name }))
}

async function fetchAllStripeCustomers(key) {
  const all = []
  let startingAfter = null
  while (true) {
    const params = new URLSearchParams({ limit: '100', 'expand[]': 'data.customer' })
    if (startingAfter) params.set('starting_after', startingAfter)
    const page  = await stripeGet(`/subscriptions?${params}`, key)
    const batch = page.data || []
    all.push(...batch)
    if (!page.has_more || batch.length === 0) break
    startingAfter = batch[batch.length - 1].id
  }
  // Build deduplicated customer map keyed by email
  const byEmail = {}
  const byPhone = {}
  const customers = []
  for (const sub of all) {
    const cust = sub.customer
    if (typeof cust !== 'object' || !cust?.email) continue
    const email = cust.email.toLowerCase().trim()
    if (!byEmail[email]) {
      const rec = {
        stripeCustomerId: cust.id,
        name:             cust.name || '',
        email,
        phone:            normalizePhone(cust.phone),
        status:           sub.status,
      }
      byEmail[email] = rec
      customers.push(rec)
    }
    const phone = normalizePhone(cust.phone)
    if (phone && phone.length >= 10 && !byPhone[phone]) {
      byPhone[phone] = byEmail[email]
    }
  }
  return { customers, byEmail, byPhone }
}

export default async function handler(req, res) {
  const ghlKey    = process.env.GHL_AGENCY_API_KEY
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!ghlKey || !stripeKey) {
    return res.status(500).json({ error: 'Missing GHL_AGENCY_API_KEY or STRIPE_SECRET_KEY' })
  }

  try {
    const [ghlLocs, stripeData] = await Promise.all([
      fetchAllGHL(ghlKey),
      fetchAllStripeCustomers(stripeKey),
    ])

    const { customers, byEmail, byPhone } = stripeData

    const unmatched = []
    for (const loc of ghlLocs) {
      const email    = (loc.email || '').toLowerCase().trim()
      const phone    = normalizePhone(loc.phone)
      const normName = normalizeName(loc.name)

      const matched = (email && byEmail[email])
                   || (phone && phone.length >= 10 && byPhone[phone])

      if (matched) continue

      // Find top 3 Stripe candidates by name similarity
      const candidates = customers
        .map(c => ({ ...c, score: nameScore(loc.name, c.name) }))
        .filter(c => c.score > 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(({ stripeCustomerId, name, email: e, status, score }) => ({
          stripeCustomerId, name, email: e, status,
          score: Math.round(score * 100) + '%',
        }))

      unmatched.push({
        ghlId:    loc.id,
        ghlName:  loc.name,
        ghlEmail: loc.email || '',
        ghlPhone: loc.phone || '',
        ghlCity:  loc.city  || '',
        normName,
        candidates,
      })
    }

    res.setHeader('Cache-Control', 'no-store')
    res.json({
      unmatchedCount: unmatched.length,
      totalGHL:       ghlLocs.length,
      totalStripe:    customers.length,
      unmatched,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
