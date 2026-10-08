import { useState, useEffect, useCallback, useRef } from 'react'
import { canonicalEmployee } from '../lib/employeeRoster'

const SHEET_URL  = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9TCj76T9TTEpUxfy26VgDxQt7fpoJiaTJ1n0ITwk477r8_EgC-2tYB7mnoXfVwtw5BxzFvY0uA1gv/pub?output=csv'
const REFRESH_MS = 60_000
const RETRY_MS   = 10_000
const MAX_RETRIES = 3

// ─── CSV parser (handles quoted fields with embedded commas/newlines) ─────────
function parseCSV(text) {
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const fields = []
    let field = '', inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { field += '"'; i++ }
        else if (ch === '"') inQuotes = false
        else field += ch
      } else {
        if (ch === '"')      inQuotes = true
        else if (ch === ',') { fields.push(field); field = '' }
        else                  field += ch
      }
    }
    fields.push(field)
    rows.push(fields)
  }
  return rows
}

// ─── Date parser (handles ISO, serial, M/D/YYYY, etc.) ───────────────────────
const MONTH_MAP = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 }
function toISO(y, m, d) {
  return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}
function parseDate(raw) {
  const s = (raw ?? '').trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{5}$/.test(s)) {
    const n = parseInt(s, 10)
    if (n >= 40000 && n <= 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86_400_000)
      if (!isNaN(d)) return d.toISOString().slice(0, 10)
    }
  }
  let m2 = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (m2) return toISO(m2[1], m2[2], m2[3])
  m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m2) { const [,a,b,y] = m2; return parseInt(a,10) > 12 ? toISO(y,b,a) : toISO(y,a,b) }
  m2 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m2) { const [,a,b,y] = m2; return parseInt(a,10) > 12 ? toISO(y,b,a) : toISO(y,a,b) }
  m2 = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/)
  if (m2) { const mn = MONTH_MAP[m2[1].toLowerCase().slice(0,3)]; if (mn) return toISO(m2[3],mn,m2[2]) }
  m2 = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/)
  if (m2) { const mn = MONTH_MAP[m2[2].toLowerCase().slice(0,3)]; if (mn) return toISO(m2[3],mn,m2[1]) }
  m2 = s.match(/^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})$/)
  if (m2) { const mn = MONTH_MAP[m2[2].toLowerCase().slice(0,3)]; if (mn) return toISO(m2[3],mn,m2[1]) }
  try { const d = new Date(s); if (!isNaN(d.getTime())) return d.toISOString().slice(0,10) } catch {}
  return s
}


// ─── Time parser: handles 24h ("21:58"), 12h+seconds ("9:58:00 PM"),
//     12h no-seconds ("9:58 PM"), decimal fraction-of-day ─────────────────────
function parseTimeMins(t) {
  const s = (t || '').trim()
  if (!s) return 0
  // Decimal fraction of day (Sheets raw number export)
  if (/^\d*\.\d+$/.test(s)) return Math.round(parseFloat(s) * 1440)
  // H:MM or H:MM:SS, with optional trailing AM/PM
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(AM|PM))?$/i)
  if (!m) return 0
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const p = (m[3] || '').toUpperCase()
  if (p === 'PM' && h !== 12) h += 12
  else if (p === 'AM' && h === 12) h = 0
  return h * 60 + min
}

// ─── Field helpers ────────────────────────────────────────────────────────────
function parseScore(raw) {
  const n = parseFloat((raw ?? '').replace(',', '.'))
  return isNaN(n) ? 0 : Math.min(10, Math.max(0, n))
}
function parseBool(raw) {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === 'true' || v === 'yes' || v === '1'
}
function parseDuration(raw) {
  const n = parseFloat((raw ?? '').replace(',', '.'))
  return isNaN(n) ? 0 : Math.max(0, Math.round(n))
}
// Split pipe- or semicolon- or comma-separated tags into array
function splitField(raw) {
  const s = (raw ?? '').trim()
  if (!s) return []
  if (s.includes('|'))  return s.split('|').map(x => x.trim()).filter(Boolean)
  if (s.includes(';'))  return s.split(';').map(x => x.trim()).filter(Boolean)
  // Only split on comma if it looks like a list (multiple items or no sentence punctuation)
  if (s.includes(',') && !s.includes('.')) return s.split(',').map(x => x.trim()).filter(Boolean)
  return [s]
}

