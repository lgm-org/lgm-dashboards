// Keeps the Master Dashboard's per-location GHL data cache warm so interactive
// requests almost never hit the slow ~150-request live pull themselves — see
// api/_masterLeadsCore.js for why the cache exists and api/master-leads.js for
// the read side. Runs on a schedule (vercel.json crons) against every location
// that has ever loaded the dashboard (registered via touchKnownLocations).
//
// vercel.json is shared by every Vercel project built from this repo, so this
// cron fires on each of them. Only the Master Dashboard project may do the work —
// otherwise the same 10–90 MB caches get uploaded to Supabase twice within seconds.

import { getLocationAccessToken } from './_ghlAuth.js'
import { kv } from './_supabase.js'
import {
  loadRaw, KNOWN_LOCATIONS_KEY, getCacheMeta, cacheIsFresh,
  saveCacheIfChanged, acquireRefreshLock, releaseRefreshLock,
} from './_masterLeadsCore.js'

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (process.env.VITE_APP_MODE !== 'master') {
    return res.status(200).json({ skipped: `not the master project (VITE_APP_MODE=${process.env.VITE_APP_MODE || 'unset'})` })
  }

  const locations = (await kv.get(KNOWN_LOCATIONS_KEY)) || []
  const results = []

  for (const locationId of locations) {
    try {
      const meta = await getCacheMeta(locationId)
      // Another writer (an interactive request) refreshed this location recently — skip the pull entirely
      if (meta && cacheIsFresh(null, meta)) {
        results.push({ locationId, ok: true, skipped: 'fresh' })
        continue
      }
      if (!(await acquireRefreshLock(locationId))) {
        results.push({ locationId, ok: true, skipped: 'locked' })
        continue
      }
      try {
        const { token, reason } = await getLocationAccessToken(locationId)
        if (!token) {
          results.push({ locationId, ok: false, reason })
          continue
        }
        const raw = await loadRaw(token, locationId)
        const { written } = await saveCacheIfChanged(locationId, raw, meta)
        results.push({ locationId, ok: true, written, contacts: raw.contacts.length, opportunities: raw.opportunities.length })
      } finally {
        await releaseRefreshLock(locationId)
      }
    } catch (err) {
      results.push({ locationId, ok: false, error: err.message })
    }
  }

  const written = results.filter(r => r.written).length
  const skipped = results.filter(r => r.skipped).length
  res.json({ locations: locations.length, written, skipped, refreshed: results, at: new Date().toISOString() })
}
