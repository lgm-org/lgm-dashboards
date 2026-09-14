// POST /api/jarvis-chat
// Jarvis AI analyst — Claude Sonnet with tool-use over all LGM data sources.
// Streams NDJSON: {"type":"tool_start","label":"..."} ... {"type":"done","content":"..."}

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const MODEL         = 'claude-sonnet-4-6'
const MAX_TOKENS    = 2048
const MAX_ROUNDS    = 6

const TOOL_LABELS = {
  search_accounts:          'Searching accounts…',
  get_account_details:      'Looking up account details…',
  get_churn_analysis:       'Analyzing churn data…',
  get_mrr_breakdown:        'Calculating MRR breakdown…',
  get_upsell_pipeline:      'Scanning upsell pipeline…',
  get_support_tickets:      'Fetching support tickets…',
  get_geographic_breakdown: 'Mapping geographic data…',
  get_call_intelligence:    'Analyzing call records…',
}

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'search_accounts',
    description: 'Search and filter all GHL sub-accounts. Use this for any question about groups of accounts.',
    input_schema: {
      type: 'object',
      properties: {
        band:             { type: 'string', enum: ['at_risk','watch','healthy','all'] },
        type:             { type: 'string', enum: ['DM','Agent','all'] },
        cancelled:        { type: 'boolean' },
        scheduled_cancel: { type: 'boolean' },
        min_mrr:          { type: 'number' },
        max_mrr:          { type: 'number' },
        min_score:        { type: 'number' },
        max_score:        { type: 'number' },
        state:            { type: 'string', description: 'US state code e.g. TX' },
        name_contains:    { type: 'string' },
        sort_by:          { type: 'string', enum: ['score_asc','score_desc','mrr_desc','mrr_asc','name','cancel_date','start_date'] },
        limit:            { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_account_details',
    description: 'Get full details for one specific account by name.',
    input_schema: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    },
  },
  {
    name: 'get_churn_analysis',
    description: 'Get cohort churn rates (30/60/90-day), monthly logo churn data, and the scheduled-cancellation pipeline.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_mrr_breakdown',
    description: 'Get MRR totals and distribution grouped by health band, account type, US state, or top/bottom 10.',
    input_schema: {
      type: 'object',
      properties: { group_by: { type: 'string', enum: ['band','type','state','top10','bottom10'] } },
    },
  },
  {
    name: 'get_upsell_pipeline',
    description: 'Get accounts ready for upsell, ranked by estimated additional monthly revenue.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
  },
  {
    name: 'get_support_tickets',
    description: 'Get open and pending Freshdesk support tickets.',
    input_schema: {
      type: 'object',
      properties: {
        priority: { type: 'string', enum: ['urgent','high','all'] },
        limit:    { type: 'number' },
      },
    },
  },
  {
    name: 'get_geographic_breakdown',
    description: 'Get account count and MRR broken down by US state.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_call_intelligence',
    description: 'Analyze call records from the AI Team Assistant. Use for questions about call quality, frustrated calls, employee performance, call volume, or support trends across accounts.',
    input_schema: {
      type: 'object',
      properties: {
        analysis_type: {
          type: 'string',
          enum: ['most_frustrated','worst_scores','most_calls','by_employee','by_category','account_calls'],
          description: 'most_frustrated=accounts with most frustrated calls, worst_scores=lowest avg call scores, most_calls=highest call volume, by_employee=calls grouped by employee, by_category=calls by category, account_calls=recent calls for a specific account',
        },
        account_name: { type: 'string', description: 'For account_calls: name of the account to look up' },
        employee:     { type: 'string', description: 'Filter results by employee name' },
        limit:        { type: 'number', description: 'Max results (default 15)' },
      },
    },
  },
]

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystem(summary, today) {
  const $ = n => n != null ? '$' + Math.round(n).toLocaleString() : 'N/A'
  const p = n => n != null ? n.toFixed(1) + '%' : 'N/A'
  const s = summary || {}

  return `You are Jarvis — the internal AI analyst for Little Giant Marketing (LGM).
LGM is a GoHighLevel (GHL) reseller providing SaaS sub-accounts to insurance agents and direct-managed (DM) clients.
Today: ${today}.

LIVE SNAPSHOT:
- ${s.totalAccounts ?? '?'} sub-accounts | ${s.stripeMatched ?? '?'} Stripe-matched
- Total MRR: ${$(s.totalMRR)} | Avg: ${$(s.avgMRR)}/account
- Health: ${s.healthy ?? '?'} healthy · ${s.watch ?? '?'} watch · ${s.atRisk ?? '?'} at-risk
- Types: ${s.dmCount ?? '?'} DM · ${s.agentCount ?? '?'} Agent
- Cohort churn: ${p(s.cohort30)} (30d) · ${p(s.cohort60)} (60d) · ${p(s.cohort90)} (90d)
- Scheduled to cancel: ${s.scheduledCancel ?? '?'} accounts
- Open support tickets: ${s.openTickets != null ? s.openTickets : 'unknown'}

AVAILABLE TOOLS: search_accounts · get_account_details · get_churn_analysis ·
get_mrr_breakdown · get_upsell_pipeline · get_support_tickets · get_geographic_breakdown

DATA FIELD DEFINITIONS — use these exact descriptions, never invent your own:
- "users" = number of GHL user seats recorded in the health sheet for that account. 0 means the sheet shows zero seats — it does NOT mean no one has logged in. Every account has at least one admin user in GHL regardless of this number. If the value is 0 or missing, say "users not recorded in sheet" — never say "no users" or "no one logged in".
- "lastActivity" / "inactive X days" = days since the last GHL CRM action (contact created, opportunity updated, etc.), sourced from the health sheet. This is CRM engagement, not a login timestamp. Say "X days since last CRM activity" not "X days since last login".
- "score" = health score (0–100) calculated from CRM activity, user count, MRR, and tenure.
- "band" = health band: healthy (≥80), watch (50–79), at_risk (<50).
- "mrr" = monthly recurring revenue from Stripe. 0 or missing means not Stripe-matched yet.

RULES:
- Always use tools — never fabricate account names, scores, or MRR numbers.
- Be specific: include real names, numbers, and figures from tool results.
- Be direct and actionable. Prioritize insights over raw data dumps.
- End with a clear recommendation when relevant.

FORMATTING — CRITICAL:
- NEVER use # or ## or ### headers. Never.
- Write in plain conversational paragraphs.
- You MAY use **bold** sparingly for key names or numbers.
- You MAY use bullet lists (- item) for multiple items.
- Use line breaks between sections.
- Keep responses focused. No fluff, no filler phrases.

CHARTS — You CAN render real visual charts inside the chat. After your text, output:
\`\`\`chart
{"type":"bar","title":"Title","xKey":"name","yKey":"value","color":"#8CC63F","data":[{"name":"ABC Agency","value":5}],"note":"Optional footnote"}
\`\`\`
- type: "bar" (horizontal, best for account/category comparisons), "bar"+"direction":"vertical" (for vertical bars), "line" (trends over time), "pie" (proportions — use "nameKey" and "valueKey" instead of xKey/yKey)
- Keep data to ≤15 items. Colors: "#8CC63F" green, "#EF4444" red, "#EAB308" amber, "#FF6112" orange, "#3B82F6" blue
- Only output a chart when it genuinely helps — not on every response

CSV DOWNLOADS — You CAN provide downloadable CSV files:
\`\`\`csv-download
{"filename":"report.csv","content":"Account,Band,Score,MRR\\nABC Agency,at_risk,32,299\\n..."}
\`\`\`
- Use \\n for newlines inside the JSON string. Always include a header row.
- Offer CSV downloads when the user asks for a report, export, or list they'd want in a spreadsheet.`
}

