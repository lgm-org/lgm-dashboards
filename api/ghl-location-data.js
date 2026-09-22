// Per-location GHL data via OAuth tokens stored in Vercel KV.
// Returns user count, contact total, and open opportunity count for one sub-account.
// Tokens are written by the goals-dashboard marketplace OAuth flow and shared via the
// same Upstash KV store (both projects connected to the same store in Vercel Storage).

import { kv } from './_supabase.js'

const GHL_BASE   = 'https://services.leadconnectorhq.com'
const GHL_VER    = '2021-07-28'
const COMPANY_ID = 'MKJeZKBhrN9uLt4ZWZCa'

// Hardcoded GHL marketplace app Client ID — same app as lgm-goals-dashboard.
// Secret is in GHL_CLIENT_SECRET env var (Vercel production secret).
const GOALS_APP_CLIENT_ID = '6a6dea0af575e7245fd2313c-mtkerbtj'

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
  } catch {
    return null
  }
}

async function fetchLocationTokenFromCompany(locationId) {
  try {
    let company = await kv.get(`ghl:company_token:${COMPANY_ID}`)
    if (!company?.accessToken) return null

    if (Date.now() > company.expiresAt - 30 * 60 * 1000) {
      const refreshed = await refreshToken(company)
      if (refreshed) {
        await kv.set(`ghl:company_token:${COMPANY_ID}`, refreshed)
        company = refreshed
      }
    }

    const res = await fetch(`${GHL_BASE}/oauth/locationToken`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${company.accessToken}`,
        Version:        GHL_VER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ companyId: COMPANY_ID, locationId }),
    })
    const loc = await res.json()
    if (!loc?.access_token) return null

    const data = {
      accessToken:  loc.access_token,
      refreshToken: loc.refresh_token || company.refreshToken,
      expiresAt:    Date.now() + ((loc.expires_in || 86400) * 1000),
      locationId,
      companyId:    COMPANY_ID,
      tokenType:    'Location',
    }
    await kv.set(`ghl:token:${locationId}`, data)
    return data
  } catch {
    return null
  }
}

async function getOAuthToken(locationId) {
  try {
    let data = await kv.get(`ghl:token:${locationId}`)

    if (!data) {
      data = await fetchLocationTokenFromCompany(locationId)
      if (!data) return null
      return data.accessToken
    }

    // Token is expiring within 10 min or already expired — try to refresh
    if (Date.now() > data.expiresAt - 10 * 60 * 1000) {
      const refreshed = await refreshToken(data)
      if (refreshed) {
        await kv.set(`ghl:token:${locationId}`, refreshed)
        return refreshed.accessToken
      }
      // Refresh token is dead — re-derive from company token
      const fresh = await fetchLocationTokenFromCompany(locationId)
      if (fresh) return fresh.accessToken
      // Nothing worked; if the stored token isn't too old, try it anyway
      if (data.expiresAt && Date.now() < data.expiresAt + 60 * 60 * 1000) {
        return data.accessToken
      }
      return null
    }

    return data.accessToken
  } catch {
    return null
  }
}

async function ghlFetch(path, token, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, Version: GHL_VER, 'Content-Type': 'application/json' },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${GHL_BASE}${path}`, opts)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, ok: res.ok, json, text: res.ok ? null : text.slice(0, 300) }
}

