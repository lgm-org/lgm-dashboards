import { useState, useEffect, useCallback } from 'react'

// Shared "action taken" marks (Supabase via /api/account-actions) — one per sub-account:
// { location_id, action_text, done_by_name, done_by_email, done_at }
export function useAccountActions() {
  const [actions, setActions] = useState({})
  const [loaded, setLoaded]   = useState(false)

  const load = useCallback(() =>
    fetch('/api/account-actions')
      .then(r => r.ok ? r.json() : { actions: {} })
      .then(d => setActions(d.actions || {}))
      .catch(() => {})
      .finally(() => setLoaded(true)), [])

  useEffect(() => {
    load()
    const id = setInterval(load, 120_000)
    return () => clearInterval(id)
  }, [load])

  // Optimistic toggle; the server reply replaces the optimistic row
  const setActionDone = useCallback(async (locationId, actionText, done) => {
    setActions(prev => {
      const next = { ...prev }
      if (done) next[locationId] = { location_id: locationId, action_text: actionText, done_by_name: 'you', done_at: new Date().toISOString(), _pending: true }
      else delete next[locationId]
      return next
    })
    try {
      const r = await fetch('/api/account-actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, actionText, done }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setActions(prev => {
        const next = { ...prev }
        if (d.action) next[locationId] = d.action
        else delete next[locationId]
        return next
      })
    } catch (err) {
      await load() // roll back to the server's truth
      throw err
    }
  }, [load])

  return { actions, actionsLoaded: loaded, setActionDone, reloadActions: load }
}
