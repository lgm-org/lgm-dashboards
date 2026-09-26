import { useState, useEffect, useCallback } from 'react'

const SUPABASE_URL = 'https://apfffxrydfkiokuysivy.supabase.co'
const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwZmZmeHJ5ZGZraW9rdXlzaXZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NDkyNTAsImV4cCI6MjEwMjAyNTI1MH0.T9-hXUucxuJkEuBKzT1bLmjPInWw_SbkG7hXjjepl6Q'

const SELECT = 'location_id,last_contact_update,last_contact_created,last_call_date,last_sale_date,calls_7d,calls_yesterday_in,calls_yesterday_out,calls_source,won_30d,won_prior_30d,tickets_7d,meaningful_activity_at,health_score,sync_note,synced_at'

const REFRESH_MS = 10 * 60 * 1000
const RETRY_MS   = 60 * 1000

// Returns { statsMap: { locationId → signals }, statsLoaded, statsError, latestSyncedAt }
// Rows are written by api/ghl-sync-activity-batch.js. On a failed fetch the previous map is
// kept (never wiped), statsError is set, and the fetch retries every minute until it succeeds —
// otherwise every account would silently turn into "No GHL Data".
export function useGhlAccountStats() {
  const [statsMap, setStatsMap]       = useState({})
  const [statsLoaded, setLoaded]      = useState(false)
  const [statsError, setError]        = useState(null)
  const [latestSyncedAt, setLatest]   = useState(null)

  const load = useCallback(async () => {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 25_000)
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/ghl_account_stats?select=${SELECT}&limit=2000`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }, signal: ctrl.signal }
      )
      clearTimeout(t)
      if (!r.ok) throw new Error(`Supabase HTTP ${r.status}`)
      const rows = await r.json()
      if (!Array.isArray(rows)) throw new Error('Unexpected response')
      const map = {}
      let latest = null
      rows.forEach(row => {
        if (!row.location_id) return
        map[row.location_id] = {
          lastContactUpdate:    row.last_contact_update    || null,
          lastContactCreated:   row.last_contact_created   || null,
          lastCallDate:         row.last_call_date         || null,
          lastSaleDate:         row.last_sale_date         || null,
          calls7d:              row.calls_7d               ?? null,
          callsYesterdayIn:     row.calls_yesterday_in     ?? null,
          callsYesterdayOut:    row.calls_yesterday_out    ?? null,
          callsSource:          row.calls_source           || null,
          won30d:               row.won_30d                ?? null,
          wonPrior30d:          row.won_prior_30d          ?? null,
          tickets7d:            row.tickets_7d             ?? null,
          meaningfulActivityAt: row.meaningful_activity_at || null,
          healthScore:          row.health_score           ?? null,
          syncNote:             row.sync_note              || null,
          syncedAt:             row.synced_at              || null,
        }
        if (row.synced_at && (!latest || row.synced_at > latest)) latest = row.synced_at
      })
      setStatsMap(map)
      setLatest(latest)
      setError(null)
      return true
    } catch (err) {
      setError(err.name === 'AbortError' ? 'Supabase timed out' : err.message)
      return false
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer
    const run = async () => {
      const ok = await load()
      if (cancelled) return
      timer = setTimeout(run, ok ? REFRESH_MS : RETRY_MS)
    }
    run()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [load])

  return { statsMap, statsLoaded, statsError, latestSyncedAt, reloadStats: load }
}