// ── Tool executors ────────────────────────────────────────────────────────────
function execSearch(input, accounts) {
  let r = [...accounts]
  if (input.band && input.band !== 'all')    r = r.filter(a => a.band === input.band)
  if (input.type && input.type !== 'all')    r = r.filter(a => a.type === input.type)
  if (input.cancelled === true)              r = r.filter(a => !!a.cancel)
  if (input.cancelled === false)             r = r.filter(a => !a.cancel)
  if (input.scheduled_cancel === true)       r = r.filter(a => !!a.pending)
  if (input.min_mrr  != null) r = r.filter(a => (a.mrr  || 0) >= input.min_mrr)
  if (input.max_mrr  != null) r = r.filter(a => (a.mrr  || 0) <= input.max_mrr)
  if (input.min_score != null) r = r.filter(a => (a.score || 0) >= input.min_score)
  if (input.max_score != null) r = r.filter(a => (a.score || 0) <= input.max_score)
  if (input.state) r = r.filter(a => (a.state || '').toUpperCase() === input.state.toUpperCase())
  if (input.name_contains) { const q = input.name_contains.toLowerCase(); r = r.filter(a => (a.name || '').toLowerCase().includes(q)) }

  const sort = input.sort_by || 'score_asc'
  if      (sort === 'score_asc')   r.sort((a, b) => (a.score || 0) - (b.score || 0))
  else if (sort === 'score_desc')  r.sort((a, b) => (b.score || 0) - (a.score || 0))
  else if (sort === 'mrr_desc')    r.sort((a, b) => (b.mrr   || 0) - (a.mrr   || 0))
  else if (sort === 'mrr_asc')     r.sort((a, b) => (a.mrr   || 0) - (b.mrr   || 0))
  else if (sort === 'name')        r.sort((a, b) => (a.name  || '').localeCompare(b.name || ''))
  else if (sort === 'cancel_date') r.sort((a, b) => (b.cancel || '').localeCompare(a.cancel || ''))
  else if (sort === 'start_date')  r.sort((a, b) => (b.start  || '').localeCompare(a.start  || ''))

  const total = r.length
  r = r.slice(0, Math.min(input.limit || 20, 50))

  return {
    total_matched: total,
    showing: r.length,
    accounts: r.map(a => ({
      name: a.name, type: a.type, band: a.band, score: a.score,
      mrr: a.mrr ? `$${a.mrr}/mo` : '(unmatched)',
      users: a.users, txns_per_month: a.txns ? a.txns.toLocaleString() : '—',
      state: a.state || '—', started: a.start || '—',
      cancelled: a.cancel || null, scheduled_cancel: a.pending || false,
      last_active_days: a.lastActive,
      upsell_addon: a.addon || null, upsell_est_extra: a.estExtra ? `+$${a.estExtra}/mo` : null,
      recommended_action: a.action || null,
    })),
  }
}

