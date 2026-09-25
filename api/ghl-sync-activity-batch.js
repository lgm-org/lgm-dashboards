// Batch-syncs the customer-health signals for all sub-accounts into ghl_account_stats and
// writes a daily score snapshot to health_score_daily.
// Called fire-and-forget from the health dashboard on load (and from the Sync button).
// Processes up to 20 accounts per call; paginated via ?skip=.
// ?debug=1 returns per-location signals, GHL statuses and (first location) raw samples.
//
// Signals per account (John's model, 2026-09-24):
//   calls7d, lastCallAt, callsYesterdayIn/Out  ← call_log table when it has data, else GHL
//                                                conversations whose last message is a call
//   lastSaleAt, won30d, wonPrior30d            ← GHL won opportunities
//   tickets7d                                  ← Freshdesk (company name = GHL location id)
//   lastContactCreatedAt                       ← GHL contacts (display only, not scored)

import { kv } from './_supabase.js'
import { createClient } from '@supabase/supabase-js'
import { computeHealth } from '../src/lib/healthScoreModel.js'

const GHL_BASE   = 'https://services.leadconnectorhq.com'
const GHL_VER    = '2021-07-28'
const COMPANY_ID = 'MKJeZKBhrN9uLt4ZWZCa'
const GOALS_APP_CLIENT_ID = '6a6dea0af575e7245fd2313c-mtkerbtj'

const BATCH_SIZE = 20
const DAY_MS     = 86_400_000

// ── OAuth ─────────────────────────────────────────────────────────────────────

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
      headers: { Authorization: `Bearer ${companyAccessToken}`, Version: GHL_VER, 'Content-Type': 'application/json' },
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

// ── helpers ───────────────────────────────────────────────────────────────────

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
    const res  = await fetch(path.startsWith('http') ? path : `${GHL_BASE}${path}`, opts)
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, ok: res.ok, json, snippet: res.ok ? null : text.slice(0, 200) }
  } catch (err) {
    return { status: 0, ok: false, json: null, snippet: err.message }
  }
}

// YYYY-MM-DD for a timestamp in the sub-account's timezone
function localDay(ts, tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts))
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts))
  }
}

// ── Freshdesk: tickets created in the last 7 days, grouped by company name (= GHL location id) ──

let fdCache = { at: 0, map: null }

async function freshdeskTickets7d() {
  if (fdCache.map && Date.now() - fdCache.at < 10 * 60 * 1000) return fdCache.map
  const domain = process.env.FRESHDESK_DOMAIN, key = process.env.FRESHDESK_API_KEY
  if (!domain || !key) return null
  const base = `https://${domain}.freshdesk.com/api/v2`
  const auth = 'Basic ' + Buffer.from(`${key}:X`).toString('base64')
  const fd = async (path) => {
    const r = await fetch(`${base}${path}`, { headers: { Authorization: auth } })
    return r.ok ? r.json() : []
  }
  try {
    const [c1, c2] = await Promise.all([fd('/companies?per_page=100&page=1'), fd('/companies?per_page=100&page=2')])
    const companyName = {}
    for (const c of [...(Array.isArray(c1) ? c1 : []), ...(Array.isArray(c2) ? c2 : [])]) if (c.id) companyName[c.id] = c.name
    const since = new Date(Date.now() - 7 * DAY_MS).toISOString()
    const counts = {}
    for (let page = 1; page <= 5; page++) {
      const batch = await fd(`/tickets?updated_since=${encodeURIComponent(since)}&per_page=100&page=${page}&order_by=created_at&order_type=desc`)
      if (!Array.isArray(batch) || batch.length === 0) break
      for (const t of batch) {
        if (t.created_at >= since && t.company_id && companyName[t.company_id]) {
          const loc = companyName[t.company_id]
          counts[loc] = (counts[loc] || 0) + 1
        }
      }
      if (batch.length < 100) break
    }
    // Every account with a Freshdesk company gets an explicit 0 so "no company" stays null
    const map = {}
    for (const name of Object.values(companyName)) if (name) map[name] = counts[name] || 0
    fdCache = { at: Date.now(), map }
    return map
  } catch { return fdCache.map }
}

// ── Per-location signal fetches ───────────────────────────────────────────────

// Preferred call source: call_log (n8n call-started webhook). Returns null when it has no rows.
async function callsFromCallLog(sb, locationId, tz) {
  const since = new Date(Date.now() - 8 * DAY_MS).toISOString()
  const { data, error } = await sb.from('call_log').select('direction, started_at')
    .eq('location_id', locationId).gte('started_at', since).order('started_at', { ascending: false }).limit(2000)
  if (error || !data?.length) return null
  return summarizeCalls(data.map(r => ({ at: r.started_at, direction: r.direction })), tz, 'call_log')
}

