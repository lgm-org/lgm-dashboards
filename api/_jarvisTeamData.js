// Data layer + tool executors for Jarvis Team Intelligence (api/jarvis-team.js).
// Sources: the AI Team Assistant QC sheet (one analyzed row per call/meeting) and the
// transcript sheet n8n writes alongside it (full transcript keyed by Meeting ID).
// Both are fetched server-side and cached per warm instance.

const QC_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9TCj76T9TTEpUxfy26VgDxQt7fpoJiaTJ1n0ITwk477r8_EgC-2tYB7mnoXfVwtw5BxzFvY0uA1gv/pub?output=csv'
const TRANSCRIPT_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1ibn9348zgkBJJ99SeQWLh5YnQKArI1-aIwUW9cB8nUQ/export?format=csv&gid=0'

const CACHE_TTL_MS = 10 * 60 * 1000
let cache = { at: 0, calls: null, transcripts: null, promise: null }

// ── CSV (quoted fields may contain commas AND newlines — transcripts do) ─────
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false
      } else field += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

function toObjects(rows) {
  const [header, ...body] = rows
  const keys = header.map(h => h.trim())
  return body.filter(r => r.some(v => v && v.trim())).map(r => {
    const o = {}
    keys.forEach((k, i) => { o[k] = (r[i] ?? '').trim() })
    return o
  })
}

// ── Normalisation ─────────────────────────────────────────────────────────────
export function toISODate(raw) {
  const s = (raw || '').trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  const d = new Date(s)
  return isNaN(d) ? s : d.toISOString().slice(0, 10)
}

const num  = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? null : n }
const bool = v => ['true', 'yes', '1'].includes(String(v ?? '').trim().toLowerCase())
const pipe = v => (v || '').split('|').map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'none')
const isTldv = id => /^[0-9a-f]{24}$/i.test(id || '')

export function recordingLink(id) {
  return isTldv(id) ? `https://tldv.io/app/meetings/${id}` : null
}

function normaliseCall(r, idx) {
  const id = r['Meeting ID'] || `row-${idx}`
  const callType = /meet/i.test(r['Call Type'] || '') ? 'Meeting' : 'Phone Call'
  return {
    id,
    rowIdx: idx,
    date: toISODate(r['Date']),
    time: r['Time'] || '',
    employee: r['Employee'] || 'Unknown',
    customer: r['Customer'] || 'Unknown',
    category: r['Category'] || '',
    callType,
    duration: num(r['Duration (min)']) ?? 0,
    verdict: r['Final Verdict'] || '',
    sentiment: r['Customer Sentiment'] || '',
    score: num(r['Overall Score']),
    scores: {
      communication:      num(r['Communication Score']),
      professionalism:    num(r['Professionalism Score']),
      productKnowledge:   num(r['Product Knowledge Score']),
      customerExperience: num(r['Customer Experience Score']),
    },
    highlights:   r['Positive Highlights'] || '',
    improvements: r['Areas for Improvement'] || '',
    redFlags:     /^none$/i.test(r['Red Flags'] || '') ? '' : (r['Red Flags'] || ''),
    tags:         (r['Behavior Tags'] || '').split(',').map(s => s.trim()).filter(Boolean),
    coaching:     r['Coaching Recommendations'] || '',
    status:       r['Status'] || '',
    actionItems:  pipe(r['Action Items']),
    followUpOwner: r['Follow-up Owner'] || '',
    deadline:     r['Promised Deadline'] || '',
    risk:         r['Client Risk Level'] || '',
    summary:      r['Summary'] || '',
    frustrated:   bool(r['Frustrated Flag']),
    coachingFlag: bool(r['Coaching Flag']),
    link: recordingLink(id),
  }
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } })
  if (!res.ok) throw new Error(`fetch ${res.status} for ${url.slice(0, 60)}…`)
  const text = await res.text()
  if (text.trimStart().startsWith('<')) throw new Error('Sheet returned HTML — is it still published / shared?')
  return text
}