// Fetch GHL portal last-login for a location using the agency PIT key.
// This is a real-time agency-level call that doesn't need per-location OAuth.
async function fetchLocationLastLogin(locationId) {
  const agencyKey = process.env.GHL_AGENCY_API_KEY
  if (!agencyKey) return null
  try {
    const res = await fetch(`${GHL_BASE}/locations/${locationId}`, {
      headers: { Authorization: `Bearer ${agencyKey}`, Version: GHL_VER },
    })
    if (!res.ok) return null
    const data = await res.json()
    // GHL returns { location: { ... } } or the location object directly
    const loc = data?.location ?? data
    return loc?.lastLogin ?? loc?.last_login ?? null
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  const { locationId } = req.query
  if (!locationId) return res.status(400).json({ error: 'Missing locationId' })

  res.setHeader('Cache-Control', 'no-store')

  // Fetch portal last-login in parallel with OAuth token lookup — it uses the
  // agency key so it works for every account regardless of OAuth status.
  const [token, lastLogin] = await Promise.all([
    getOAuthToken(locationId),
    fetchLocationLastLogin(locationId),
  ])

  if (!token) {
    return res.json({
      locationId,
      oauthConnected: false,
      users:         null,
      contacts:      null,
      opportunities: null,
      lastLogin,      // still available even without per-location OAuth
    })
  }

  const [usersR, contactsR, convoR, oppsR, wonOppsR, createdR, callR] = await Promise.allSettled([
    ghlFetch(`/users/?locationId=${locationId}`, token),
    // Sort by date_updated desc — first result is the most recently touched contact
    ghlFetch(`/contacts/?locationId=${locationId}&sortBy=date_updated&sortOrder=desc&limit=1`, token),
    ghlFetch(`/conversations/search?locationId=${locationId}&limit=1`, token),
    // opportunities/search is a POST endpoint — GHL requires "locationId" (not "location_id")
    ghlFetch(`/opportunities/search`, token, 'POST', { locationId, limit: 1 }),
    // Last won opportunity — sort by lastStatusChangeDate desc to get most recent win
    ghlFetch(`/opportunities/search`, token, 'POST', { locationId, status: 'won', sortBy: 'lastStatusChangeDate', sortOrder: 'desc', limit: 1 }),
    // Most recently created contact
    ghlFetch(`/contacts/?locationId=${locationId}&sortBy=date_added&sortOrder=desc&limit=1`, token),
    // Most recent call conversation
    ghlFetch(`/conversations/search?locationId=${locationId}&lastMessageType=TYPE_CALL&sortBy=last_message_date&sort=desc&limit=1`, token),
  ])

  const users    = usersR.status    === 'fulfilled' ? usersR.value    : null
  const contacts = contactsR.status === 'fulfilled' ? contactsR.value : null
  const convos   = convoR.status    === 'fulfilled' ? convoR.value    : null
  const opps     = oppsR.status     === 'fulfilled' ? oppsR.value     : null
  const wonOpps  = wonOppsR.status  === 'fulfilled' ? wonOppsR.value  : null
  const created  = createdR.status  === 'fulfilled' ? createdR.value  : null
  const calls    = callR.status     === 'fulfilled' ? callR.value     : null

  // GHL returns lastMessageDate as epoch ms on conversations; normalize to ISO
  const toIso = (v) => {
    if (v === null || v === undefined || v === '') return null
    const d = new Date(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }

  // Extract counts, trying multiple known GHL response shapes
  const userCount    = users?.json?.users?.length            ?? null
  const contactCount = contacts?.json?.total ?? contacts?.json?.meta?.total ?? contacts?.json?.count ?? null
  const convoCount   = convos?.json?.total  ?? convos?.json?.meta?.total   ?? null
  const oppsCount    = opps?.json?.total    ?? opps?.json?.meta?.total     ?? opps?.json?.opportunities?.total ?? null

  // Most recently updated contact — real GHL native contact activity (more accurate than sub-account dateUpdated)
  const lastContactUpdate = contacts?.json?.contacts?.[0]?.dateUpdated || null

  // Most recent won opportunity close date
  const wonOpp    = wonOpps?.json?.opportunities?.[0] || null
  const lastSaleDate = wonOpp?.lastStatusChangeDate || wonOpp?.updatedAt || null

  const lastContactCreated = toIso(created?.json?.contacts?.[0]?.dateAdded)
  const lastCallDate       = toIso(calls?.json?.conversations?.[0]?.lastMessageDate)

  // Cache all four activity signals in ghl_account_stats (anon-readable)
  // Fire-and-forget — don't block the response on the cache write
  if (lastContactUpdate || lastContactCreated || lastCallDate || lastSaleDate) {
    import('@supabase/supabase-js').then(({ createClient }) => {
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
      sb.from('ghl_account_stats').upsert({
        location_id:          locationId,
        last_contact_update:  lastContactUpdate  || null,
        last_contact_created: lastContactCreated || null,
        last_call_date:       lastCallDate       || null,
        last_sale_date:       lastSaleDate       || null,
        synced_at:            new Date().toISOString(),
      }, { onConflict: 'location_id' }).then(({ error }) => {
        if (error) console.error('[ghl-location-data] Supabase write error:', error.message)
      })
    }).catch(() => {}) // non-fatal
  }

  res.json({
    locationId,
    oauthConnected:    true,
    users:             userCount,
    contacts:          contactCount,
    opportunities:     oppsCount,
    conversations:     convoCount,
    lastContactUpdate,  // ISO — most recently updated contact in this sub-account
    lastContactCreated, // ISO — most recently created contact
    lastCallDate,       // ISO — most recent call conversation
    lastSaleDate,       // ISO — last won opportunity close date (from GHL pipeline)
    lastLogin,         // ISO — last GHL portal login (real-time, agency key)
  })
}