// Fallback: GHL conversations whose LAST message is a call. Undercounts multi-call threads;
// consistent across accounts, so fine for relative scoring until call_log has history.
// Pages until the results are older than 7 days (hard ceiling MAX_CALL_PAGES × 100 threads).
// Deduped by conversation id so a cursor GHL ignores can never double-count.
const MAX_CALL_PAGES = 20

async function callsFromGhl(locationId, token, tz) {
  const seen  = new Map()
  const statuses = []
  let startAfter = null
  let pages = 0
  let sample
  for (let page = 0; page < MAX_CALL_PAGES; page++) {
    const qs = `locationId=${locationId}&lastMessageType=TYPE_CALL&sortBy=last_message_date&sort=desc&limit=100` +
               (startAfter ? `&startAfterDate=${startAfter}` : '')
    const r = await ghl(`/conversations/search?${qs}`, token)
    statuses.push({ status: r.status, err: r.snippet })
    if (!r.ok) break
    pages++
    const rows = r.json?.conversations || []
    let added = 0
    for (const c of rows) {
      if (!sample) sample = c
      if (seen.has(c.id)) continue
      // lastCallTimestamp is the actual call time; lastMessageDate can be a later SMS/email in the same thread
      seen.set(c.id, { at: toIso(c.lastCallTimestamp || c.lastMessageDate), direction: c.lastMessageDirection || null })
      added++
    }
    if (rows.length < 100 || added === 0) break
    const oldest = rows[rows.length - 1]?.lastMessageDate
    if (!oldest || Date.now() - new Date(toIso(oldest)).getTime() > 7 * DAY_MS) break
    startAfter = oldest
  }
  const capped = pages >= MAX_CALL_PAGES
  return { ...summarizeCalls([...seen.values()], tz, 'ghl_conversations'), statuses, sample, pages, capped }
}

function summarizeCalls(calls, tz, source) {
  const now = Date.now()
  const yest = localDay(now - DAY_MS, tz)
  let calls7d = 0, yIn = 0, yOut = 0, lastCallAt = null
  for (const c of calls) {
    if (!c.at) continue
    const t = new Date(c.at).getTime()
    if (!lastCallAt || t > new Date(lastCallAt).getTime()) lastCallAt = c.at
    if (now - t <= 7 * DAY_MS) calls7d++
    if (localDay(t, tz) === yest) {
      if (/out/i.test(c.direction || '')) yOut++
      else if (/in/i.test(c.direction || '')) yIn++
    }
  }
  return { calls7d, callsYesterdayIn: yIn, callsYesterdayOut: yOut, lastCallAt, callsSource: source }
}

async function wonSales(locationId, token) {
  const opps = []
  const statuses = []
  let url = `/opportunities/search?location_id=${locationId}&status=won&limit=100`
  for (let page = 0; page < 5 && url; page++) {
    const r = await ghl(url, token)
    statuses.push({ status: r.status, err: r.snippet })
    if (!r.ok) break
    opps.push(...(r.json?.opportunities || []))
    url = r.json?.meta?.nextPageUrl || null
  }
  const now = Date.now()
  let lastSaleAt = null, won30d = 0, wonPrior30d = 0
  for (const o of opps) {
    const at = toIso(o.lastStatusChangeAt || o.lastStatusChangeDate || o.updatedAt)
    if (!at) continue
    const age = now - new Date(at).getTime()
    if (!lastSaleAt || new Date(at) > new Date(lastSaleAt)) lastSaleAt = at
    if (age <= 30 * DAY_MS) won30d++
    else if (age <= 60 * DAY_MS) wonPrior30d++
  }
  return { lastSaleAt, won30d, wonPrior30d, statuses, sample: opps[0] }
}

async function lastContactCreated(locationId, token) {
  const r = await ghl('/contacts/search', token, 'POST', { locationId, pageLimit: 1, sort: [{ field: 'dateAdded', direction: 'desc' }] })
  return { at: r.ok ? toIso(r.json?.contacts?.[0]?.dateAdded) : null, statuses: [{ status: r.status, err: r.snippet }] }
}

