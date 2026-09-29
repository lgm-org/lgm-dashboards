// Daily AI Briefings — data loaders.
// Everything here is read-only against the sources the dashboards already use
// (GHL agency API, Stripe, Supabase health tables, Freshdesk, the Team AI meeting
// sheet, and the LGM sub-account's call log in GHL). api/_briefingCollect.js turns
// these into per-role fact packs. No numbers are computed by the AI — only here.

import { createClient } from '@supabase/supabase-js'
import { fetchGhlAccounts } from './ghl-accounts.js'
import { buildStripeBilling, normalizeName, normalizePhone } from './stripe-billing.js'
import { MANUAL_LOC_TO_CUST } from '../src/lib/stripeOverrides.js'
import { getLocationAccessToken, ghlFetch } from './_ghlAuth.js'

export const TZ     = 'America/Chicago'
export const DAY_MS = 86_400_000

// Team AI Meeting Dashboard — the n8n workflow appends one row per analysed call/meeting.
// Same published CSV the QC dashboard reads (lgm-team-dashboard/src/hooks/useGoogleSheets.js).
export const MEETING_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9TCj76T9TTEpUxfy26VgDxQt7fpoJiaTJ1n0ITwk477r8_EgC-2tYB7mnoXfVwtw5BxzFvY0uA1gv/pub?output=csv'

// LGM's own sub-account — where the team's inbound calls land
export const LGM_LOCATION_ID = process.env.GHL_LOCATION_ID || 'k0kz7epnAGvpdoV79ONk'

export const DASHBOARD_URL = process.env.BRIEFING_DASHBOARD_URL || 'https://health.littlegiantmarketing.com'
export const accountLink = (locationId) => `${DASHBOARD_URL}/?account=${encodeURIComponent(locationId)}`

export { normalizeName, normalizePhone }

let _sb = null
export function sb() {
  if (!_sb) _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  return _sb
}

// ── Dates (all "days" are YYYY-MM-DD in Central time) ────────────────────────