export async function loadData() {
  if (cache.calls && Date.now() - cache.at < CACHE_TTL_MS) return cache
  if (cache.promise) return cache.promise
  cache.promise = (async () => {
    const [qcText, trText] = await Promise.all([fetchText(QC_CSV_URL), fetchText(TRANSCRIPT_CSV_URL).catch(() => '')])
    const calls = toObjects(parseCsv(qcText)).map(normaliseCall).filter(c => c.date)
    const transcripts = new Map()
    if (trText) {
      for (const r of toObjects(parseCsv(trText))) {
        const id = r['Meeting ID']
        if (id && r['Full Transcript']) transcripts.set(id, { title: r['Meeting Title'] || '', timestamp: r['Timestamp'] || '', text: r['Full Transcript'] })
      }
    }
    cache = { at: Date.now(), calls, transcripts, promise: null }
    return cache
  })()
  try { return await cache.promise } catch (err) { cache.promise = null; throw err }
}

// ── Filtering ─────────────────────────────────────────────────────────────────
const lc = s => (s || '').toLowerCase()
const includes = (hay, needle) => !needle || lc(hay).includes(lc(needle))

export function applyFilters(calls, f = {}) {
  let r = calls
  if (f.date_from) r = r.filter(c => c.date >= f.date_from)
  if (f.date_to)   r = r.filter(c => c.date <= f.date_to)
  if (f.employee)  r = r.filter(c => includes(c.employee, f.employee))
  if (f.employees?.length) { const set = f.employees.map(lc); r = r.filter(c => set.some(e => lc(c.employee).includes(e))) }
  if (f.customer)  r = r.filter(c => includes(c.customer, f.customer))
  if (f.category)  r = r.filter(c => includes(c.category, f.category))
  if (f.call_type && f.call_type !== 'all') r = r.filter(c => lc(c.callType).startsWith(lc(f.call_type).slice(0, 4)))
  if (f.status)    r = r.filter(c => includes(c.status, f.status))
  if (f.risk)      r = r.filter(c => includes(c.risk, f.risk))
  if (f.verdict)   r = r.filter(c => includes(c.verdict, f.verdict))
  if (f.sentiment) r = r.filter(c => includes(c.sentiment, f.sentiment))
  if (f.frustrated === true)  r = r.filter(c => c.frustrated)
  if (f.frustrated === false) r = r.filter(c => !c.frustrated)
  if (f.coaching_flag === true) r = r.filter(c => c.coachingFlag)
  if (f.min_score != null) r = r.filter(c => c.score != null && c.score >= f.min_score)
  if (f.max_score != null) r = r.filter(c => c.score != null && c.score <= f.max_score)
  if (f.keyword) {
    const q = lc(f.keyword)
    r = r.filter(c => [c.summary, c.actionItems.join(' '), c.highlights, c.improvements, c.redFlags, c.coaching, c.tags.join(' '), c.customer].some(v => lc(v).includes(q)))
  }
  return r
}

function previousPeriod(f) {
  if (!f.date_from || !f.date_to) return null
  const from = new Date(f.date_from), to = new Date(f.date_to)
  const days = Math.max(1, Math.round((to - from) / 86400000) + 1)
  const pTo = new Date(from.getTime() - 86400000)
  const pFrom = new Date(pTo.getTime() - (days - 1) * 86400000)
  return { date_from: pFrom.toISOString().slice(0, 10), date_to: pTo.toISOString().slice(0, 10) }
}

const round1 = n => Math.round(n * 10) / 10
function stats(calls) {
  const scored = calls.filter(c => c.score != null)
  return {
    calls: calls.length,
    minutes: Math.round(calls.reduce((s, c) => s + (c.duration || 0), 0)),
    avg_score: scored.length ? round1(scored.reduce((s, c) => s + c.score, 0) / scored.length) : null,
    frustrated: calls.filter(c => c.frustrated).length,
    action_required: calls.filter(c => /action/i.test(c.status)).length,
    high_risk: calls.filter(c => /high/i.test(c.risk)).length,
  }
}

