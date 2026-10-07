import { useState, useEffect, useCallback } from 'react'

// Per-account note summary for the All Accounts table: { locationId → { count, last, recent[5] } }
export function useAccountNotesSummary() {
  const [byLocation, setByLocation] = useState({})

  const reload = useCallback(() =>
    fetch('/api/account-notes?all=1')
      .then(r => r.ok ? r.json() : { byLocation: {} })
      .then(d => setByLocation(d.byLocation || {}))
      .catch(() => {}), [])

  useEffect(() => {
    reload()
    const id = setInterval(reload, 120_000)
    return () => clearInterval(id)
  }, [reload])

  return { notesByLocation: byLocation, reloadNotes: reload }
}
