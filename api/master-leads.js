// Vercel serverless function — Master Dashboard data layer.
// Pulls contacts + opportunities for one GHL sub-account, joins them on contact ID,
// and resolves the custom fields the metrics depend on.
//
// Request:  GET /api/master-leads?locationId=<ghl_location_id>&from=YYYY-MM-DD&to=YYYY-MM-DD
// from/to filter on the lead's dateAdded (date-created attribution, not sale date —
// confirmed by John: a sale today from a 4-month-old lead belongs to that lead's
// original month, not today's).
//
// Performance: the actual GHL pull (loadRaw) is cached in Supabase per locationId
// for CACHE_TTL_MS and shared across every date-range request — switching between
// Today / Yesterday / 7 Days / This Month / etc. re-runs only the cheap in-memory
// join+filter (buildLeads), not a new ~150-request round trip to GHL. A background
// cron (api/cron-refresh-master-cache.js) keeps the cache warm so an interactive
// user should rarely be the one who pays for a cold-cache pull. Pass &refresh=1 to
// force a live re-pull regardless of cache age (e.g. a manual "refresh" button).

import { getLocationAccessToken } from './_ghlAuth.js'
import { kv } from './_supabase.js'
import {
  loadRaw, buildLeads, cacheKey, touchKnownLocations, CACHE_TTL_MS,
  getCacheMeta, cacheIsFresh, saveCacheIfChanged, acquireRefreshLock, releaseRefreshLock,
} from './_masterLeadsCore.js'

// GHL location IDs are 20-char alphanumeric (e.g. EsfaSslc9A9wO3hXkJNj). A
// 24-char lowercase-hex value is a Mongo ObjectId from somewhere else in the
// stack — company ID, user ID, a record ID from an automation — and passing
// one here fails in a way that reads like an auth error but isn't.
const LOCATION_ID_LEN = 20
const WELL_FORMED_LOCATION_ID = new RegExp(`^[A-Za-z0-9]{${LOCATION_ID_LEN}}$`)

function defaultDateRange() {
  const to = new Date()
  const from = new Date()
  from.setMonth(from.getMonth() - 3) // matches QuickSight's "Last 3 months" default
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

export default async function handler(req, res) {
  const { locationId } = req.query
  if (!locationId) return res.status(400).json({ error: 'locationId query param is required' })

  const defaults = defaultDateRange()
  const from = req.query.from || defaults.from
  const to   = req.query.to   || defaults.to
  const fromMs = new Date(`${from}T00:00:00Z`).getTime()
  const toMs   = new Date(`${to}T23:59:59Z`).getTime()
  const forceRefresh = req.query.refresh === '1'

  res.setHeader('Cache-Control', 'no-store')

  try {
    const { token, reason } = await getLocationAccessToken(locationId)
    let stale = false
    let staleReason = null

    if (!token) {
      // Live token is dead (expired refresh token, GHL outage, etc). Rather
      // than hard-failing the whole dashboard, fall back to whatever was last
      // cached for this location, however old — a stale number beats a blank
      // error screen, and the "Data as of" banner already tells the viewer
      // how old it is. Only a location that has NEVER successfully loaded
      // (no cache at all yet) actually 404s.
      const cached = await kv.get(cacheKey(locationId))
      if (!cached) {
        // Distinguish "this ID isn't a real location" from "our token died".
        // These have completely different fixes (correct the embed URL vs.
        // reconnect the GHL app), and reporting both as a generic OAuth
        // failure has repeatedly sent debugging down the wrong path.
        if (/location not found/i.test(reason || '')) {
          return res.status(400).json({
            error: `GHL does not recognize "${locationId}" as a location in this agency.`,
            hint: WELL_FORMED_LOCATION_ID.test(locationId)
              ? 'The ID is the right shape but GHL returned "Location not found" — the sub-account may have been deleted, or the app is not installed on it.'
              : `That value doesn't look like a GHL location ID (those are ${LOCATION_ID_LEN} letters/digits, e.g. EsfaSslc9A9wO3hXkJNj). It looks like a different object's ID — check what the embed URL or workflow is passing as locationId.`,
            reason,
            tokenHealthy: true,
          })
        }
        return res.status(404).json({
          error: `No OAuth token available for location "${locationId}", and no cached data to fall back to.`,
          reason,
        })
      }
      stale = true
      staleReason = reason
      await touchKnownLocations(locationId)
      const { leads, missingFields } = buildLeads(cached, fromMs, toMs)
      return res.json({
        locationId, from, to,
        totalContactsScanned:     cached.contacts.length,
        totalOpportunitiesScanned: cached.opportunities.length,
        contactsPagination:     cached.contactsPagination,
        opportunitiesPagination: cached.opportunitiesPagination,
        leadsInRange: leads.length,
        fieldMap: cached.fieldMap,
        missingFields,
        allFields: cached.allFields,
        customFieldsError: cached.customFieldsError,
        leads,
        fetchedAt: cached.fetchedAt,
        cacheAgeMs: Date.now() - new Date(cached.fetchedAt).getTime(),
        stale, staleReason,
      })
    }

    await touchKnownLocations(locationId)

    let raw = forceRefresh ? null : await kv.get(cacheKey(locationId))
    const meta    = await getCacheMeta(locationId)
    const isFresh = !forceRefresh && raw && cacheIsFresh(raw, meta)

    if (!isFresh) {
      // If the cron (or another request) is refreshing this location right now, don't start a
      // second identical pull — serve the cached copy and mark it stale.
      if (!(await acquireRefreshLock(locationId))) {
        if (raw) { stale = true; staleReason = 'refresh already in progress' }
        else throw new Error('Cache is being built for this location — try again in a minute')
      } else {
        try {
          raw = await loadRaw(token, locationId)
          await saveCacheIfChanged(locationId, raw, meta)
        } catch (err) {
          // Live pull failed even with a token in hand (rate limit, GHL 5xx,
          // etc) — same fallback: serve what's cached rather than erroring if
          // we have anything at all, even the just-failed isFresh===false copy.
          if (raw) { stale = true; staleReason = err.message }
          else throw err
        } finally {
          await releaseRefreshLock(locationId)
        }
      }
    }

    const { leads, missingFields } = buildLeads(raw, fromMs, toMs)

    res.json({
      locationId,
      from,
      to,
      totalContactsScanned:     raw.contacts.length,
      totalOpportunitiesScanned: raw.opportunities.length,
      contactsPagination:     raw.contactsPagination,
      opportunitiesPagination: raw.opportunitiesPagination,
      leadsInRange: leads.length,
      fieldMap: raw.fieldMap,
      missingFields,
      allFields: raw.allFields,
      customFieldsError: raw.customFieldsError,
      leads,
      fetchedAt: raw.fetchedAt,
      cacheAgeMs: Date.now() - new Date(raw.fetchedAt).getTime(),
      stale, staleReason,
    })
  } catch (err) {
    console.error('master-leads error:', err.message)
    res.status(500).json({ error: err.message })
  }
}
