// Vercel Cron target — proactively refreshes the shared GHL company token
// well before its 24h expiry, instead of waiting for it to fully lapse and
// then trying to refresh a token that's been dead for a day+. GHL's
// refresh_token grant appears to only work within a short window after
// expiry, not indefinitely — every real-world failure we've hit was a
// refresh attempted long after the access token had already expired, never
// one attempted while still fresh. Refreshing on a schedule sidesteps that
// entirely rather than depending on someone actually using the dashboard
// often enough to trigger a timely reactive refresh.
import { createClient } from '@supabase/supabase-js'
import { kv } from './_supabase.js'
import { setTokenStatus, credentialDrift } from './_ghlAuth.js'

const GHL_BASE   = 'https://services.leadconnectorhq.com'
const COMPANY_ID = 'MKJeZKBhrN9uLt4ZWZCa'

// This cron runs on every dashboard project (same schedule, same shared token table).
// Two guards keep them from refreshing the same token twice within seconds of each other —
// GHL rotates the refresh token on use, so a double refresh would leave one project holding
// a dead refresh token:
//   1. Skip when the token still has more than FRESH_MS left (someone already refreshed it).
//   2. A 2-minute compare-and-set lock row for the window where both read a stale token.
const FRESH_MS   = 20 * 60 * 60 * 1000
const LOCK_KEY   = 'ghl:refresh_lock'
const LOCK_TTL   = 2 * 60 * 1000

const sleep = ms => new Promise(r => setTimeout(r, ms))

const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

async function acquireLock() {
  const db    = sb()
  const now   = new Date()
  const until = new Date(now.getTime() + LOCK_TTL).toISOString()
  const { data: row } = await db.from('ghl_tokens').select('value, updated_at').eq('key', LOCK_KEY).maybeSingle()
  if (!row) {
    const { error } = await db.from('ghl_tokens').insert({ key: LOCK_KEY, value: { until }, updated_at: now.toISOString() })
    return !error // unique-key violation → another project inserted first
  }
  if (row.value?.until && row.value.until > now.toISOString()) return false
  const { data } = await db.from('ghl_tokens')
    .update({ value: { until }, updated_at: now.toISOString() })
    .eq('key', LOCK_KEY).eq('updated_at', row.updated_at)
    .select('key')
  return !!data?.length
}

async function releaseLock() {
  try {
    await sb().from('ghl_tokens')
      .update({ value: { until: new Date(0).toISOString() }, updated_at: new Date().toISOString() })
      .eq('key', LOCK_KEY)
  } catch {}
}

// A credentials rejection is permanent config drift, not a transient error —
// retrying it just burns time and muddies the logs.
function isCredentialError(tokens) {
  const blob = JSON.stringify(tokens || {}).toLowerCase()
  return blob.includes('invalid client credentials') || blob.includes('invalid_client')
}

async function attemptRefresh(refreshToken) {
  const tokenRes = await fetch(`${GHL_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  const tokens = await tokenRes.json().catch(() => ({}))
  return { ok: tokenRes.ok && !!tokens.access_token, tokens }
}

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'] || ''
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const company = await kv.get(`ghl:company_token:${COMPANY_ID}`)
    if (!company?.refreshToken) {
      await setTokenStatus(false, 'No company token found to refresh')
      return res.status(404).json({ error: 'No company token found to refresh' })
    }

    // One retry after a short pause before giving up — covers a transient
    // network/5xx blip on GHL's side rather than treating it the same as a
    // genuinely dead refresh token (e.g. invalidated by a GHL Marketplace
    // app version change, which no retry will fix).
    // Catch the mismatch before spending a network call on a refresh that
    // cannot possibly succeed, and report the cause rather than GHL's opaque
    // "Invalid client credentials".
    const drift = credentialDrift(company)
    if (drift) {
      console.error('[cron-refresh-token] credential drift:', drift)
      await setTokenStatus(false, drift)
      return res.status(409).json({ error: 'Credential mismatch', diagnosis: drift })
    }

    const remainingMs = (company.expiresAt || 0) - Date.now()
    if (remainingMs > FRESH_MS) {
      const hours = Math.round(remainingMs / 3_600_000)
      console.log(`[cron-refresh-token] token still fresh (${hours}h left) — skipped`)
      return res.status(200).json({ ok: true, skipped: 'fresh', hoursLeft: hours })
    }

    if (!(await acquireLock())) {
      console.log('[cron-refresh-token] another dashboard is refreshing right now — skipped')
      return res.status(200).json({ ok: true, skipped: 'locked' })
    }

    let ok, tokens
    try {
      // Re-read under the lock: the other project may have refreshed while we waited.
      const latest = await kv.get(`ghl:company_token:${COMPANY_ID}`)
      if (latest?.expiresAt && latest.expiresAt - Date.now() > FRESH_MS) {
        return res.status(200).json({ ok: true, skipped: 'fresh' })
      }
      ;({ ok, tokens } = await attemptRefresh(latest?.refreshToken || company.refreshToken))
      if (!ok && !isCredentialError(tokens)) {
        await sleep(3000)
        ;({ ok, tokens } = await attemptRefresh(latest?.refreshToken || company.refreshToken))
      }
    } finally {
      await releaseLock()
    }

    if (!ok) {
      // "Invalid client credentials" means this deployment's GHL_CLIENT_ID /
      // GHL_CLIENT_SECRET don't belong to the Marketplace app that issued the
      // token — NOT that the token itself went bad. It's a config mismatch
      // that no amount of retrying or rescheduling can fix, and it silently
      // guarantees every token dies at its 24h mark with no way to renew.
      // Worth calling out by name: this exact failure was misread as "GHL
      // tokens keep expiring" for weeks. Tokens are shared in one Supabase
      // table across Vercel projects, but each project refreshes using its
      // OWN env vars — so every project that refreshes must carry the same
      // client credentials as the one that runs the OAuth connect flow.
      const diagnosis = isCredentialError(tokens)
        ? 'GHL rejected this deployment\'s client credentials. GHL_CLIENT_ID/GHL_CLIENT_SECRET on this Vercel project do not match the Marketplace app that issued the token (the OAuth flow runs on health.littlegiantmarketing.com). Refresh can never succeed until they match — reconnecting the app will NOT fix this.'
        : `refresh_token grant failed: ${JSON.stringify(tokens).slice(0, 300)}`
      console.error('[cron-refresh-token] refresh failed:', diagnosis, tokens)
      await setTokenStatus(false, diagnosis)
      return res.status(502).json({ error: 'Refresh failed', diagnosis, detail: tokens })
    }

    await kv.set(`ghl:company_token:${COMPANY_ID}`, {
      ...company,
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token || company.refreshToken,
      expiresAt:    Date.now() + (tokens.expires_in * 1000),
    })
    await setTokenStatus(true)

    console.log('[cron-refresh-token] Company token refreshed successfully')
    return res.status(200).json({ ok: true, refreshedAt: new Date().toISOString() })
  } catch (err) {
    console.error('[cron-refresh-token] error:', err.message)
    await setTokenStatus(false, err.message)
    return res.status(500).json({ error: err.message })
  }
}
