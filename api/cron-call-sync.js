// Vercel cron (every minute) — the source of truth for "is this call still live".
// GHL's webhook stream is unreliable for call-end events (the n8n tracker only
// ever receives connect + missed, never completed), so rows in active_calls would
// otherwise sit on the live bar forever. This asks GHL directly for each active
// row and removes the ones whose call has ended.
//
// Lookup order per row:
//   1. /conversations/messages/{row.id}  — when the row id is the GHL call message id
//   2. contact by phone → conversation → latest TYPE_CALL message since started_at
// A row is also removed once it is older than MAX_CALL_AGE_MS regardless.
//
// ?dry=1 reports what would happen without deleting.

import { createClient } from '@supabase/supabase-js'
import { getLocationAccessToken, ghlFetch } from './_ghlAuth.js'

const LOCATION_ID     = process.env.GHL_LOCATION_ID || 'k0kz7epnAGvpdoV79ONk'
const MAX_CALL_AGE_MS = 3 * 60 * 60 * 1000
const GRACE_MS        = 2 * 60 * 1000

// Anything GHL reports that is not one of these means the call is over.
const LIVE_STATUSES = new Set(['pending', 'ringing', 'in-progress', 'in_progress', 'answered', 'connected', 'queued', 'initiated'])

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const digits = p => (p || '').replace(/\D/g, '').slice(-10)

async function resolveToken() {
  if (process.env.GHL_LOCATION_TOKEN) return { token: process.env.GHL_LOCATION_TOKEN, source: 'GHL_LOCATION_TOKEN' }
  const { token, reason } = await getLocationAccessToken(LOCATION_ID)
  return { token, source: token ? 'oauth' : `none (${reason})` }
}

function summarizeMessage(m) {
  if (!m) return null
  return {
    id: m.id, type: m.type, messageType: m.messageType, status: m.status,
    direction: m.direction, dateAdded: m.dateAdded, callDuration: m.callDuration ?? m.meta?.call?.duration ?? null,
    callStatus: m.meta?.call?.status ?? null,
  }
}

function endedFromStatus(status) {
  if (!status) return null
  return LIVE_STATUSES.has(String(status).toLowerCase()) ? false : true
}

async function inspectRow(row, token) {
  const report = { id: row.id, startedAt: row.started_at, phone: `…${digits(row.contact_phone).slice(-4)}` }
  const startedMs = new Date(row.started_at).getTime()

  // 1. Row id as a message id
  const byId = await ghlFetch(`/conversations/messages/${row.id}`, token)
  report.byId = { http: byId.status, message: summarizeMessage(byId.json?.message || (byId.json?.id ? byId.json : null)), err: byId.text }
  const idStatus = report.byId.message?.callStatus || report.byId.message?.status
  if (byId.ok && report.byId.message) {
    report.ended = endedFromStatus(idStatus)
    report.via = 'message-id'
    if (report.ended !== null) return report
  }

  // 2. Contact by phone → conversation → latest call message
  const ph = digits(row.contact_phone)
  if (!ph) { report.ended = null; report.via = 'no-phone'; return report }

  const dup = await ghlFetch(`/contacts/search/duplicate?locationId=${LOCATION_ID}&number=${encodeURIComponent('+1' + ph)}`, token)
  const contactId = dup.json?.contact?.id || null
  report.contact = { http: dup.status, found: !!contactId, err: dup.text }
  if (!contactId) { report.ended = null; report.via = 'no-contact'; return report }

  const conv = await ghlFetch(`/conversations/search?locationId=${LOCATION_ID}&contactId=${contactId}&limit=3`, token)
  const conversations = conv.json?.conversations || []
  report.conversations = { http: conv.status, n: conversations.length, err: conv.text }

  const calls = []
  for (const c of conversations) {
    const msgs = await ghlFetch(`/conversations/${c.id}/messages?type=TYPE_CALL&limit=10`, token)
    const list = msgs.json?.messages?.messages || msgs.json?.messages || []
    report.messagesHttp = msgs.status
    for (const m of list) calls.push(summarizeMessage(m))
  }
  calls.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded))
  report.calls = calls.slice(0, 5)

  const match = calls.find(m => new Date(m.dateAdded).getTime() >= startedMs - GRACE_MS)
  if (match) {
    report.via = 'contact-latest-call'
    report.ended = endedFromStatus(match.callStatus || match.status)
  } else {
    report.via = 'no-call-message'
    report.ended = null
  }
  return report
}

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  // vercel.json crons are repo-wide, so every dashboard project schedules this.
  // Only the calls project (CALL_SYNC_ENABLED=true) may write — one writer.
  if (process.env.CALL_SYNC_ENABLED !== 'true') {
    return res.status(200).json({ ok: true, skipped: 'CALL_SYNC_ENABLED is not true on this project' })
  }
  const dry = req.query.dry === '1'

  try {
    const { data: rows, error } = await sb.from('active_calls').select('*').order('started_at', { ascending: true })
    if (error) throw new Error(`supabase read: ${error.message}`)

    const { token, source } = await resolveToken()
    const now = Date.now()
    const reports = []
    const toDelete = []

    for (const row of rows || []) {
      const age = now - new Date(row.started_at).getTime()
      if (age > MAX_CALL_AGE_MS) { toDelete.push({ id: row.id, reason: 'max-age' }); continue }
      if (!token) { reports.push({ id: row.id, ended: null, via: 'no-token' }); continue }
      const r = await inspectRow(row, token)
      reports.push(r)
      if (r.ended === true) toDelete.push({ id: row.id, reason: r.via })
    }

    let deleted = 0
    if (!dry && toDelete.length) {
      const { error: delErr } = await sb.from('active_calls').delete().in('id', toDelete.map(d => d.id))
      if (delErr) throw new Error(`supabase delete: ${delErr.message}`)
      deleted = toDelete.length
    }

    console.log(`[cron-call-sync] rows=${rows?.length ?? 0} ended=${toDelete.length} deleted=${deleted} token=${source}`)
    return res.status(200).json({ ok: true, dry, tokenSource: source, rows: rows?.length ?? 0, toDelete, deleted, reports: dry ? reports : undefined })
  } catch (err) {
    console.error('[cron-call-sync] error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