function execDetails(input, accounts) {
  const q = (input.name || '').toLowerCase()
  const matches = accounts.filter(a => (a.name || '').toLowerCase().includes(q))
  if (!matches.length) return { error: `No account found matching "${input.name}"` }
  const a = matches.find(a => a.name.toLowerCase() === q) || matches[0]
  return {
    name: a.name, ghl_id: a.id, type: a.type, health_band: a.band, health_score: a.score,
    mrr: a.mrr ? `$${a.mrr}/mo` : '(no Stripe record)',
    users: a.users, monthly_txns: a.txns ? a.txns.toLocaleString() : '—',
    state: a.state || '—', email: a.email || '—', started: a.start || '—',
    last_active_days: a.lastActive, cancelled: a.cancel || null, pending_cancel: a.pending || false,
    upsell_ready: !!a.addon, upsell_addon: a.addon || null,
    upsell_est_extra: a.estExtra ? `+$${a.estExtra}/mo` : null,
    recommended_action: a.action || null,
    open_in_ghl: `https://app.littlegiantmarketing.com/v2/location/${a.id}/dashboard`,
    other_matches: matches.length > 1 ? matches.slice(1, 4).map(m => m.name) : null,
  }
}

function execChurn(data) {
  const s = data.summary || {}
  const result = {
    cohort_churn: {
      note: 'Accounts who signed up in the window and later cancelled',
      '30_day': s.cohort30 != null ? s.cohort30.toFixed(1) + '%' : 'N/A',
      '60_day': s.cohort60 != null ? s.cohort60.toFixed(1) + '%' : 'N/A',
      '90_day': s.cohort90 != null ? s.cohort90.toFixed(1) + '%' : 'N/A',
    },
    scheduled_to_cancel: s.scheduledCancel ?? 0,
  }
  const lc = data.logoChurn?.summary
  if (lc) {
    result.monthly_logo_churn = {
      last_complete_month: lc.lastCompleteMonth,
      last_month_rate: lc.lastMonthRate != null ? lc.lastMonthRate.toFixed(1) + '%' : 'N/A',
      last_month_cancels: lc.lastMonthCancels, last_month_active: lc.lastMonthActive,
      six_month_avg: lc.avg6mRate != null ? lc.avg6mRate.toFixed(1) + '%' : 'N/A',
      all_time_cancels: lc.totalCancels, current_pending: lc.currentPending,
    }
    if (data.logoChurn?.months) {
      result.monthly_logo_churn.recent_6_months = data.logoChurn.months
        .filter(m => m.activeStart > 0).slice(-6)
        .map(m => ({ month: m.month, active: m.activeStart, cancels: m.cancelsConfirmed, rate: m.churnRateConfirmed.toFixed(1) + '%' }))
    }
  }
  return result
}