// ── Handler ───────────────────────────────────────────────────────────────────

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
      allLocations = allLocations.concat(batch.filter(l => l.id).map(l => ({ id: l.id, tz: l.timezone || null })))
      if (batch.length < 100) break
      s += 100
    }
  } catch (err) {
    return res.status(500).json({ error: `Failed to load locations: ${err.message}` })
  }

  const total     = allLocations.length
  // ?locationId=X re-syncs a single sub-account (QA / on-demand refresh)
  const only      = req.query.locationId
  const pageBatch = only
    ? allLocations.filter(l => l.id === only)
    : allLocations.slice(skip, skip + BATCH_SIZE)
  if (pageBatch.length === 0) return res.json({ synced: 0, total, hasMore: false, skip })

  const [companyToken, ticketsMap] = await Promise.all([getCompanyToken(), freshdeskTickets7d()])
  const sb  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const day = new Date().toISOString().slice(0, 10)

  const results = await Promise.allSettled(
    pageBatch.map(async ({ id: locationId, tz }, idx) => {
      const { token, reason } = await getLocationToken(locationId, companyToken)
      if (!token) {
        await sb.from('ghl_account_stats').upsert({
          location_id: locationId, sync_note: reason, health_score: null, health_parts: null, synced_at: new Date().toISOString(),
        }, { onConflict: 'location_id' })
        return { locationId, skipped: 'no_token', reason }
      }

      const [logCalls, ghlCalls, sales, created] = await Promise.all([
        callsFromCallLog(sb, locationId, tz),
        callsFromGhl(locationId, token, tz),
        wonSales(locationId, token),
        lastContactCreated(locationId, token),
      ])
      const calls = logCalls || ghlCalls
      const statuses = { calls: ghlCalls.statuses, sales: sales.statuses, contactCreated: created.statuses }
      const allOk = Object.values(statuses).every(list => list.length && list[0].status >= 200 && list[0].status < 300)

      const signals = {
        hasGhlData:           allOk,
        calls7d:              calls.calls7d,
        callsYesterdayIn:     calls.callsYesterdayIn,
        callsYesterdayOut:    calls.callsYesterdayOut,
        lastCallAt:           calls.lastCallAt,
        callsSource:          calls.callsSource,
        lastSaleAt:           sales.lastSaleAt,
        won30d:               sales.won30d,
        wonPrior30d:          sales.wonPrior30d,
        tickets7d:            ticketsMap ? (ticketsMap[locationId] ?? null) : null,
        lastContactCreatedAt: created.at,
      }
      const health = computeHealth(signals)

      let row
      if (allOk) {
        row = {
          calls_7d:               signals.calls7d,
          calls_yesterday_in:     signals.callsYesterdayIn,
          calls_yesterday_out:    signals.callsYesterdayOut,
          calls_source:           signals.callsSource,
          last_call_date:         signals.lastCallAt,
          last_sale_date:         signals.lastSaleAt,
          won_30d:                signals.won30d,
          won_prior_30d:          signals.wonPrior30d,
          tickets_7d:             signals.tickets7d,
          last_contact_created:   signals.lastContactCreatedAt,
          meaningful_activity_at: health.meaningfulActivityAt,
          health_score:           health.score,
          health_parts:           { platform: health.platform, sales: health.sales, support: health.support, warnings: health.warnings },
          sync_note:              null,
        }
      } else {
        const failed = Object.entries(statuses)
          .filter(([, list]) => !(list[0]?.status >= 200 && list[0]?.status < 300))
          .map(([k, list]) => `${k}: HTTP ${list[0]?.status}`)
        row = { sync_note: `GHL request failed — ${failed.join(', ')}` }
      }

      let upsertError = null
      const { error } = await sb.from('ghl_account_stats').upsert(
        { location_id: locationId, ...row, synced_at: new Date().toISOString() }, { onConflict: 'location_id' })
      if (error) { upsertError = error.message; console.error('[ghl-sync-activity-batch] upsert failed', locationId, error.message) }

      if (allOk && !upsertError) {
        const { error: snapErr } = await sb.from('health_score_daily').upsert({
          location_id: locationId, day, score: health.score,
          parts: row.health_parts, signals, computed_at: new Date().toISOString(),
        }, { onConflict: 'location_id,day' })
        if (snapErr) console.error('[ghl-sync-activity-batch] snapshot failed', locationId, snapErr.message)
      }

      const out = { locationId, written: allOk && !upsertError, score: health.score, band: health.band, signals, statuses, upsertError, note: row.sync_note, callPages: ghlCalls.pages, callPagesCapped: ghlCalls.capped }
      if (debug && idx === 0) out.samples = { conversation: ghlCalls.sample, opportunity: sales.sample }
      return out
    })
  )

  const rows     = results.map(r => (r.status === 'fulfilled' ? r.value : { error: r.reason?.message }))
  const written  = rows.filter(r => r.written).length
  const noToken  = rows.filter(r => r.skipped === 'no_token').length
  const failed   = rows.filter(r => r.note || r.error).length
  const dbErrors = rows.filter(r => r.upsertError).length
  const hasMore  = !only && skip + BATCH_SIZE < total

  res.json({
    synced: written, noToken, failed, dbErrors, freshdesk: ticketsMap ? Object.keys(ticketsMap).length : 0,
    total, hasMore, skip, nextSkip: skip + BATCH_SIZE,
    ...(debug ? { details: rows } : {}),
  })
}
