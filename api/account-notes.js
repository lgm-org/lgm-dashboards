// Team notes on a client sub-account (per John, 2026-10-03).
//   GET  /api/account-notes?locationId=X            → notes, newest first
//   GET  /api/account-notes?locationId=X&resolve=1  → which LGM GHL contact a note would mirror to (no write)
//   POST /api/account-notes { locationId, body }    → saves the note, then mirrors it as a regular
//        note on the client's contact in LGM's own GHL sub-account (contact found by its
//        "Sub-account ID" custom field). The dashboard DB is the source of truth; a failed mirror
//        is recorded on the row, never blocks the note.
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from './_session.js'
import { getLocationAccessToken, ghlFetch } from './_ghlAuth.js'
import { loadLgmCustomers, LGM_LOCATION_ID } from './_briefingSources.js'

const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// LGM's customer contacts change rarely; one pull per warm instance per 10 minutes
let customersCache = { at: 0, data: null }
async function lgmContactFor(locationId) {
  if (!customersCache.data || Date.now() - customersCache.at > 10 * 60 * 1000) {
    customersCache = { at: Date.now(), data: await loadLgmCustomers() }
  }
  const c = customersCache.data
  if (!c?.available) return { contact: null, reason: c?.reason || 'LGM customers unavailable' }
  const rec = c.bySubAccount?.[locationId]
  return rec ? { contact: rec, reason: null } : { contact: null, reason: 'no LGM contact has this Sub-account ID' }
}

async function mirrorToGhl(locationId, text, authorName) {
  const { contact, reason } = await lgmContactFor(locationId)
  if (!contact) return { ghlContactId: null, ghlNoteId: null, error: reason }
  const { token, reason: tokenReason } = await getLocationAccessToken(LGM_LOCATION_ID)
  if (!token) return { ghlContactId: contact.contactId, ghlNoteId: null, error: tokenReason || 'no LGM token' }
  const r = await ghlFetch(`/contacts/${contact.contactId}/notes`, token, 'POST', {
    body: `[Health Dashboard · ${authorName}] ${text}`,
  })
  if (!r.ok) return { ghlContactId: contact.contactId, ghlNoteId: null, error: `GHL notes HTTP ${r.status}: ${r.text || ''}`.trim() }
  return { ghlContactId: contact.contactId, ghlNoteId: r.json?.note?.id || r.json?.id || null, error: null }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const user = getSessionUser(req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  if (req.method === 'GET') {
    const { locationId, resolve, all } = req.query

    // ?all=1 → per-account summary for the All Accounts table: last note + the 5 most recent
    if (all === '1') {
      const { data, error } = await sb().from('account_notes')
        .select('location_id, author_name, author_email, body, created_at')
        .order('created_at', { ascending: false }).limit(3000)
      if (error) return res.status(500).json({ error: error.message })
      const byLocation = {}
      for (const n of data || []) {
        const e = (byLocation[n.location_id] ||= { count: 0, last: null, recent: [] })
        e.count++
        if (!e.last) e.last = n
        if (e.recent.length < 5) e.recent.push(n)
      }
      return res.json({ byLocation, syncedAt: new Date().toISOString() })
    }

    if (!locationId) return res.status(400).json({ error: 'locationId required' })
    if (resolve === '1') {
      const { contact, reason } = await lgmContactFor(locationId)
      return res.json({ locationId, contact: contact ? { contactId: contact.contactId, name: contact.name, email: contact.email } : null, reason })
    }
    const { data, error } = await sb().from('account_notes')
      .select('id, author_email, author_name, body, created_at, ghl_contact_id, ghl_note_id, mirror_error')
      .eq('location_id', locationId).order('created_at', { ascending: false }).limit(200)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ locationId, notes: data || [] })
  }

  if (req.method === 'POST') {
    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
    const locationId = String(body?.locationId || '').trim()
    const text = String(body?.body || '').trim()
    if (!locationId || !text) return res.status(400).json({ error: 'locationId and body required' })
    if (text.length > 4000) return res.status(400).json({ error: 'Note is too long (4000 characters max)' })

    const { data: inserted, error } = await sb().from('account_notes')
      .insert({ location_id: locationId, author_email: user.email, author_name: user.name, body: text })
      .select().single()
    if (error) return res.status(500).json({ error: error.message })

    const mirror = await mirrorToGhl(locationId, text, user.name)
    await sb().from('account_notes')
      .update({ ghl_contact_id: mirror.ghlContactId, ghl_note_id: mirror.ghlNoteId, mirror_error: mirror.error })
      .eq('id', inserted.id)
    return res.json({ note: { ...inserted, ghl_contact_id: mirror.ghlContactId, ghl_note_id: mirror.ghlNoteId, mirror_error: mirror.error } })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
