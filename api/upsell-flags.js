// Upsell "unflag" (John, 2026-10-05). An unflagged account drops off the upsell list in the
// dashboard AND the Sales briefing for UPSELL_DISMISS_DAYS, then qualifies again automatically.
//   GET    /api/upsell-flags                 → { byLocationId: { <id>: { dismissed_at, dismissed_by, until } } }
//   POST   /api/upsell-flags { locationId, by?, note? } → unflag
//   DELETE /api/upsell-flags { locationId }  → re-flag now
import { createClient } from '@supabase/supabase-js'
import { UPSELL_DISMISS_DAYS } from '../src/lib/healthConfig.js'

const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const DAY_MS = 86_400_000

export async function activeDismissals() {
  const since = new Date(Date.now() - UPSELL_DISMISS_DAYS * DAY_MS).toISOString()
  const { data, error } = await sb().from('upsell_dismissals').select('*').gte('dismissed_at', since)
  if (error) throw new Error(error.message)
  const byLocationId = {}
  for (const r of data || []) byLocationId[r.location_id] = { dismissed_at: r.dismissed_at, dismissed_by: r.dismissed_by, note: r.note, until: new Date(new Date(r.dismissed_at).getTime() + UPSELL_DISMISS_DAYS * DAY_MS).toISOString() }
  return byLocationId
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'Supabase not configured' })
  try {
    if (req.method === 'GET') return res.json({ byLocationId: await activeDismissals(), days: UPSELL_DISMISS_DAYS })
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const locationId = String(body.locationId || '').trim()
    if (!locationId) return res.status(400).json({ error: 'locationId required' })
    if (req.method === 'POST') {
      const { error } = await sb().from('upsell_dismissals').upsert({ location_id: locationId, dismissed_at: new Date().toISOString(), dismissed_by: body.by || null, note: body.note || null }, { onConflict: 'location_id' })
      if (error) throw new Error(error.message)
      return res.json({ ok: true, locationId, days: UPSELL_DISMISS_DAYS })
    }
    if (req.method === 'DELETE') {
      const { error } = await sb().from('upsell_dismissals').delete().eq('location_id', locationId)
      if (error) throw new Error(error.message)
      return res.json({ ok: true, locationId })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
