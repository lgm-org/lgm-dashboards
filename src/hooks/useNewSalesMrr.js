import { useState, useEffect } from 'react'

// Won opportunities in LGM's Sales Pipeline "Payment Made" stage (see api/new-sales-mrr.js).
// Each sale: { oppId, name, contactName, assignedTo, value, wonAt, wonDay }
export function useNewSalesMrr() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = () => fetch('/api/new-sales-mrr')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.available) { setData(d); setError(null) }
        else setError(d.reason || 'unavailable')
      })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    load()
    const id = setInterval(load, 300_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return { sales: data?.sales || [], pipeline: data?.pipeline || null, stage: data?.stage || null, stageFound: !!data?.stageFound, loading, error }
}
