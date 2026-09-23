// Batch-syncs GHL activity signals for all sub-accounts into ghl_account_stats.
// Called fire-and-forget from the health dashboard on load (and from the Sync button).
// Processes up to 20 accounts per call; paginated via ?skip=.
// Four signals per account: last contact updated, last contact created, last call, last won sale.
// ?debug=1 returns per-location GHL status codes and Supabase errors.

import { kv } from './_supabase.js'
import { createClient } from '@supabase/supabase-js'

const GHL_BASE   = 'https://services.leadconnectorhq.com'
const GHL_VER    = '2021-07-28'
const COMPANY_ID = 'MKJeZKBhrN9uLt4ZWZCa'
const GOALS_APP_CLIENT_ID = '6a6dea0af575e7245fd2313c-mtkerbtj'

const BATCH_SIZE = 20

async function refreshToken(tokenData) {
  try {
    const res = await fetch(`${GHL_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     GOALS_APP_CLIENT_ID,
        client_secret: process.env.GHL_CLIENT_SECRET,
        grant_type:    'refresh_token',
        refresh_token: tokenData.refreshToken,
      }),
    })
    const tokens = await res.json()
    if (!res.ok || !tokens.access_token) return null
    return {
      ...tokenData,
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token || tokenData.refreshToken,
      expiresAt:    Date.now() + (tokens.expires_in * 1000),
    }
  } catch { return null }
}

async function getCompanyToken() {
  let company = await kv.get(`ghl:company_token:${COMPANY_ID}`)
  if (!company?.accessToken) return null
  if (Date.now() > company.expiresAt - 30 * 60 * 1000) {
    const refreshed = await refreshToken(company)
    if (refreshed) {
      await kv.set(`ghl:company_token:${COMPANY_ID}`, refreshed)
      return refreshed.accessToken
    }
  }
  return company.accessToken
}

// Returns { token, reason } — reason is GHL's own message when no token can be issued
// (e.g. "Location is not active" for paused sub-accounts, "Location not found" for deleted ones).
async function getLocationToken(locationId, companyAccessToken) {
  try {
    const cached = await kv.get(`ghl:token:${locationId}`)
    if (cached?.accessToken && Date.now() < cached.expiresAt - 10 * 60 * 1000) {
      return { token: cached.accessToken, reason: null }
    }
    if (cached?.refreshToken) {
      const refreshed = await refreshToken(cached)
      if (refreshed) {
        await kv.set(`ghl:token:${locationId}`, refreshed)
        return { token: refreshed.accessToken, reason: null }
      }
    }
    if (!companyAccessToken) return { token: null, reason: 'No company token available' }
    const res = await fetch(`${GHL_BASE}/oauth/locationToken`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${companyAccessToken}`,
        Version:        GHL_VER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ companyId: COMPANY_ID, locationId }),
    })
    const loc = await res.json().catch(() => ({}))
    if (!loc?.access_token) {
      const msg = Array.isArray(loc?.message) ? loc.message.join('; ') : loc?.message
      return { token: null, reason: msg || `locationToken HTTP ${res.status}` }
    }
    const data = {
      accessToken:  loc.access_token,
      refreshToken: loc.refresh_token || '',
      expiresAt:    Date.now() + ((loc.expires_in || 86400) * 1000),
      locationId, companyId: COMPANY_ID,
    }
    await kv.set(`ghl:token:${locationId}`, data)
    return { token: data.accessToken, reason: null }
  } catch (err) { return { token: null, reason: err.message } }
}