function execMrr(input, accounts) {
  const gb    = input.group_by || 'band'
  const active = accounts.filter(a => !a.cancel && (a.mrr || 0) > 0)
  const total  = active.reduce((s, a) => s + a.mrr, 0)
  const ts     = '$' + Math.round(total).toLocaleString()

  if (gb === 'band' || gb === 'type') {
    const key = gb === 'band' ? 'band' : 'type'
    const g = {}
    for (const a of active) {
      const k = a[key] || 'Unknown'
      if (!g[k]) g[k] = { count: 0, mrr: 0 }
      g[k].count++; g[k].mrr += a.mrr
    }
    return { total_active_mrr: ts, [`by_${gb}`]: Object.entries(g).map(([k, v]) => ({
      [key]: k, accounts: v.count, mrr: '$' + Math.round(v.mrr).toLocaleString(),
      pct: ((v.mrr / total) * 100).toFixed(1) + '%',
      ...(gb === 'type' ? { avg: '$' + Math.round(v.mrr / v.count) } : {}),
    })) }
  }
  if (gb === 'top10' || gb === 'bottom10') {
    const sorted = [...active].sort((a, b) => gb === 'top10' ? b.mrr - a.mrr : a.mrr - b.mrr)
    return { total_active_mrr: ts, accounts: sorted.slice(0, 10).map(a => ({ name: a.name, mrr: '$' + a.mrr + '/mo', type: a.type, band: a.band })) }
  }
  if (gb === 'state') {
    const g = {}
    for (const a of active) { const k = a.state || 'Unknown'; if (!g[k]) g[k] = { count: 0, mrr: 0 }; g[k].count++; g[k].mrr += a.mrr }
    return { total_active_mrr: ts, by_state: Object.entries(g).sort((a, b) => b[1].mrr - a[1].mrr).map(([st, v]) => ({ state: st, accounts: v.count, mrr: '$' + Math.round(v.mrr).toLocaleString() })) }
  }
  return { total_active_mrr: ts, total_active_accounts: active.length }
}

function execUpsell(input, accounts) {
  const ready = accounts.filter(a => !!a.addon && !a.cancel).sort((a, b) => (b.estExtra || 0) - (a.estExtra || 0)).slice(0, input.limit || 15)
  return {
    total_upsell_ready: ready.length,
    est_incremental_mrr: '$' + Math.round(ready.reduce((s, a) => s + (a.estExtra || 0), 0)).toLocaleString() + '/mo',
    accounts: ready.map(a => ({ name: a.name, type: a.type, band: a.band, current_mrr: '$' + (a.mrr || 0) + '/mo', addon: a.addon, est_extra: '+$' + (a.estExtra || 0) + '/mo', score: a.score })),
  }
}

