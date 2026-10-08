import { subDays, format } from 'date-fns'

// ─── Date helpers ─────────────────────────────────────────────────────────────
export function todayStr() {
  return format(new Date(), 'yyyy-MM-dd')
}

export function getDateWindow(filter) {
  const today = todayStr()
  if (filter.type === 'all')    return { from: '0000-01-01', to: '9999-12-31' }
  if (filter.type === 'today')  return { from: today, to: today }
  if (filter.type === 'custom') return { from: filter.from || today, to: filter.to || today }
  const days = parseInt(filter.type)
  return { from: format(subDays(new Date(), days), 'yyyy-MM-dd'), to: today }
}

export function applyDateFilter(calls, filter) {
  const { from, to } = getDateWindow(filter)
  return calls.filter(c => c.date >= from && c.date <= to)
}

export function applyAllFilters(calls, { dateFilter, categoryFilter, employeeFilter, searchQuery }) {
  let c = applyDateFilter(calls, dateFilter)
  if (categoryFilter && categoryFilter !== 'all') c = c.filter(x => x.category === categoryFilter)
  if (employeeFilter && employeeFilter !== 'all') c = c.filter(x => x.employee === employeeFilter)
  if (searchQuery) {
    const q = searchQuery.toLowerCase()
    c = c.filter(x =>
      x.employee.toLowerCase().includes(q) ||
      x.customer.toLowerCase().includes(q) ||
      (x.summary || '').toLowerCase().includes(q)
    )
  }
  return c
}

// ─── Meeting / call aggregation ───────────────────────────────────────────────
export function uniqueMeetingIds(calls) {
  return [...new Set(calls.map(c => c.meetingId).filter(Boolean))]
}

export function getCallRows(allCalls, meetingId) {
  return allCalls.filter(c => c.meetingId === meetingId)
}

