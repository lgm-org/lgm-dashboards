// Batch-syncs GHL contact activity for all sub-accounts into ghl_account_stats.
// Called fire-and-forget from the health dashboard on load (and from the Sync button).
// Processes up to 20 accounts per call; paginated via ?skip= for large batches.
// Each synced row gives the dashboard accurate "last contact activity" data without needing
// individual modal opens.

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

async function getLocationToken(locationId, companyAccessToken) {
  try {
    // Try cached token first
    const cached = await kv.get(`ghl:token:${locationId}`)
    if (cached?.accessToken && Date.now() < cached.expiresAt - 10 * 60 * 1000) {
      return cached.accessToken
    }
    // Try refreshing cached token
    if (cached?.refreshToken) {
      const refreshed = await refreshToken(cached)
      if (refreshed) {
        await kv.set(`ghl:token:${locationId}`, refreshed)
        return refreshed.accessToken
      }
    }
    // Fall back to company-token-derived location token
    if (!companyAccessToken) return null
    const res = await fetch(`${GHL_BASE}/oauth/locationToken`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${companyAccessToken}`,
        Version:        GHL_VER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ companyId: COMPANY_ID, locationId }),
    })
    const loc = await res.json()
    if (!loc?.access_token) return null
    const data = {
      accessToken:  loc.access_token,
      refreshToken: loc.refresh_token || '',
      expiresAt:    Date.now() + ((loc.expires_in || 86400) * 1000),
      locationId, companyId: COMPANY_ID,
    }
    await kv.set(`ghl:token:${locationId}`, data)
    return data.accessToken
  } catch { return null }
}

async function fetchContactActivity(locationId, token) {
  try {
    const res = await fetch(
      `${GHL_BASE}/contacts/?locationId=${locationId}&sortBy=date_updated&sortOrder=desc&limit=1`,
      { headers: { Authorization: `Bearer ${token}`, Version: GHL_VER } }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data?.contacts?.[0]?.dateUpdated || null
  } catch { return null }
}

// GHL returns lastMessageDate as epoch ms on conversations; normalize everything to ISO
function toIso(v) {
  if (v === null || v === undefined || v === '') return null
  const d = new Date(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

async function fetchContactCreated(locationId, token) {
  try {
    const res = await fetch(
      `${GHL_BASE}/contacts/?locationId=${locationId}&sortBy=date_added&sortOrder=desc&limit=1`,
      { headers: { Authorization: `Bearer ${token}`, Version: GHL_VER } }
    )
    if (!res.ok) return null
    const data = await res.json()
    return toIso(data?.contacts?.[0]?.dateAdded)
  } catch { return null }
}

async function fetchLastCallDate(locationId, token) {
  try {
    const res = await fetch(
      `${GHL_BASE}/conversations/search?locationId=${locationId}&lastMessageType=TYPE_CALL&sortBy=last_message_date&sort=desc&limit=1`,
      { headers: { Authorization: `Bearer ${token}`, Version: GHL_VER } }
    )
    if (!res.ok) return null
    const data = await res.json()
    return toIso(data?.conversations?.[0]?.lastMessageDate)
  } catch { return null }
}

async function fetchLastSaleDate(locationId, token) {
  try {
    const res = await fetch(`${GHL_BASE}/opportunities/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Version: GHL_VER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId, status: 'won', sortBy: 'lastStatusChangeDate', sortOrder: 'desc', limit: 1 }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const opp = data?.opportunities?.[0]
    return opp?.lastStatusChangeDate || opp?.updatedAt || null
  } catch { return null }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  // Fetch all GHL location IDs via agency key
  const agencyKey = process.env.GHL_AGENCY_API_KEY
  if (!agencyKey) return res.status(500).json({ error: 'GHL_AGENCY_API_KEY not configured' })

  const skip = parseInt(req.query.skip || '0', 10)

  // Load all locations
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

  const total    = allLocations.length
  const pageBatch = allLocations.slice(skip, skip + BATCH_SIZE)

  if (pageBatch.length === 0) {
    return res.json({ synced: 0, total, hasMore: false, skip })
  }

  // Get company token once, shared across all location token lookups
  const companyToken = await getCompanyToken()

  // Process the batch in parallel
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const results = await Promise.allSettled(
    pageBatch.map(async (locationId) => {
      const token = await getLocationToken(locationId, companyToken)
      if (!token) return { locationId, skipped: true }

      const results = await Promise.allSettled([
        fetchContactActivity(locationId, token),
        fetchContactCreated(locationId, token),
        fetchLastCallDate(locationId, token),
        fetchLastSaleDate(locationId, token),
      ])
      const [contactUpdate, contactCreated, callDate, saleDate] =
        results.map(r => (r.status === 'fulfilled' ? r.value : null))

      if (contactUpdate || contactCreated || callDate || saleDate) {
        await sb.from('ghl_account_stats').upsert({
          location_id:          locationId,
          last_contact_update:  contactUpdate  || null,
          last_contact_created: contactCreated || null,
          last_call_date:       callDate       || null,
          last_sale_date:       saleDate       || null,
          synced_at:            new Date().toISOString(),
        }, { onConflict: 'location_id' })
      }

      return { locationId, contactUpdate, contactCreated, callDate, saleDate }
    })
  )

  const synced  = results.filter(r => r.status === 'fulfilled' && !r.value.skipped).length
  const hasMore = skip + BATCH_SIZE < total

  res.json({ synced, total, hasMore, skip, nextSkip: skip + BATCH_SIZE })
}