function execTickets(input, tickets) {
  if (!tickets?.length) return { note: 'Freshdesk data not loaded — may not be configured in Vercel env vars.' }
  let r = [...tickets]
  if (input.priority === 'urgent') r = r.filter(t => t.priority >= 4)
  else if (input.priority === 'high') r = r.filter(t => t.priority >= 3)
  const PLAB = { 1: 'low', 2: 'medium', 3: 'high', 4: 'urgent' }
  const SLAB = { 2: 'open', 3: 'pending' }
  return {
    total_matching: r.length,
    tickets: r.slice(0, input.limit || 20).map(t => ({ id: t.id, subject: t.subject, account: t.accountName, status: SLAB[t.status] || t.status, priority: PLAB[t.priority] || t.priority, created: t.created_at?.slice(0, 10) })),
  }
}

function execCallIntelligence(input, accounts) {
  const withCalls = accounts.filter(a => a.calls && a.calls.total > 0)
  if (!withCalls.length) return { note: 'No call data matched to accounts. Call Intelligence sheet may not have matching customer names.' }

  const type  = input.analysis_type || 'most_calls'
  const limit = input.limit || 15

  if (type === 'account_calls') {
    const q = (input.account_name || '').toLowerCase()
    const match = accounts.find(a => (a.name || '').toLowerCase().includes(q))
    if (!match) return { error: `No account found matching "${input.account_name}"` }
    if (!match.calls) return { note: `No call records matched to ${match.name}` }
    return {
      account: match.name, type: match.type, band: match.band,
      total_calls: match.calls.total,
      avg_score:   match.calls.avgScore,
      frustrated_calls: match.calls.frustrated,
      risk_level:  match.calls.riskLevel,
      categories:  match.calls.categories,
      recent_calls: match.calls.recent,
    }
  }

  if (type === 'most_frustrated') {
    return {
      accounts: [...withCalls]
        .filter(a => a.calls.frustrated > 0)
        .sort((a, b) => b.calls.frustrated - a.calls.frustrated)
        .slice(0, limit)
        .map(a => ({ name: a.name, type: a.type, band: a.band, frustrated_calls: a.calls.frustrated, total_calls: a.calls.total, last_call: a.calls.lastDate, last_employee: a.calls.lastEmployee })),
    }
  }

  if (type === 'worst_scores') {
    return {
      accounts: [...withCalls]
        .filter(a => a.calls.avgScore > 0)
        .sort((a, b) => a.calls.avgScore - b.calls.avgScore)
        .slice(0, limit)
        .map(a => ({ name: a.name, type: a.type, band: a.band, avg_score: a.calls.avgScore, total_calls: a.calls.total, risk_level: a.calls.riskLevel })),
    }
  }

  if (type === 'most_calls') {
    return {
      accounts: [...withCalls]
        .sort((a, b) => b.calls.total - a.calls.total)
        .slice(0, limit)
        .map(a => ({ name: a.name, type: a.type, band: a.band, total_calls: a.calls.total, avg_score: a.calls.avgScore, frustrated: a.calls.frustrated, last_call: a.calls.lastDate })),
    }
  }

  if (type === 'by_employee') {
    const empMap = {}
    for (const a of withCalls) {
      const emp = a.calls.lastEmployee || 'Unknown'
      if (!empMap[emp]) empMap[emp] = { calls: 0, accounts: 0, frustrated: 0, scores: [] }
      empMap[emp].calls      += a.calls.total
      empMap[emp].accounts   += 1
      empMap[emp].frustrated += a.calls.frustrated
      if (a.calls.avgScore > 0) empMap[emp].scores.push(a.calls.avgScore)
    }
    const empFilter = (input.employee || '').toLowerCase()
    return {
      by_employee: Object.entries(empMap)
        .filter(([emp]) => !empFilter || emp.toLowerCase().includes(empFilter))
        .sort((a, b) => b[1].calls - a[1].calls)
        .slice(0, limit)
        .map(([emp, v]) => ({
          employee: emp, total_calls: v.calls, accounts_served: v.accounts,
          frustrated_calls: v.frustrated,
          avg_score: v.scores.length ? Math.round(v.scores.reduce((s, n) => s + n, 0) / v.scores.length * 10) / 10 : null,
        })),
    }
  }

  if (type === 'by_category') {
    const catMap = {}
    for (const a of withCalls) {
      for (const [cat, cnt] of Object.entries(a.calls.categories || {})) {
        catMap[cat] = (catMap[cat] || 0) + cnt
      }
    }
    return {
      by_category: Object.entries(catMap)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, cnt]) => ({ category: cat, total_calls: cnt })),
    }
  }

  return { error: `Unknown analysis_type: ${type}` }
}

