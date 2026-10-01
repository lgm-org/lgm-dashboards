// Vercel serverless function — cross-account audit for the Master Dashboard's
// custom-field dependencies. John asked (2026-09-11): when a metric shows
// "Field not found in GHL" for some client, is that account genuinely missing
// the custom field, or does it just have it under a different name? And
// across ALL client accounts, which ones are missing which fields, so LGM can
// go add them?
//
// This answers both: for every real client sub-account (same filter as
// api/ghl-accounts.js), it runs the exact same custom-field name-matching
// logic the live dashboard uses (getCustomFieldMap in _masterLeadsCore.js —
// imported, not copied, so this can never drift from what the dashboard
// actually does) and reports which FIELD_TARGETS keys didn't match.
//
// GET /api/field-audit  →  { accounts: [{ locationId, name, status, missingFields, allFieldNames }], summary }
// status is one of:
//   'ok'          — every target field matched
//   'missing'     — app installed, some fields didn't match (see missingFields)
//   'no_access'   — our Marketplace app isn't installed on this location at all,
//                   so field-matching couldn't even be attempted (a bigger
//                   problem than a missing field — the whole dashboard won't
//                   load for this account until the app is installed there)
//   'error'       — the customFields call itself failed for some other reason

import { getLocationAccessToken } from './_ghlAuth.js'
import { getCustomFieldMap, FIELD_TARGETS } from './_masterLeadsCore.js'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VER  = '2021-07-28'

import { isExcludedLocation } from '../src/lib/excludedLocations.js'

async function fetchRealLocations() {
  const key = process.env.GHL_AGENCY_API_KEY
  if (!key) throw new Error('GHL_AGENCY_API_KEY env var not configured')

  let all = [], skip = 0
  while (true) {
    const res = await fetch(`${GHL_BASE}/locations/search?limit=100&skip=${skip}`, {
      headers: { Authorization: `Bearer ${key}`, Version: GHL_VER },
    })
    if (!res.ok) throw new Error(`GHL /locations/search → HTTP ${res.status}`)
    const data = await res.json()
    const batch = data.locations || []
    all = all.concat(batch)
    if (batch.length < 100) break
    skip += 100
  }

  return all.filter(loc => !isExcludedLocation({ id: loc.id, name: loc.name }))
}

async function auditOne(loc) {
  const base = { locationId: loc.id, name: loc.name || '' }
  try {
    const { token, reason } = await getLocationAccessToken(loc.id)
    if (!token) {
      return { ...base, status: 'no_access', reason }
    }
    const { map, allFields } = await getCustomFieldMap(token, loc.id)
    const missingFields = Object.entries(map).filter(([, v]) => v === null).map(([k]) => k)
    return {
      ...base,
      status: missingFields.length > 0 ? 'missing' : 'ok',
      missingFields,
      matchedFields: Object.fromEntries(Object.entries(map).filter(([, v]) => v).map(([k, v]) => [k, v.name])),
      allFieldNames: allFields.map(f => f.name),
    }
  } catch (err) {
    return { ...base, status: 'error', reason: err.message }
  }
}

// Bounded concurrency — one location's audit is 2-3 GHL calls; running all of
// them in parallel on an account list of any real size would trip GHL's rate
// limit the same way the full leads pull does.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const locations = await fetchRealLocations()
    const accounts = await mapWithConcurrency(locations, 6, auditOne)

    const fieldNames = Object.keys(FIELD_TARGETS)
    const missingByField = {}
    for (const key of fieldNames) missingByField[key] = []
    for (const a of accounts) {
      if (a.status === 'missing') {
        for (const key of a.missingFields) missingByField[key].push({ locationId: a.locationId, name: a.name })
      }
    }

    res.json({
      accounts,
      summary: {
        total: accounts.length,
        ok: accounts.filter(a => a.status === 'ok').length,
        missing: accounts.filter(a => a.status === 'missing').length,
        noAccess: accounts.filter(a => a.status === 'no_access').length,
        error: accounts.filter(a => a.status === 'error').length,
        missingByField,
      },
      auditedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('field-audit error:', err.message)
    res.status(500).json({ error: err.message })
  }
}
