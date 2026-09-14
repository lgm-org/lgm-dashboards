// GET /api/auth-google-start — redirects to Google OAuth
// Restricted to @littlegiantmarketing.com via hd param
export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return res.status(500).send('GOOGLE_CLIENT_ID not configured')

  const redirectUri = 'https://health.littlegiantmarketing.com/api/auth-health-google-callback'
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'email profile',
    hd:            'littlegiantmarketing.com',
    access_type:   'online',
    prompt:        'select_account',
  })
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}