// ─── Header → field name map ──────────────────────────────────────────────────
const HEADER_MAP = {
  'employee':                      'employee',
  'date':                          'date',
  'time':                          'time',
  'customer':                      'customer',
  'category':                      'category',
  'duration (min)':                'duration',
  'duration':                      'duration',
  'final verdict':                 'finalVerdict',
  'verdict':                       'finalVerdict',
  'customer sentiment':            'sentiment',
  'sentiment':                     'sentiment',
  'overall score':                 'overallScore',
  'score':                         'overallScore',
  'communication score':           'commScore',
  'communication':                 'commScore',
  'professionalism score':         'profScore',
  'professionalism':               'profScore',
  'product knowledge score':       'prodScore',
  'product knowledge':             'prodScore',
  'customer experience score':     'cxScore',
  'customer experience':           'cxScore',
  'positive highlights':           'posHighlights',
  'highlights':                    'posHighlights',
  'areas for improvement':         'areasForImprovement',
  'improvement':                   'areasForImprovement',
  'red flags':                     'redFlags',
  'behavior tags':                 'behaviorTags',
  'behaviour tags':                'behaviorTags',
  'tags':                          'behaviorTags',
  'coaching recommendations':      'coachingRecs',
  'coaching recommendation':       'coachingRecs',
  'status':                        'status',
  'action items':                  'actionItems',
  'action item':                   'actionItems',
  'follow-up owner':               'followupOwner',
  'followup owner':                'followupOwner',
  'follow up owner':               'followupOwner',
  'promised deadline':             'promisedDeadline',
  'deadline':                      'promisedDeadline',
  'client risk level':             'riskLevel',
  'risk level':                    'riskLevel',
  'risk':                          'riskLevel',
  'summary':                       'summary',
  'call summary':                  'summary',
  'frustrated flag':               'frustratedFlag',
  'frustrated':                    'frustratedFlag',
  'coaching flag':                 'coachingFlag',
  'coaching':                      'coachingFlag',
  'meeting id':                    'meetingId',
  'meetingid':                     'meetingId',
  'id':                            'meetingId',
  'call type':                     'callType',
  'type':                          'callType',
}

