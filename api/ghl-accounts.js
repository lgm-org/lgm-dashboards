// Vercel serverless function — fetches all GHL sub-accounts for LGM agency.
// Frontend calls GET /api/ghl-accounts; this proxies to GHL so the API key
// never touches the browser.
//
// Env var required: GHL_AGENCY_API_KEY (set in Vercel project settings)

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VER  = '2021-07-28'

async function ghlGet(path, key) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Version: GHL_VER },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GHL ${path} → HTTP ${res.status}: ${body.slice(0, 120)}`)
  }
  return res.json()
}

// Shared by the HTTP handler below and the daily briefing job (api/_briefingSources.js).
// Returns the same payload the endpoint serves.
export async function fetchGhlAccounts(key) {
    // Page through all locations (GHL returns max 100 per request)
    let all = [], skip = 0
    while (true) {
      const data  = await ghlGet(`/locations/search?limit=100&skip=${skip}`, key)
      const batch = data.locations || []
      all = all.concat(batch)
      if (batch.length < 100) break
      skip += 100
    }

    const now = new Date()

    // Strip internal / non-client accounts — pattern match + exact name list
    const SANDBOX_PATTERNS = /sandbox|test account|test 2|in progress|bilingual snapshot/i
    const EXCLUDED_NAMES   = new Set([
      'little giant dev',
      'recruitment account - dm',
      'clifford berman\'s account',
      'kitajima insurance',
      'lgm add-ons',
      'data forest',
      // Synced from frontend EXCLUDED_NAMES (useMergedHealthData.js)
      'lgm nps survey',
      "joe perniciaro's account",
      'hlpt saas snapshot',
      'tippy taps',
      'mallard',
      'lgm add-on',
      'lgm add on',
      'lgm addon',
      'lgm training',
      'lgm training account',
      'lgm test',
      'lgm demo',
      'lgm demo account',
      'little giant marketing',
      'little giant marketing agency',
      'data forest lgm add-on',
      'data forest lgm add on',
    ])
    const realLocs = all.filter(loc => {
      const name = (loc.name || '').trim()
      return !SANDBOX_PATTERNS.test(name) && !EXCLUDED_NAMES.has(name.toLowerCase())
    })

    const accounts = realLocs.map(loc => {
      const updatedAt        = loc.dateUpdated ? new Date(loc.dateUpdated) : null
      const daysSinceUpdate  = updatedAt
        ? Math.floor((now - updatedAt) / 86_400_000)
        : null

      return {
        // ✅ Available now with current scopes
        ghlId:              loc.id,
        ghlName:            loc.name            || '',
        ghlEmail:           loc.email           || '',
        ghlPhone:           loc.phone           || '',
        ghlCity:            loc.city            || '',
        ghlState:           loc.state           || '',
        ghlCountry:         loc.country         || '',
        ghlWebsite:         loc.website         || '',
        ghlTimezone:        loc.timezone        || '',
        ghlDateAdded:       loc.dateAdded
          ? new Date(loc.dateAdded).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) : null,
        ghlDateUpdated:     loc.dateUpdated
          ? new Date(loc.dateUpdated).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) : null,
        ghlDaysSinceUpdate: daysSinceUpdate,
        ghlPermissions:     loc.permissions     || {},
        ghlSnapshotId:      loc.snapshotId      || '',
        ghlDisabled:        loc.disabled        || false,

        // ⚠️ Null = needs additional GHL API scope — will show as pending in UI
        ghlUserCount:       null,  // needs users.readonly scope
        ghlContactCount:    null,  // needs contacts.readonly scope
        ghlTransactions:    null,  // needs saas/subscription scope
        ghlLcWallet:        null,  // needs payments.readonly scope
        ghlOpportunities:   null,  // needs opportunities.readonly scope
      }
    })

    return { accounts, total: accounts.length, rawTotal: all.length, syncedAt: now.toISOString() }
}

export default async function handler(req, res) {
  const key = process.env.GHL_AGENCY_API_KEY
  if (!key) {
    return res.status(500).json({ error: 'GHL_AGENCY_API_KEY env var not configured in Vercel' })
  }

  try {
    const payload = await fetchGhlAccounts(key)
    // Cache at Vercel edge for 5 minutes, serve stale for up to 1 hour — reduces serverless invocations
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600')
    res.json(payload)
  } catch (err) {
    console.error('GHL accounts fetch error:', err.message)
    res.status(500).json({ error: err.message })
  }
}