function execGeo(accounts) {
  const g = {}
  for (const a of accounts.filter(a => !a.cancel)) {
    const k = a.state || 'Unknown'
    if (!g[k]) g[k] = { count: 0, mrr: 0, atRisk: 0 }
    g[k].count++; g[k].mrr += a.mrr || 0
    if (a.band === 'at_risk') g[k].atRisk++
  }
  return { by_state: Object.entries(g).sort((a, b) => b[1].count - a[1].count).map(([st, v]) => ({ state: st, accounts: v.count, mrr: '$' + Math.round(v.mrr).toLocaleString(), at_risk: v.atRisk })) }
}

function executeTool(name, input, data) {
  const { accounts = [], tickets = [] } = data
  switch (name) {
    case 'search_accounts':          return execSearch(input, accounts)
    case 'get_account_details':      return execDetails(input, accounts)
    case 'get_churn_analysis':       return execChurn(data)
    case 'get_mrr_breakdown':        return execMrr(input, accounts)
    case 'get_upsell_pipeline':      return execUpsell(input, accounts)
    case 'get_support_tickets':      return execTickets(input, tickets)
    case 'get_geographic_breakdown': return execGeo(accounts)
    case 'get_call_intelligence':    return execCallIntelligence(input, accounts)
    default: return { error: `Unknown tool: ${name}` }
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })

  const { messages = [], data = {} } = req.body || {}
  if (!messages.length) return res.status(400).json({ error: 'No messages' })

  // ── Streaming response setup ──
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Transfer-Encoding', 'chunked')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')

  const emit = obj => res.write(JSON.stringify(obj) + '\n')

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const system = buildSystem(data.summary || {}, today)

  let apiMessages = messages.map(m => ({ role: m.role, content: m.content }))

  try {
    let finalText = null
    let rounds    = 0

    while (rounds < MAX_ROUNDS) {
      rounds++

      const resp = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, tools: TOOLS, messages: apiMessages }),
      })

      if (!resp.ok) {
        const body = await resp.text()
        console.error('[jarvis-chat]', body)
        emit({ type: 'error', message: `API error ${resp.status}` })
        return res.end()
      }

      const msg = await resp.json()

      if (msg.stop_reason === 'end_turn') {
        finalText = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
        break
      }

      if (msg.stop_reason === 'tool_use') {
        apiMessages.push({ role: 'assistant', content: msg.content })
        const toolResults = []

        for (const block of msg.content) {
          if (block.type !== 'tool_use') continue
          emit({ type: 'tool_start', tool: block.name, label: TOOL_LABELS[block.name] || block.name })
          let result
          try { result = executeTool(block.name, block.input, data) }
          catch (err) { result = { error: err.message } }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
        }

        apiMessages.push({ role: 'user', content: toolResults })
        continue
      }

      finalText = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
      break
    }

    emit({ type: 'done', content: finalText || 'No response generated.' })
    res.end()
  } catch (err) {
    console.error('[jarvis-chat]', err)
    emit({ type: 'error', message: err.message })
    res.end()
  }
}