const cite = c => ({
  id: c.id, date: c.date, time: c.time, employee: c.employee, customer: c.customer,
  type: c.callType, category: c.category, minutes: c.duration, link: c.link,
})

// ── Tool executors ────────────────────────────────────────────────────────────
export function execSearchCalls(input, calls) {
  const matched = applyFilters(calls, input).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
  const limit = Math.min(input.limit || 25, 60)
  return {
    totals: stats(matched),
    showing: Math.min(limit, matched.length),
    calls: matched.slice(0, limit).map(c => ({
      ...cite(c),
      score: c.score, verdict: c.verdict, sentiment: c.sentiment, risk: c.risk, status: c.status,
      frustrated: c.frustrated, summary: c.summary.slice(0, 320),
      action_items: c.actionItems.slice(0, 6), follow_up_owner: c.followUpOwner || null, promised_deadline: c.deadline || null,
      red_flags: c.redFlags ? c.redFlags.slice(0, 200) : null,
    })),
    note: 'Citation format: [Employee → Customer · date · N min](link) — use the Call ID when link is null.',
  }
}

export function execCallDetail(input, calls, transcripts) {
  const c = calls.find(x => x.id === input.id) || calls.find(x => x.id.includes(input.id))
  if (!c) return { error: `No call with id "${input.id}"` }
  const t = transcripts.get(c.id)
  const offset = Math.max(0, input.transcript_offset || 0)
  const chars  = Math.min(input.transcript_chars || 12000, 20000)
  const text   = t?.text || ''
  return {
    ...cite(c),
    analysis: {
      score: c.score, scores: c.scores, verdict: c.verdict, sentiment: c.sentiment, risk: c.risk, status: c.status,
      frustrated: c.frustrated, coaching_flag: c.coachingFlag, tags: c.tags,
      summary: c.summary, highlights: c.highlights, improvements: c.improvements, red_flags: c.redFlags || null,
      coaching: c.coaching, action_items: c.actionItems, follow_up_owner: c.followUpOwner || null, promised_deadline: c.deadline || null,
    },
    transcript: text ? text.slice(offset, offset + chars) : null,
    transcript_total_chars: text.length,
    transcript_next_offset: text.length > offset + chars ? offset + chars : null,
    transcript_note: text ? 'Lines are "[Speaker]: text". Quote short lines verbatim as evidence; what is SAID here vs what you INFER must be labelled.' : 'No transcript stored for this call — rely on the analysis fields and say so.',
  }
}