// GHL returns lastMessageDate as epoch ms on conversations; normalize everything to ISO
function toIso(v) {
  if (v === null || v === undefined || v === '') return null
  const d = new Date(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

async function ghl(path, token, method = 'GET', body = null) {
  try {
    const opts = { method, headers: { Authorization: `Bearer ${token}`, Version: GHL_VER, 'Content-Type': 'application/json' } }
    if (body) opts.body = JSON.stringify(body)
    const res  = await fetch(`${GHL_BASE}${path}`, opts)
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, snippet: res.ok ? null : text.slice(0, 200) }
  } catch (err) {
    return { status: 0, json: null, snippet: err.message }
  }
}

// Try request variants in order; first 2xx with a date wins. Debug output shows which one worked.
async function tryVariants(variants) {
  const tried = []
  for (const v of variants) {
    const r = await ghl(v.path, v.token, v.method || 'GET', v.body || null)
    const date = r.status >= 200 && r.status < 300 ? toIso(v.extract(r.json)) : null
    tried.push({ variant: v.label, status: r.status, err: r.snippet, gotDate: !!date })
    if (r.status >= 200 && r.status < 300) return { date, tried }
  }
  return { date: null, tried }
}

const newestOf = (list, pick) => list.reduce((best, o) => {
  const v = pick(o); return v && (!best || new Date(v) > new Date(best)) ? v : best
}, null)

async function fetchSignals(locationId, token, agencyKey) {
  const [upd, crt, call, won] = await Promise.all([
    tryVariants([
      { label: 'contacts/search sort dateUpdated', token, method: 'POST', path: '/contacts/search',
        body: { locationId, pageLimit: 1, sort: [{ field: 'dateUpdated', direction: 'desc' }] },
        extract: j => j?.contacts?.[0]?.dateUpdated },
    ]),
    tryVariants([
      { label: 'contacts/search sort dateAdded', token, method: 'POST', path: '/contacts/search',
        body: { locationId, pageLimit: 1, sort: [{ field: 'dateAdded', direction: 'desc' }] },
        extract: j => j?.contacts?.[0]?.dateAdded },
    ]),
    tryVariants([
      { label: 'conversations/search (location token)', token,
        path: `/conversations/search?locationId=${locationId}&lastMessageType=TYPE_CALL&sortBy=last_message_date&sort=desc&limit=1`,
        extract: j => j?.conversations?.[0]?.lastMessageDate },
      { label: 'conversations/search (agency key)', token: agencyKey,
        path: `/conversations/search?locationId=${locationId}&lastMessageType=TYPE_CALL&sortBy=last_message_date&sort=desc&limit=1`,
        extract: j => j?.conversations?.[0]?.lastMessageDate },
    ]),
    tryVariants([
      { label: 'opportunities/search GET status=won', token,
        path: `/opportunities/search?location_id=${locationId}&status=won&limit=100`,
        extract: j => newestOf(j?.opportunities || [], o => o.lastStatusChangeAt || o.lastStatusChangeDate || o.updatedAt) },
      { label: 'opportunities/search POST filters', token, method: 'POST', path: '/opportunities/search',
        body: { locationId, pageLimit: 1, filters: [{ field: 'status', operator: 'eq', value: 'won' }],
                sort: [{ field: 'lastStatusChangeAt', direction: 'desc' }] },
        extract: j => j?.opportunities?.[0]?.lastStatusChangeAt || j?.opportunities?.[0]?.updatedAt },
    ]),
  ])
  return {
    dates: { contactUpdate: upd.date, contactCreated: crt.date, callDate: call.date, saleDate: won.date },
    statuses: { contactUpdate: upd.tried, contactCreated: crt.tried, callDate: call.tried, saleDate: won.tried },
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const agencyKey = process.env.GHL_AGENCY_API_KEY
  if (!agencyKey) return res.status(500).json({ error: 'GHL_AGENCY_API_KEY not configured' })

  const skip  = parseInt(req.query.skip || '0', 10)
  const debug = req.query.debug === '1'

  let allLocations = []
  try {
    let s = 0
    while (true) {
      const r = await fetch(`${GHL_BASE}/locations/search?limit=100&skip=${s}`, {
        headers: { Authorization: `Bearer ${agencyKey}`, Version: GHL_VER },
      })
      const d = await r.json()
      const batch = d.locations || []
      allLocations = allLocations.concat(batch.map(l => l.id).filter(Boolean))
      if (batch.length < 100) break
      s += 100
    }
  } catch (err) {
    return res.status(500).json({ error: `Failed to load locations: ${err.message}` })
  }

  const total     = allLocations.length
  const pageBatch = allLocations.slice(skip, skip + BATCH_SIZE)

  if (pageBatch.length === 0) {
    return res.json({ synced: 0, total, hasMore: false, skip })
  }

  const companyToken = await getCompanyToken()
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const results = await Promise.allSettled(
    pageBatch.map(async (locationId) => {
      const { token, reason } = await getLocationToken(locationId, companyToken)
      if (!token) {
        // Record GHL's reason so the dashboard can say exactly why there is no activity data.
        // Only sync_note is written — existing dates are left untouched.
        await sb.from('ghl_account_stats').upsert({
          location_id: locationId, sync_note: reason, synced_at: new Date().toISOString(),
        }, { onConflict: 'location_id' })
        return { locationId, skipped: 'no_token', reason }
      }

      const { dates, statuses } = await fetchSignals(locationId, token, agencyKey)
      const hasAny = Object.values(dates).some(Boolean)
      const allOk  = Object.values(statuses).every(tried => tried.some(t => t.status >= 200 && t.status < 300))

      let upsertError = null
      let row = null
      if (hasAny) {
        row = {
          last_contact_update:  dates.contactUpdate,
          last_contact_created: dates.contactCreated,
          last_call_date:       dates.callDate,
          last_sale_date:       dates.saleDate,
          sync_note:            null,
        }
      } else if (allOk) {
        // GHL answered every call successfully and there is simply nothing in this sub-account
        row = { sync_note: 'GHL returned no contacts, calls or won opportunities for this sub-account' }
      } else {
        // At least one GHL call failed — keep whatever dates we had, note the failure
        const failed = Object.entries(statuses)
          .filter(([, tried]) => !tried.some(t => t.status >= 200 && t.status < 300))
          .map(([k, tried]) => `${k}: HTTP ${tried[tried.length - 1]?.status}`)
        row = { sync_note: `GHL request failed — ${failed.join(', ')}` }
      }
      const { error } = await sb.from('ghl_account_stats').upsert({
        location_id: locationId, ...row, synced_at: new Date().toISOString(),
      }, { onConflict: 'location_id' })
      if (error) {
        upsertError = error.message
        console.error('[ghl-sync-activity-batch] upsert failed', locationId, error.message)
      }

      return { locationId, written: hasAny && !upsertError, dates, statuses, upsertError, note: row.sync_note }
    })
  )

  const rows     = results.map(r => (r.status === 'fulfilled' ? r.value : { error: r.reason?.message }))
  const written  = rows.filter(r => r.written).length
  const noToken  = rows.filter(r => r.skipped === 'no_token').length
  const noData   = rows.filter(r => r.dates && !Object.values(r.dates).some(Boolean)).length
  const dbErrors = rows.filter(r => r.upsertError).length
  const hasMore  = skip + BATCH_SIZE < total

  res.json({
    synced: written, noToken, noData, dbErrors,
    total, hasMore, skip, nextSkip: skip + BATCH_SIZE,
    ...(debug ? { details: rows } : {}),
  })
}