// ─── Employee aggregation ─────────────────────────────────────────────────────
export function aggregateEmployees(calls) {
  const map = {}
  const sorted = [...calls].sort((a, b) => a.date.localeCompare(b.date))
  for (const call of sorted) {
    if (call.employee === 'Unattributed') continue
    if (!map[call.employee]) {
      map[call.employee] = {
        name: call.employee,
        calls: 0,
        overallTotal: 0, commTotal: 0, profTotal: 0, prodTotal: 0, cxTotal: 0,
        verdictCounts: {},
        coachingFlag: false,
        scores: [],
        behaviorTags: [],
        coachingRecs: [],
        callLog: [],
      }
    }
    const e = map[call.employee]
    e.calls++
    e.overallTotal += call.overallScore
    e.commTotal    += call.commScore
    e.profTotal    += call.profScore
    e.prodTotal    += call.prodKnowScore
    e.cxTotal      += call.cxScore
    if (call.finalVerdict) {
      e.verdictCounts[call.finalVerdict] = (e.verdictCounts[call.finalVerdict] || 0) + 1
    }
    if (call.coachingFlag) e.coachingFlag = true
    e.scores.push({
      date: call.date, overall: call.overallScore,
      comm: call.commScore, prof: call.profScore,
      prod: call.prodKnowScore, cx: call.cxScore,
    })
    call.behaviorTags.forEach(t => e.behaviorTags.push(t))
    if (call.coachingRecs) e.coachingRecs.push(call.coachingRecs)
    e.callLog.push(call)
  }

  return Object.values(map).map(e => {
    const n = e.calls
    const topVerdict = Object.entries(e.verdictCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    return {
      ...e,
      avgOverall: n ? +(e.overallTotal / n).toFixed(1) : 0,
      avgComm:    n ? +(e.commTotal    / n).toFixed(1) : 0,
      avgProf:    n ? +(e.profTotal    / n).toFixed(1) : 0,
      avgProd:    n ? +(e.prodTotal    / n).toFixed(1) : 0,
      avgCX:      n ? +(e.cxTotal      / n).toFixed(1) : 0,
      topVerdict,
      recentScores: e.scores.slice(-6).map(s => s.overall),
    }
  }).sort((a, b) => b.avgOverall - a.avgOverall)
}

// ─── Customer aggregation ─────────────────────────────────────────────────────
export function aggregateCustomers(calls) {
  const map = {}
  const sorted = [...calls].sort((a, b) => a.date.localeCompare(b.date))
  for (const call of sorted) {
    if (!map[call.customer]) {
      map[call.customer] = {
        name: call.customer,
        callRows: [],
        latestDate: '',
        latestSentiment: '',
        riskLevel: '',
        employees: new Set(),
      }
    }
    const c = map[call.customer]
    c.callRows.push(call)
    if (call.date > c.latestDate) {
      c.latestDate      = call.date
      c.latestSentiment = call.sentiment
      c.riskLevel       = call.riskLevel || c.riskLevel
    }
    if (call.employee && call.employee !== 'Unattributed') c.employees.add(call.employee)
  }

  return Object.values(map).map(c => {
    const sentimentHistory = c.callRows
      .map(r => ({ date: r.date, sentiment: r.sentiment, meetingId: r.meetingId }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const openIssues = c.callRows.filter(
      r => r.status && r.status !== 'Resolved'
    )

    const sentimentScore = (s) => {
      const order = { Happy:5, Engaged:4, Interested:3, Uncertain:2, Confused:1, Frustrated:0, Upset:0 }
      return order[s] ?? 2
    }

    const scores = sentimentHistory.map(s => sentimentScore(s.sentiment))
    const trend = scores.length < 2 ? 'stable'
      : scores[scores.length - 1] > scores[0] ? 'improving'
      : scores[scores.length - 1] < scores[0] ? 'declining'
      : 'stable'

    return {
      ...c,
      totalCalls: uniqueMeetingIds(c.callRows).length,
      employees: [...c.employees],
      sentimentHistory,
      openIssues,
      trend,
    }
  })
}

// ─── Score trends over time ───────────────────────────────────────────────────
export function buildScoreTrends(calls, dateFilter) {
  if (!calls.length) return []
  const sorted = [...calls].sort((a, b) => a.date.localeCompare(b.date))
  const days = dateFilter.type === 'all' ? 90 : (parseInt(dateFilter.type) || 30)

  const bucket = (call) => {
    if (days <= 30) return call.date
    const d   = new Date(call.date + 'T12:00:00')
    const dow = d.getDay()
    const ws  = new Date(d)
    ws.setDate(d.getDate() - dow)
    return ws.toISOString().slice(0, 10)
  }

  const bucketMap = {}
  for (const c of sorted) {
    const key = bucket(c)
    if (!bucketMap[key]) bucketMap[key] = []
    bucketMap[key].push(c)
  }

  return Object.entries(bucketMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => {
      const n = rows.length
      const avg = (field) => +(rows.reduce((s, r) => s + r[field], 0) / n).toFixed(1)
      const label = days <= 30
        ? format(new Date(key + 'T12:00:00'), 'MMM d')
        : format(new Date(key + 'T12:00:00'), 'MMM d')
      return {
        date: label,
        overall: avg('overallScore'),
        comm:    avg('commScore'),
        prof:    avg('profScore'),
        prod:    avg('prodKnowScore'),
        cx:      avg('cxScore'),
        count: n,
      }
    })
}

// ─── Behavior tag analysis ────────────────────────────────────────────────────
const NEGATIVE_PATTERNS =
  /interrupt|aggressive|impatient|rude|unclear|confus|poor|miss|late|slow|fail|wrong|error|bad|negative|frustrat|upset|dismiss|ignore|unprofessional|unprepared/i

export function isNegativeTag(tag) {
  return NEGATIVE_PATTERNS.test(tag)
}

export function buildBehaviorInsights(calls) {
  const counts = {}
  for (const call of calls) {
    for (const tag of call.behaviorTags) {
      const t = tag.toLowerCase().trim()
      if (!t) continue
      counts[t] = (counts[t] || 0) + 1
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count, negative: isNegativeTag(tag) }))
}

// ─── Deadline helpers ─────────────────────────────────────────────────────────
export function parseDeadline(raw) {
  if (!raw || !raw.trim()) return null
  // Try MM/DD/YYYY first
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const d = new Date(`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}T23:59:59`)
    if (!isNaN(d)) return d
  }
  try {
    const d = new Date(raw)
    if (!isNaN(d.getTime())) return d
  } catch {}
  return null
}

export function isOverdue(deadline) {
  const d = parseDeadline(deadline)
  if (!d) return false
  return d < new Date()
}

// ─── Color maps ───────────────────────────────────────────────────────────────
export const VERDICT_COLORS = {
  'Excellent':          '#8CC63F',
  'Good':               '#4A9AF5',
  'Needs Coaching':     '#EAB308',
  'Immediate Attention':'#EF4444',
}

export const VERDICT_BG = {
  'Excellent':          'bg-green-100 text-green-700',
  'Good':               'bg-blue-100 text-blue-700',
  'Needs Coaching':     'bg-yellow-100 text-yellow-700',
  'Immediate Attention':'bg-red-100 text-red-700',
}

export const SENTIMENT_BG = {
  'Happy':      'bg-green-100 text-green-700',
  'Engaged':    'bg-blue-100 text-blue-700',
  'Interested': 'bg-indigo-100 text-indigo-700',
  'Uncertain':  'bg-yellow-100 text-yellow-700',
  'Confused':   'bg-orange-100 text-orange-700',
  'Frustrated': 'bg-red-100 text-red-700',
  'Upset':      'bg-red-200 text-red-800',
}

export const RISK_BG = {
  'Low':    'bg-green-100 text-green-700',
  'Medium': 'bg-yellow-100 text-yellow-700',
  'High':   'bg-red-100 text-red-700',
}

export const STATUS_BG = {
  'Resolved':        'bg-green-100 text-green-700',
  'Pending':         'bg-yellow-100 text-yellow-700',
  'Escalated':       'bg-red-100 text-red-700',
  'Action Required': 'bg-red-100 text-red-700',
}

// ─── Score color (green→yellow→red on 1-10 scale) ────────────────────────────
export function scoreColor(score) {
  if (score >= 8) return '#8CC63F'
  if (score >= 6) return '#EAB308'
  return '#EF4444'
}

export function scoreBg(score) {
  if (score >= 8) return 'bg-green-100 text-green-700'
  if (score >= 6) return 'bg-yellow-100 text-yellow-700'
  return 'bg-red-100 text-red-700'
}
