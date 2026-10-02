// Who is signed in to the Customer Health dashboard, from the lgm-health-auth cookie.
// Google sign-ins carry `g.<base64url(email:role)>.<hmac>` (api/auth-health-google-callback.js);
// the legacy password login stores the raw SESSION_SECRET and has no identity.
import crypto from 'node:crypto'

const COOKIE = 'lgm-health-auth'

function nameFromEmail(email) {
  const local = (email || '').split('@')[0]
  return local.split(/[._-]/).filter(Boolean).map(p => p[0].toUpperCase() + p.slice(1)).join(' ') || email
}

export function getSessionUser(req) {
  const secret = process.env.SESSION_SECRET
  if (!secret) return null
  const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))
  if (!raw) return null
  const val = raw.slice(COOKIE.length + 1)

  if (val.startsWith('g.')) {
    const [, payload, sig] = val.split('.')
    if (!payload || !sig) return null
    const expect = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
    if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null
    const [email, role] = Buffer.from(payload, 'base64url').toString().split(':')
    return { email: email || null, role: role || 'account_manager', name: nameFromEmail(email) }
  }
  if (val === secret) return { email: null, role: 'admin', name: 'Team (password login)' }
  return null
}
