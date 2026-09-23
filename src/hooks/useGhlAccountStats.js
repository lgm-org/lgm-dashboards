import { useState, useEffect } from 'react'

const SUPABASE_URL = 'https://apfffxrydfkiokuysivy.supabase.co'
const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwZmZmeHJ5ZGZraW9rdXlzaXZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NDkyNTAsImV4cCI6MjEwMjAyNTI1MH0.T9-hXUucxuJkEuBKzT1bLmjPInWw_SbkG7hXjjepl6Q'

// Returns a map of { locationId → { lastContactUpdate, lastSaleDate, syncedAt } }
// These are written by ghl-location-data.js whenever a modal is opened,
// giving us accurate GHL contact activity for every account that's been viewed.
// Refreshes every 10 minutes to pick up new entries as team members open modals.
export function useGhlAccountStats() {
  const [statsMap, setStatsMap] = useState({})
  const [statsLoaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = () =>
      fetch(
        `${SUPABASE_URL}/rest/v1/ghl_account_stats?select=location_id,last_contact_update,last_contact_created,last_call_date,last_sale_date,sync_note,synced_at&limit=2000`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
      )
        .then(r => r.json())
        .then(rows => {
          if (cancelled || !Array.isArray(rows)) return
          const map = {}
          rows.forEach(row => {
            if (row.location_id) {
              map[row.location_id] = {
                lastContactUpdate:  row.last_contact_update  || null,
                lastContactCreated: row.last_contact_created || null,
                lastCallDate:       row.last_call_date       || null,
                lastSaleDate:       row.last_sale_date       || null,
                syncNote:           row.sync_note            || null,
                syncedAt:           row.synced_at            || null,
              }
            }
          })
          setStatsMap(map)
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoaded(true) })

    load()
    const id = setInterval(load, 10 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return { statsMap, statsLoaded }
}