// ─── Row mapper ───────────────────────────────────────────────────────────────
function buildRow(header, row, rowIdx) {
  const obj = {}
  header.forEach((h, i) => {
    const key = HEADER_MAP[h.toLowerCase().trim()]
    if (key) obj[key] = (row[i] ?? '').trim()
  })

  // Only current team members are named; former staff / "None" / ambiguous guesses
  // keep their calls in the totals but are not shown as employees.
  const emp = canonicalEmployee(obj.employee) || 'Unattributed'
  const dt  = parseDate(obj.date ?? '')
  if (!dt) return null

  const overallScore   = parseScore(obj.overallScore)
  const frustratedFlag = parseBool(obj.frustratedFlag)
  const rawTime        = (obj.time ?? '').trim()

  // Pre-compute a single sortable number: YYYYMMDD * 1440 + minutes-since-midnight
  const [y, mo, d] = dt.split('-').map(Number)
  const dateNum = (y * 10000 + mo * 100 + d) * 1440
  const _sortTs = dateNum + parseTimeMins(rawTime)

  return {
    _rowIdx:    rowIdx,
    _sortTs,
    employee:   emp,
    date:       dt,
    time:       rawTime,
    customer:   (obj.customer ?? '').trim(),
    category:   (obj.category ?? '').trim() || 'General',
    duration:   parseDuration(obj.duration),
    finalVerdict: (obj.finalVerdict ?? '').trim(),
    sentiment:  (obj.sentiment ?? '').trim(),
    overallScore,
    commScore:  parseScore(obj.commScore),
    profScore:  parseScore(obj.profScore),
    prodScore:  parseScore(obj.prodScore),
    cxScore:    parseScore(obj.cxScore),
    posHighlights:      splitField(obj.posHighlights),
    areasForImprovement: splitField(obj.areasForImprovement),
    redFlags:           splitField(obj.redFlags),
    behaviorTags:       splitField(obj.behaviorTags),
    coachingRecs:       splitField(obj.coachingRecs),
    status:      (obj.status ?? '').trim(),
    actionItems: (obj.actionItems ?? '').trim(),
    followupOwner: (obj.followupOwner ?? '').trim(),
    promisedDeadline: (obj.promisedDeadline ?? '').trim(),
    riskLevel:   (obj.riskLevel ?? '').trim(),
    summary:     (obj.summary ?? '').trim(),
    frustratedFlag,
    coachingFlag: parseBool(obj.coachingFlag),
    meetingId:   (obj.meetingId ?? '').trim() || `row-${rowIdx}`,
    callType:    (() => {
      const raw = (obj.callType ?? '').trim()
      const mid = (obj.meetingId ?? '').trim() || `row-${rowIdx}`
      if (raw === 'Phone Call') return 'Phone Call'
      if (raw === 'Meeting')    return 'Meeting'
      return mid.startsWith('GHL-') ? 'Phone Call' : 'Meeting'
    })(),
    // backward compat aliases
    score:       overallScore,
    frustrated:  frustratedFlag,
    id:          rowIdx,
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useEmployeeHealthSheet() {
  const [calls, setCalls]             = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [retrying, setRetrying]       = useState(false)

  const timerRef      = useRef(null)
  const retryTimerRef = useRef(null)
  const prevCountRef  = useRef(0)
  const fetchRef      = useRef(null)

  fetchRef.current = async function doFetch(attempt) {
    if (attempt === 0) { clearTimeout(retryTimerRef.current); setRetrying(false) }
    setLoading(true)
    try {
      const url = `${SHEET_URL}&_t=${Date.now()}`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`Google Sheets returned HTTP ${res.status}`)
      const text = await res.text()
      if (text.trimStart().startsWith('<!')) {
        const e = new Error('PUBLISH_REQUIRED'); e.publishRequired = true; throw e
      }
      const rows = parseCSV(text)
      if (rows.length < 2) throw new Error('Sheet is empty — add a header row and at least one data row.')
      const header = rows[0]
      const parsed = rows.slice(1).map((row, i) => buildRow(header, row, i)).filter(Boolean)
      if (parsed.length === 0) throw new Error('No valid rows found. Check that Employee and Date columns are filled in.')
      const prev = prevCountRef.current
      if (prev === 0) console.log(`[EH] Initial load: ${parsed.length} rows`)
      else if (parsed.length !== prev) console.log(`[EH] Row count: ${prev} → ${parsed.length}`)
      prevCountRef.current = parsed.length
      setCalls(parsed)
      setError(null)
      setRetrying(false)
      setLastUpdated(new Date())
    } catch (err) {
      const msg = err.publishRequired
        ? 'The Employee Health sheet needs to be published to web: File → Share → Publish to web → CSV → Publish.'
        : err.message || 'Failed to load data from Google Sheets.'
      if (attempt < MAX_RETRIES) {
        setRetrying(true)
        setError(`${msg} — Auto-retrying (${attempt + 1}/${MAX_RETRIES})…`)
        retryTimerRef.current = setTimeout(() => fetchRef.current?.(attempt + 1), RETRY_MS)
      } else {
        setRetrying(false)
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  const refetch = useCallback(() => {
    clearTimeout(retryTimerRef.current)
    clearInterval(timerRef.current)
    fetchRef.current?.(0)
    timerRef.current = setInterval(() => fetchRef.current?.(0), REFRESH_MS)
  }, [])

  useEffect(() => {
    fetchRef.current?.(0)
    timerRef.current = setInterval(() => fetchRef.current?.(0), REFRESH_MS)
    return () => { clearInterval(timerRef.current); clearTimeout(retryTimerRef.current) }
  }, [])

  return { calls, loading, error, lastUpdated, refetch, retrying }
}
