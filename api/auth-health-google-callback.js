// GET /api/auth-health-google-callback — Google OAuth callback for Customer Health dashboard
// Sets lgm-health-auth cookie in g.{base64url(email:role)}.{sig} format so Jarvis history works.
import * as crypto from 'crypto'

const COOKIE      = 'lgm-health-auth'
const BASE        = 'https://health.littlegiantmarketing.com'
const REDIRECT_URI = `${BASE}/api/auth-health-google-callback`
const ALLOWED_HD  = 'littlegiantmarketing.com'
const ONE_YEAR    = 60 * 60 * 24 * 365

function makeToken(email, secret) {
  const payload = Buffer.from(`${email}:admin`).toString('base64url')
  const sig     = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  return `g.${payload}.${sig}`
}

export default async function handler(req, res) {
  const { code, error: oauthError } = req.query
  if (oauthError) return res.redirect(302, `/?login=1&error=${oauthError}`)
  if (!code)      return res.redirect(302, '/?login=1&error=no_code')

  const clientId      = process.env.GOOGLE_CLIENT_ID
  const clientSecret  = process.env.GOOGLE_CLIENT_SECRET
  const sessionSecret = process.env.SESSION_SECRET

  if (!clientId || !clientSecret || !sessionSecret) {
    return res.status(500).send('Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / SESSION_SECRET')
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
      }).toString(),
    })
    const tokens = await tokenRes.json()
    if (!tokens.access_token) {
      console.error('[health-google-callback] Token exchange failed:', tokens)
      return res.redirect(302, '/?login=1&error=token_exchange')
    }

    const profileRes = await fetch(
      `https://www.googleapis.com/oauth2/v1/userinfo?access_token=${tokens.access_token}`
    )
    const profile = await profileRes.json()
    const email   = (profile.email || '').toLowerCase()

    if (!email.endsWith(`@${ALLOWED_HD}`)) {
      return res.redirect(302, '/?login=1&error=domain_not_allowed')
    }

    const token = makeToken(email, sessionSecret)
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax; Secure`)
    return res.redirect(302, '/')
  } catch (err) {
    console.error('[health-google-callback] error:', err)
    return res.redirect(302, '/?login=1&error=server_error')
  }
}
