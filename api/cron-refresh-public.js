// Public (no-auth) GHL token refresh endpoint.
// Called by n8n every 6 hours as a backup to the Vercel cron.
// This endpoint uses the same credentials as the main cron — the ones that
// actually match the stored token — so it succeeds where the goals-dashboard
// cron can't (different client_id on that project).
// Safe to leave open: it refreshes our own token and returns no credential values.
import { kv } from './_supabase.js'
import { setTokenStatus } from './_ghlAuth.js'

const GHL_BASE   = 'https://services.leadconnectorhq.com'
const COMPANY_ID = 'MKJeZKBhrN9uLt4ZWZCa'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const company = await kv.get(`ghl:company_token:${COMPANY_ID}`)
    if (!company?.refreshToken) {
      return res.status(404).json({ ok: false, error: 'No company token found' })
    }

    // If still fresh (more than 30 min remaining), skip the refresh — no-op is fine.
    const msLeft = company.expiresAt - Date.now()
    if (msLeft > 30 * 60 * 1000) {
      return res.status(200).json({ ok: true, skipped: true, msUntilExpiry: msLeft, message: 'Token still fresh — no refresh needed' })
    }

    const tokenRes = await fetch(`${GHL_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.GHL_CLIENT_ID,
        client_secret: process.env.GHL_CLIENT_SECRET,
        grant_type:    'refresh_token',
        refresh_token: company.refreshToken,
      }),
    })
    const tokens = await tokenRes.json().catch(() => ({}))

    if (!tokenRes.ok || !tokens.access_token) {
      await setTokenStatus(false, JSON.stringify(tokens).slice(0, 200))
      return res.status(502).json({ ok: false, error: 'Refresh failed', detail: tokens })
    }

    await kv.set(`ghl:company_token:${COMPANY_ID}`, {
      ...company,
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token || company.refreshToken,
      expiresAt:    Date.now() + (tokens.expires_in * 1000),
    })
    await setTokenStatus(true)

    return res.status(200).json({ ok: true, refreshedAt: new Date().toISOString() })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
}
