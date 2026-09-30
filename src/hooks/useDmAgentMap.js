import { useState, useEffect } from 'react'

const SUPABASE_URL = 'https://apfffxrydfkiokuysivy.supabase.co'
const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwZmZmeHJ5ZGZraW9rdXlzaXZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NDkyNTAsImV4cCI6MjEwMjAyNTI1MH0.T9-hXUucxuJkEuBKzT1bLmjPInWw_SbkG7hXjjepl6Q'

// The DM Footprint: every agent sub-account that is assigned to a District Manager, as populated
// hourly by n8n from the GHL contact custom field (Supabase table dm_agent_map).
// Returns
//   dmMap  — { agentGhlLocationId → { dmName, agentName } }
//   dmList — [{ name, count }] sorted by name, one entry per DM (for the DM filter dropdown)
export function useDmAgentMap() {
  const [dmMap,    setDmMap]   = useState({})
  const [dmList,   setDmList]  = useState([])
  const [dmLoaded, setLoaded]  = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = () =>
      fetch(
        `${SUPABASE_URL}/rest/v1/dm_agent_map?select=agent_ghl_location_id,dm_name,agent_name&limit=2000`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
      )
        .then(r => r.json())
        .then(rows => {
          if (cancelled || !Array.isArray(rows)) return
          const map = {}
          const counts = {}
          rows.forEach(row => {
            if (row.agent_ghl_location_id) {
              const dmName = (row.dm_name || '').trim() || null
              map[row.agent_ghl_location_id] = { dmName, agentName: row.agent_name || null }
              if (dmName) counts[dmName] = (counts[dmName] || 0) + 1
            }
          })
          setDmMap(map)
          setDmList(Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)))
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoaded(true) })

    load()
    const id = setInterval(load, 60 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return { dmMap, dmList, dmLoaded }
}
