import { useState, useCallback } from 'react'

const STORAGE_KEY = 'lgm-missed-call-statuses'

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function persist(map) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)) } catch {}
}

export function useMissedCallStatus() {
  const [statuses, setStatuses] = useState(load)

  const setStatus = useCallback((id, newStatus) => {
    setStatuses(prev => {
      const key  = String(id)
      const next = { ...prev }
      if (newStatus === null) {
        delete next[key]
      } else if (newStatus === 'resolved') {
        next[key] = { status: 'resolved', resolvedAt: Date.now() }
      } else {
        next[key] = { status: newStatus, resolvedAt: null }
      }
      persist(next)
      return next
    })
  }, [])

  const getStatus = useCallback((id) =>
    statuses[String(id)]?.status ?? 'action_required',
    [statuses]
  )

  return { statuses, setStatus, getStatus }
}
