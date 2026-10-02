// Shared "action taken" mark on a sub-account's Recommended Action (per John, 2026-10-03).
// Visible to every team member, unlike the per-browser status tracker.
//   GET  /api/account-actions                                  → { actions: { locationId: row } }
//   POST /api/account-actions { locationId, actionText, done } → mark (done=true) or clear (done=false)
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from './_session.js'

const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const user = getSessionUser(req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  if (req.method === 'GET') {
    const { data, error } = await sb().from('account_actions').select('*').limit(5000)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ actions: Object.fromEntries((data || []).map(r => [r.location_id, r])) })
  }

  if (req.method === 'POST') {
    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
    const locationId = String(body?.locationId || '').trim()
    if (!locationId) return res.status(400).json({ error: 'locationId required' })

    if (body?.done === false) {
      const { error } = await sb().from('account_actions').delete().eq('location_id', locationId)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ locationId, action: null })
    }
    const row = {
      location_id: locationId,
      action_text: String(body?.actionText || '').slice(0, 500) || null,
      done_by_email: user.email, done_by_name: user.name,
      done_at: new Date().toISOString(),
    }
    const { data, error } = await sb().from('account_actions').upsert(row, { onConflict: 'location_id' }).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ locationId, action: data })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