export function execAggregate(input, calls) {
  const matched = applyFilters(calls, input)
  const gb = input.group_by || 'employee'
  const keyOf = c => {
    switch (gb) {
      case 'customer':  return c.customer
      case 'category':  return c.category || '(none)'
      case 'call_type': return c.callType
      case 'verdict':   return c.verdict || '(none)'
      case 'sentiment': return c.sentiment || '(none)'
      case 'risk':      return c.risk || '(none)'
      case 'status':    return c.status || '(none)'
      case 'day':       return c.date
      case 'week':      { const d = new Date(c.date); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - day + 1); return d.toISOString().slice(0, 10) }
      default:          return c.employee
    }
  }
  const groups = {}
  for (const c of matched) (groups[keyOf(c)] ||= []).push(c)
  let rows = Object.entries(groups).map(([key, list]) => ({ [gb]: key, ...stats(list) }))
  rows.sort((a, b) => (gb === 'day' || gb === 'week') ? a[gb].localeCompare(b[gb]) : b.calls - a.calls)
  rows = rows.slice(0, Math.min(input.limit || 40, 100))

  const out = { group_by: gb, totals: stats(matched), groups: rows }
  const prev = previousPeriod(input)
  if (prev) {
    const prevStats = stats(applyFilters(calls, { ...input, ...prev }))
    out.previous_period = { ...prev, ...prevStats }
    out.change_vs_previous = {
      calls: prevStats.calls ? `${Math.round(((out.totals.calls - prevStats.calls) / prevStats.calls) * 100)}%` : 'n/a',
      frustrated: out.totals.frustrated - prevStats.frustrated,
      avg_score: out.totals.avg_score != null && prevStats.avg_score != null ? round1(out.totals.avg_score - prevStats.avg_score) : null,
    }
  }
  return out
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function execSearchTranscripts(input, calls, transcripts) {
  const terms = (input.terms?.length ? input.terms : [input.query]).filter(Boolean)
  if (!terms.length) return { error: 'Provide query or terms' }
  const re = new RegExp(terms.map(esc).join('|'), 'gi')
  const scope = applyFilters(calls, input)
  const snippetChars = Math.min(input.snippet_chars || 220, 400)
  const maxCalls = Math.min(input.max_calls || 40, 80)

  const hits = []
  let totalMentions = 0
  for (const c of scope) {
    const text = transcripts.get(c.id)?.text
    const haystack = text || [c.summary, c.actionItems.join(' '), c.improvements, c.redFlags].join(' ')
    const matches = [...haystack.matchAll(re)]
    if (!matches.length) continue
    totalMentions += matches.length
    const snippets = []
    for (const m of matches.slice(0, 3)) {
      const start = Math.max(0, m.index - Math.floor(snippetChars / 2))
      snippets.push((start ? '…' : '') + haystack.slice(start, start + snippetChars).replace(/\s+/g, ' ') + '…')
    }
    hits.push({ ...cite(c), mentions: matches.length, source: text ? 'transcript' : 'analysis', snippets })
  }
  hits.sort((a, b) => b.mentions - a.mentions || b.date.localeCompare(a.date))

  const byEmployee = {}, byWeek = {}
  for (const h of hits) {
    byEmployee[h.employee] = (byEmployee[h.employee] || 0) + 1
    const d = new Date(h.date); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - day + 1)
    const wk = d.toISOString().slice(0, 10); byWeek[wk] = (byWeek[wk] || 0) + 1
  }
  const out = {
    terms,
    totals: {
      calls_in_scope: scope.length,
      calls_matched: hits.length,
      share_of_conversations: scope.length ? `${Math.round((hits.length / scope.length) * 100)}%` : 'n/a',
      total_mentions: totalMentions,
      minutes_in_matched_calls: Math.round(hits.reduce((s, h) => s + (h.minutes || 0), 0)),
    },
    by_employee: Object.entries(byEmployee).sort((a, b) => b[1] - a[1]).map(([employee, calls]) => ({ employee, calls })),
    by_week: Object.entries(byWeek).sort().map(([week, calls]) => ({ week, calls })),
    calls: hits.slice(0, maxCalls),
  }
  const prev = previousPeriod(input)
  if (prev) {
    const prevScope = applyFilters(calls, { ...input, ...prev })
    const prevHits = prevScope.filter(c => re.test(transcripts.get(c.id)?.text || c.summary) && (re.lastIndex = 0, true))
    out.previous_period = { ...prev, calls_in_scope: prevScope.length, calls_matched: prevHits.length }
  }
  return out
}

export function execListPeople(input, calls) {
  const scope = applyFilters(calls, input)
  const count = key => Object.entries(scope.reduce((m, c) => { m[c[key]] = (m[c[key]] || 0) + 1; return m }, {}))
    .sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, calls: n }))
  return {
    date_range: { from: scope.reduce((m, c) => m && m < c.date ? m : c.date, null), to: scope.reduce((m, c) => m && m > c.date ? m : c.date, null) },
    employees: count('employee'),
    customers: count('customer').slice(0, Math.min(input.limit || 60, 200)),
    categories: count('category'),
  }
}