export function localDay(date = new Date(), tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function addDays(dayStr, n) {
  const d = new Date(`${dayStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function tzOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return asUtc - date.getTime()
}

// UTC instant of local midnight at the start of dayStr
export function zonedMidnightUtc(dayStr, tz = TZ) {
  const guess = new Date(`${dayStr}T00:00:00Z`)
  return new Date(guess.getTime() - tzOffsetMs(guess, tz))
}

export function dayRange(fromDay, toDay = fromDay) {
  return { start: zonedMidnightUtc(fromDay), end: zonedMidnightUtc(addDays(toDay, 1)) }
}

export const daysBetween = (fromDay, toDay) =>
  Math.round((new Date(`${toDay}T00:00:00Z`) - new Date(`${fromDay}T00:00:00Z`)) / DAY_MS)

export const inDays = (dayStr, fromDay, toDay) => !!dayStr && dayStr >= fromDay && dayStr <= toDay

export const daysSinceIso = (iso, asOfDay) => iso ? daysBetween(localDay(new Date(iso)), asOfDay) : null

export const round2 = (n) => Math.round((n || 0) * 100) / 100
export const avg = (arr) => {
  const xs = arr.filter(x => typeof x === 'number' && !isNaN(x))
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null
}

// ── Sources ──────────────────────────────────────────────────────────────────

export async function loadAccounts() {
  const key = process.env.GHL_AGENCY_API_KEY
  if (!key) throw new Error('GHL_AGENCY_API_KEY not configured')
  const { accounts } = await fetchGhlAccounts(key)
  return accounts
}

export async function loadStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured')
  const data = await buildStripeBilling(key)
  const byCustomerId = {}
  for (const rec of Object.values(data.byEmail)) if (rec.stripeCustomerId) byCustomerId[rec.stripeCustomerId] = rec
  Object.assign(byCustomerId, data.byCustomerIdNoEmail || {})
  return { ...data, byCustomerId }
}

// Same join priority as useMergedHealthData.js (minus Cliff's sheet, which needs its own env var)
export function matchBilling(acct, stripe) {
  if (!stripe) return null
  const email    = (acct.ghlEmail || '').toLowerCase().trim()
  const normName = normalizeName(acct.ghlName)
  const phone    = normalizePhone(acct.ghlPhone)
  const manual   = MANUAL_LOC_TO_CUST[acct.ghlId]
  return (manual && stripe.byCustomerId[manual])
      || stripe.byLocId[acct.ghlId]
      || (email && stripe.byEmail[email])
      || (normName && stripe.byNormName[normName])
      || (phone && phone.length >= 10 && stripe.byPhone[phone])
      || null
}

export const ACTIVE_STRIPE = new Set(['active', 'trialing', 'past_due', 'open_invoice', 'unpaid'])

export async function loadStats() {
  const { data, error } = await sb().from('ghl_account_stats').select('*')
  if (error) throw new Error(`ghl_account_stats: ${error.message}`)
  return Object.fromEntries((data || []).map(r => [r.location_id, r]))
}

// { locationId: { 'YYYY-MM-DD': score } }
export async function loadHealthHistory(sinceDay) {
  const { data, error } = await sb().from('health_score_daily').select('location_id, day, score').gte('day', sinceDay)
  if (error) throw new Error(`health_score_daily: ${error.message}`)
  const out = {}
  for (const r of data || []) (out[r.location_id] ||= {})[r.day] = r.score
  return out
}

export async function loadDmMap() {
  const { data, error } = await sb().from('dm_agent_map').select('*').limit(5000)
  if (error) throw new Error(`dm_agent_map: ${error.message}`)
  return data || []
}

// ── Team AI meeting sheet ────────────────────────────────────────────────────

// Character-stream CSV parser: handles quoted commas and embedded newlines.
export function parseCsv(text) {
  const rows = []
  let row = [], cur = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur); rows.push(row); row = []; cur = ''
    } else cur += ch
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

function parseSheetDate(raw) {
  const s = (raw || '').trim()
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

const clean = (v) => {
  const s = (v ?? '').trim()
  return /^(none|null|n\/a|-)$/i.test(s) ? '' : s
}

export async function loadMeetings() {
  const res = await fetch(`${MEETING_SHEET_URL}&_t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`meeting sheet HTTP ${res.status}`)
  const text = await res.text()
  if (text.trim().startsWith('<!DOCTYPE')) throw new Error('meeting sheet returned HTML (not published?)')
  const rows = parseCsv(text)
  const headers = rows[0].map(h => h.trim().toLowerCase())
  const idx = (name) => headers.indexOf(name.toLowerCase())
  const col = {
    employee: idx('Employee'), date: idx('Date'), time: idx('Time'), customer: idx('Customer'), category: idx('Category'),
    duration: idx('Duration (min)'), callType: idx('Call Type'), verdict: idx('Final Verdict'), sentiment: idx('Customer Sentiment'),
    score: idx('Overall Score'), status: idx('Status'), actionItems: idx('Action Items'), owner: idx('Follow-up Owner'),
    deadline: idx('Promised Deadline'), risk: idx('Client Risk Level'), summary: idx('Summary'), redFlags: idx('Red Flags'),
    frustrated: idx('Frustrated Flag'), meetingId: idx('Meeting ID'), areas: idx('Areas for Improvement'),
  }
  const get = (r, k) => (col[k] >= 0 ? clean(r[col[k]]) : '')
  const out = []
  rows.slice(1).forEach((r, i) => {
    const date = parseSheetDate(get(r, 'date'))
    const customer = get(r, 'customer')
    if (!date || !customer) return
    const meetingId = get(r, 'meetingId')
    const locMatch = meetingId.match(/^GHL-([A-Za-z0-9]{20})-/)
    const callType = get(r, 'callType') || (meetingId.startsWith('GHL-') ? 'Phone Call' : 'Meeting')
    out.push({
      ref: `meeting:${i + 2}`,
      employee: get(r, 'employee'),
      date, time: get(r, 'time'), customer, normCustomer: normalizeName(customer),
      category: get(r, 'category') || 'General',
      callType,
      durationMin: Math.max(0, Math.round(parseFloat(get(r, 'duration')) || 0)),
      status: get(r, 'status'), verdict: get(r, 'verdict'), sentiment: get(r, 'sentiment'),
      score: parseFloat(get(r, 'score')) || null,
      actionItems: get(r, 'actionItems'), followUpOwner: get(r, 'owner'), promisedDeadline: get(r, 'deadline'),
      riskLevel: get(r, 'risk'), summary: get(r, 'summary'), redFlags: get(r, 'redFlags'), areasForImprovement: get(r, 'areas'),
      frustrated: /^(yes|true|1)$/i.test(get(r, 'frustrated')),
      meetingId, locationId: locMatch ? locMatch[1] : null,
    })
  })
  return out
}

// ── LGM inbound calls (GHL call messages on the LGM sub-account) ─────────────

async function lgmToken() {
  if (process.env.GHL_LOCATION_TOKEN) return process.env.GHL_LOCATION_TOKEN
  const { token } = await getLocationAccessToken(LGM_LOCATION_ID)
  return token
}

const MISSED_STATUSES = new Set(['no-answer', 'no_answer', 'busy', 'failed', 'canceled', 'cancelled', 'missed'])

// All call messages on the LGM sub-account for one Central-time day.
export async function loadLgmCalls(dayStr) {
  const token = await lgmToken()
  if (!token) return { available: false, reason: 'no LGM location token', calls: [] }
  const { start, end } = dayRange(dayStr)
  const convs = []
  let startAfter = null
  for (let page = 0; page < 6; page++) {
    const qs = `locationId=${LGM_LOCATION_ID}&lastMessageType=TYPE_CALL&sortBy=last_message_date&sort=desc&limit=100` +
               (startAfter ? `&startAfterDate=${startAfter}` : '')
    const r = await ghlFetch(`/conversations/search?${qs}`, token)
    if (!r.ok) return { available: false, reason: `conversations/search HTTP ${r.status} ${r.text || ''}`.trim(), calls: [] }
    const rows = r.json?.conversations || []
    let older = false
    for (const c of rows) {
      const last = Number(c.lastMessageDate || 0)
      if (last && last < start.getTime()) { older = true; break }
      convs.push(c)
    }
    if (older || rows.length < 100) break
    startAfter = rows[rows.length - 1]?.lastMessageDate
  }
  const calls = []
  for (const c of convs.slice(0, 250)) {
    const m = await ghlFetch(`/conversations/${c.id}/messages?type=TYPE_CALL&limit=20`, token)
    const list = m.json?.messages?.messages || m.json?.messages || []
    for (const msg of list) {
      const at = new Date(msg.dateAdded)
      if (isNaN(at) || at < start || at >= end) continue
      const status = String(msg.meta?.call?.status || msg.status || '').toLowerCase()
      const duration = Number(msg.meta?.call?.duration ?? msg.callDuration ?? 0) || 0
      calls.push({
        ref: `call:${msg.id}`,
        id: msg.id, at: at.toISOString(),
        timeLocal: new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(at),
        contactName: c.fullName || c.contactName || c.phone || 'Unknown caller',
        contactId: c.contactId || msg.contactId || null,
        direction: /out/i.test(msg.direction || '') ? 'outbound' : 'inbound',
        status: status || 'unknown',
        outcome: status === 'voicemail' ? 'voicemail' : (status === 'completed' && duration > 0) ? 'answered'
               : MISSED_STATUSES.has(status) || (status === 'completed' && duration === 0) ? 'missed' : status || 'unknown',
        durationSec: duration,
        userId: msg.userId || null,
      })
    }
  }
  calls.sort((a, b) => a.at.localeCompare(b.at))
  return { available: true, calls, conversationsScanned: convs.length }
}

// ── Freshdesk: tickets created in a window (support volume) ──────────────────

export async function loadFreshdeskCreated(sinceIso) {
  const domain = process.env.FRESHDESK_DOMAIN, key = process.env.FRESHDESK_API_KEY
  if (!domain || !key) return { available: false, created: null }
  const auth = 'Basic ' + Buffer.from(`${key}:X`).toString('base64')
  let created = 0, urgent = 0
  for (let page = 1; page <= 3; page++) {
    const r = await fetch(`https://${domain}.freshdesk.com/api/v2/tickets?updated_since=${encodeURIComponent(sinceIso)}&per_page=100&page=${page}&order_by=created_at&order_type=desc`,
      { headers: { Authorization: auth } })
    if (!r.ok) return { available: false, created: null, reason: `HTTP ${r.status}` }
    const batch = await r.json()
    if (!Array.isArray(batch) || !batch.length) break
    for (const t of batch) if (t.created_at >= sinceIso) { created++; if (t.priority >= 3) urgent++ }
    if (batch.length < 100) break
  }
  return { available: true, created, urgent }
}

// ── Briefing state tables ────────────────────────────────────────────────────

export async function loadSnapshot(role, runDay) {
  const { data } = await sb().from('briefing_snapshots').select('facts, run_date').eq('role', role).lt('run_date', addDays(runDay, 1))
    .order('run_date', { ascending: false }).limit(1).maybeSingle()
  return data || null
}

export async function loadPreviousSnapshot(role, runDay) {
  const { data } = await sb().from('briefing_snapshots').select('facts, run_date').eq('role', role).lt('run_date', runDay)
    .order('run_date', { ascending: false }).limit(1).maybeSingle()
  return data || null
}

export async function saveSnapshot(role, runDay, facts) {
  const { error } = await sb().from('briefing_snapshots').upsert({ role, run_date: runDay, facts }, { onConflict: 'role,run_date' })
  if (error) console.error('[briefing] saveSnapshot', role, error.message)
}

// Accounts this role was already told about recently — { account_id: { run_date, score, item_type } } (latest wins)
export async function loadRecentItems(role, sinceDay, beforeDay) {
  const { data } = await sb().from('briefing_items').select('account_id, item_type, score, run_date')
    .eq('role', role).gte('run_date', sinceDay).lt('run_date', beforeDay).order('run_date', { ascending: true })
  const out = {}
  for (const r of data || []) out[`${r.item_type}:${r.account_id}`] = r
  return out
}

export async function saveItems(rows) {
  if (!rows.length) return
  const { error } = await sb().from('briefing_items').upsert(rows, { onConflict: 'role,run_date,account_id,item_type' })
  if (error) console.error('[briefing] saveItems', error.message)
}

export async function logSend(row) {
  const { error } = await sb().from('briefing_sends').insert(row)
  if (error) console.error('[briefing] logSend', error.message)
}
