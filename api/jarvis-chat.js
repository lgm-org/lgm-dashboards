// POST /api/jarvis-chat
// Jarvis AI analyst — Claude Sonnet with tool-use over all LGM data sources.
// Tools execute against client-supplied data (accounts, tickets, logo churn).

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const MODEL         = 'claude-sonnet-4-6'
const MAX_TOKENS    = 2048
const MAX_ROUNDS    = 6

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'search_accounts',
    description: 'Search and filter all GHL sub-accounts. Use this for any question about a group of accounts — e.g. "which accounts are at risk", "show DM clients with low scores", "who is scheduled to cancel".',
    input_schema: {
      type: 'object',
      properties: {
        band:             { type: 'string', enum: ['at_risk', 'watch', 'healthy', 'all'], description: 'Health band' },
        type:             { type: 'string', enum: ['DM', 'Agent', 'all'], description: 'Account type' },
        cancelled:        { type: 'boolean', description: 'If true, return only cancelled accounts' },
        scheduled_cancel: { type: 'boolean', description: 'If true, return accounts scheduled to cancel' },
        min_mrr:          { type: 'number',  description: 'Minimum MRR (dollars/mo)' },
        max_mrr:          { type: 'number',  description: 'Maximum MRR (dollars/mo)' },
        min_score:        { type: 'number',  description: 'Minimum health score (0–100)' },
        max_score:        { type: 'number',  description: 'Maximum health score (0–100)' },
        state:            { type: 'string',  description: 'US state code, e.g. TX' },
        name_contains:    { type: 'string',  description: 'Case-insensitive partial name match' },
        sort_by:          { type: 'string',  enum: ['score_asc','score_desc','mrr_desc','mrr_asc','name','cancel_date','start_date'], description: 'Sort order' },
        limit:            { type: 'number',  description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_account_details',
    description: 'Get full details for one specific account by name. Use this whenever the user asks about a specific customer.',
    input_schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Account name (partial match ok)' },
      },
    },
  },
  {
    name: 'get_churn_analysis',
    description: 'Get cohort churn rates (30/60/90-day), logo churn monthly data (Cliff\'s model), and the scheduled-cancellation pipeline.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_mrr_breakdown',
    description: 'Get MRR totals and distribution. Can group by health band, account type, US state, or show top/bottom accounts by revenue.',
    input_schema: {
      type: 'object',
      properties: {
        group_by: { type: 'string', enum: ['band','type','state','top10','bottom10'], description: 'Grouping dimension' },
      },
    },
  },
  {
    name: 'get_upsell_pipeline',
    description: 'Get accounts that are health-qualified for upsell, sorted by estimated additional monthly revenue.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 15)' },
      },
    },
  },
  {
    name: 'get_support_tickets',
    description: 'Get open and pending Freshdesk support tickets. Use this for any question about support, tickets, or customer issues.',
    input_schema: {
      type: 'object',
      properties: {
        priority:  { type: 'string', enum: ['urgent','high','all'], description: 'Priority filter' },
        limit:     { type: 'number', description: 'Max tickets to return (default 20)' },
      },
    },
  },
  {
    name: 'get_geographic_breakdown',
    description: 'Get account count and MRR broken down by US state.',
    input_schema: { type: 'object', properties: {} },
  },
]

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystem(summary, today) {
  const $ = n  => n != null ? '$' + Math.round(n).toLocaleString() : 'N/A'
  const p = n  => n != null ? n.toFixed(1) + '%' : 'N/A'
  const s = summary || {}

  return `You are Jarvis — the internal AI analyst for Little Giant Marketing (LGM).
LGM is a GoHighLevel (GHL) reseller providing SaaS sub-accounts to insurance agents and DM (direct-managed) clients.
Today: ${today}.

LIVE SNAPSHOT:
- ${s.totalAccounts ?? '?'} sub-accounts total | ${s.stripeMatched ?? '?'} Stripe-matched
- MRR: ${$(s.totalMRR)} total | ${$(s.avgMRR)} avg/account
- Health: ${s.healthy ?? '?'} healthy · ${s.watch ?? '?'} watch · ${s.atRisk ?? '?'} at-risk
- Types: ${s.dmCount ?? '?'} DM · ${s.agentCount ?? '?'} Agent
- Cohort churn: ${p(s.cohort30)} (30d) · ${p(s.cohort60)} (60d) · ${p(s.cohort90)} (90d)
- Scheduled to cancel: ${s.scheduledCancel ?? '?'} accounts
- Open support tickets: ${s.openTickets != null ? s.openTickets : 'loading…'}

AVAILABLE TOOLS:
• search_accounts — filter and list accounts by any criteria
• get_account_details — deep-dive on one specific customer
• get_churn_analysis — cohort + logo churn rates + cancellation pipeline
• get_mrr_breakdown — revenue totals and distribution
• get_upsell_pipeline — upsell opportunities ranked by est. extra MRR
• get_support_tickets — Freshdesk open/pending tickets
• get_geographic_breakdown — account distribution by US state

INSTRUCTIONS:
- Always use tools — do not fabricate account names, scores, or numbers.
- For a group of accounts, use search_accounts.
- For one specific customer, use get_account_details.
- For revenue questions, use get_mrr_breakdown.
- For churn questions, use get_churn_analysis.
- For support, use get_support_tickets.
- Be specific: include real names, numbers, and MRR figures from tool results.
- Prioritize what is actionable. End with a recommendation when relevant.
- Keep responses concise unless the user explicitly asks for a full breakdown.`
}

// ── Tool executors ────────────────────────────────────────────────────────────
function execSearchAccounts(input, accounts) {
  let result = [...accounts]

  if (input.band && input.band !== 'all')
    result = result.filter(a => a.band === input.band)
  if (input.type && input.type !== 'all')
    result = result.filter(a => a.type === input.type)
  if (input.cancelled === true)  result = result.filter(a => !!a.cancel)
  if (input.cancelled === false) result = result.filter(a => !a.cancel)
  if (input.scheduled_cancel === true) result = result.filter(a => !!a.pending)
  if (input.min_mrr  != null) result = result.filter(a => (a.mrr  || 0) >= input.min_mrr)
  if (input.max_mrr  != null) result = result.filter(a => (a.mrr  || 0) <= input.max_mrr)
  if (input.min_score != null) result = result.filter(a => (a.score || 0) >= input.min_score)
  if (input.max_score != null) result = result.filter(a => (a.score || 0) <= input.max_score)
  if (input.state) {
    const st = input.state.toUpperCase()
    result = result.filter(a => (a.state || '').toUpperCase() === st)
  }
  if (input.name_contains) {
    const q = input.name_contains.toLowerCase()
    result = result.filter(a => (a.name || '').toLowerCase().includes(q))
  }

  const sort = input.sort_by || 'score_asc'
  if      (sort === 'score_asc')   result.sort((a, b) => (a.score  || 0) - (b.score  || 0))
  else if (sort === 'score_desc')  result.sort((a, b) => (b.score  || 0) - (a.score  || 0))
  else if (sort === 'mrr_desc')    result.sort((a, b) => (b.mrr    || 0) - (a.mrr    || 0))
  else if (sort === 'mrr_asc')     result.sort((a, b) => (a.mrr    || 0) - (b.mrr    || 0))
  else if (sort === 'name')        result.sort((a, b) => (a.name   || '').localeCompare(b.name   || ''))
  else if (sort === 'cancel_date') result.sort((a, b) => (b.cancel || '').localeCompare(a.cancel || ''))
  else if (sort === 'start_date')  result.sort((a, b) => (b.start  || '').localeCompare(a.start  || ''))

  const limit = Math.min(input.limit || 20, 50)
  const total = result.length
  result = result.slice(0, limit)

  return {
    total_matched: total,
    showing: result.length,
    accounts: result.map(a => ({
      name:               a.name,
      type:               a.type,
      band:               a.band,
      score:              a.score,
      mrr:                a.mrr ? `$${a.mrr}/mo` : '(unmatched)',
      users:              a.users,
      txns_per_month:     a.txns ? a.txns.toLocaleString() : '—',
      state:              a.state || '—',
      started:            a.start || '—',
      cancelled:          a.cancel || null,
      scheduled_cancel:   a.pending || false,
      last_active_days:   a.lastActive,
      upsell_addon:       a.addon || null,
      upsell_est_extra:   a.estExtra ? `+$${a.estExtra}/mo` : null,
      recommended_action: a.action || null,
    })),
  }
}

function execGetAccountDetails(input, accounts) {
  const q = (input.name || '').toLowerCase()
  const matches = accounts.filter(a => (a.name || '').toLowerCase().includes(q))
  if (matches.length === 0) return { error: `No account found matching "${input.name}"` }

  const exact = matches.find(a => a.name.toLowerCase() === q)
  const a     = exact || matches[0]

  return {
    name:                  a.name,
    ghl_id:                a.id,
    account_type:          a.type,
    health_band:           a.band,
    health_score:          a.score,
    mrr:                   a.mrr ? `$${a.mrr}/mo` : '(no Stripe record)',
    users:                 a.users,
    monthly_transactions:  a.txns ? a.txns.toLocaleString() : '—',
    state:                 a.state || '—',
    email:                 a.email || '—',
    started:               a.start || '—',
    last_active_days_ago:  a.lastActive,
    cancelled_at:          a.cancel || null,
    scheduled_cancel:      a.pending || false,
    upsell_ready:          !!a.addon,
    upsell_addon:          a.addon || null,
    upsell_est_extra_mrr:  a.estExtra ? `+$${a.estExtra}/mo` : null,
    recommended_action:    a.action || null,
    open_in_ghl:           `https://app.littlegiantmarketing.com/v2/location/${a.id}/dashboard`,
    other_matches:         matches.length > 1 ? matches.slice(1, 4).map(m => m.name) : null,
  }
}

function execChurnAnalysis(data) {
  const { summary = {}, logoChurn } = data
  const result = {
    cohort_churn: {
      description: 'Accounts who signed up in the window and later cancelled',
      '30_day': summary.cohort30 != null ? summary.cohort30.toFixed(1) + '%' : 'N/A',
      '60_day': summary.cohort60 != null ? summary.cohort60.toFixed(1) + '%' : 'N/A',
      '90_day': summary.cohort90 != null ? summary.cohort90.toFixed(1) + '%' : 'N/A',
    },
    scheduled_to_cancel: summary.scheduledCancel ?? 0,
  }

  if (logoChurn?.summary) {
    const lc = logoChurn.summary
    result.logo_churn = {
      description: "Cliff's formula: active SaaS accounts at month-start vs confirmed cancels. 28-day reinstatements excluded.",
      last_complete_month:    lc.lastCompleteMonth,
      last_month_rate:        lc.lastMonthRate    != null ? lc.lastMonthRate.toFixed(1)  + '%' : 'N/A',
      last_month_cancels:     lc.lastMonthCancels,
      last_month_active_start: lc.lastMonthActive,
      six_month_avg_rate:     lc.avg6mRate        != null ? lc.avg6mRate.toFixed(1)     + '%' : 'N/A',
      all_time_total_cancels: lc.totalCancels,
      current_month_pending:  lc.currentPending,
    }
    if (logoChurn.months) {
      result.logo_churn.recent_6_months = logoChurn.months
        .filter(m => m.activeStart > 0)
        .slice(-6)
        .map(m => ({
          month:         m.month,
          active_start:  m.activeStart,
          cancels:       m.cancelsConfirmed,
          reinstated_28d: m.reinstated28d,
          rate:          m.churnRateConfirmed.toFixed(1) + '%',
          pending:       m.cancelsPending,
        }))
    }
  }

  return result
}

function execMrrBreakdown(input, accounts) {
  const groupBy = input.group_by || 'band'
  const active  = accounts.filter(a => !a.cancel && (a.mrr || 0) > 0)
  const total   = active.reduce((s, a) => s + (a.mrr || 0), 0)
  const totalStr = '$' + Math.round(total).toLocaleString()

  if (groupBy === 'band') {
    const groups = {}
    for (const a of active) {
      if (!groups[a.band]) groups[a.band] = { count: 0, mrr: 0 }
      groups[a.band].count++
      groups[a.band].mrr += a.mrr
    }
    return {
      total_active_mrr: totalStr,
      by_band: Object.entries(groups).map(([band, v]) => ({
        band, accounts: v.count,
        mrr:  '$' + Math.round(v.mrr).toLocaleString(),
        pct:  ((v.mrr / total) * 100).toFixed(1) + '%',
      })),
    }
  }
  if (groupBy === 'type') {
    const groups = {}
    for (const a of active) {
      const t = a.type || 'Unknown'
      if (!groups[t]) groups[t] = { count: 0, mrr: 0 }
      groups[t].count++
      groups[t].mrr += a.mrr
    }
    return {
      total_active_mrr: totalStr,
      by_type: Object.entries(groups).map(([type, v]) => ({
        type, accounts: v.count,
        mrr:  '$' + Math.round(v.mrr).toLocaleString(),
        avg:  '$' + Math.round(v.mrr / v.count),
      })),
    }
  }
  if (groupBy === 'top10') {
    return {
      total_active_mrr: totalStr,
      top_10_by_mrr: [...active]
        .sort((a, b) => (b.mrr || 0) - (a.mrr || 0))
        .slice(0, 10)
        .map(a => ({ name: a.name, mrr: '$' + a.mrr + '/mo', type: a.type, band: a.band })),
    }
  }
  if (groupBy === 'bottom10') {
    return {
      total_active_mrr: totalStr,
      bottom_10_by_mrr: [...active]
        .sort((a, b) => (a.mrr || 0) - (b.mrr || 0))
        .slice(0, 10)
        .map(a => ({ name: a.name, mrr: '$' + a.mrr + '/mo', type: a.type, band: a.band })),
    }
  }
  if (groupBy === 'state') {
    const groups = {}
    for (const a of active) {
      const st = a.state || 'Unknown'
      if (!groups[st]) groups[st] = { count: 0, mrr: 0 }
      groups[st].count++
      groups[st].mrr += a.mrr
    }
    return {
      total_active_mrr: totalStr,
      by_state: Object.entries(groups)
        .sort((a, b) => b[1].mrr - a[1].mrr)
        .map(([state, v]) => ({
          state, accounts: v.count,
          mrr: '$' + Math.round(v.mrr).toLocaleString(),
        })),
    }
  }
  return { total_active_mrr: totalStr, total_active_accounts: active.length }
}

function execUpsellPipeline(input, accounts) {
  const ready = accounts
    .filter(a => !!a.addon && !a.cancel)
    .sort((a, b) => (b.estExtra || 0) - (a.estExtra || 0))
    .slice(0, input.limit || 15)

  const estTotal = ready.reduce((s, a) => s + (a.estExtra || 0), 0)

  return {
    total_upsell_ready: ready.length,
    est_incremental_mrr_if_all_close: '$' + Math.round(estTotal).toLocaleString() + '/mo',
    accounts: ready.map(a => ({
      name:               a.name,
      type:               a.type,
      band:               a.band,
      current_mrr:        '$' + (a.mrr || 0) + '/mo',
      recommended_addon:  a.addon,
      est_extra_mrr:      '+$' + (a.estExtra || 0) + '/mo',
      health_score:       a.score,
      users:              a.users,
      txns_per_month:     a.txns ? a.txns.toLocaleString() : '—',
    })),
  }
}

function execSupportTickets(input, tickets) {
  if (!tickets || tickets.length === 0)
    return { note: 'Freshdesk ticket data not loaded in this session. Refresh the Jarvis tab or check that FRESHDESK_DOMAIN / FRESHDESK_API_KEY are set in Vercel.' }

  let result = [...tickets]
  if (input.priority === 'urgent') result = result.filter(t => t.priority >= 4)
  else if (input.priority === 'high') result = result.filter(t => t.priority >= 3)

  const limit = input.limit || 20
  const PRIORITY_LABEL = { 1: 'low', 2: 'medium', 3: 'high', 4: 'urgent' }
  const STATUS_LABEL   = { 2: 'open', 3: 'pending', 4: 'resolved', 5: 'closed' }

  return {
    total_matching: result.length,
    showing: Math.min(result.length, limit),
    tickets: result.slice(0, limit).map(t => ({
      id:       t.id,
      subject:  t.subject,
      account:  t.accountName,
      status:   STATUS_LABEL[t.status]   || t.status,
      priority: PRIORITY_LABEL[t.priority] || t.priority,
      created:  t.created_at?.slice(0, 10),
    })),
  }
}

function execGeographic(accounts) {
  const groups = {}
  for (const a of accounts.filter(a => !a.cancel)) {
    const st = a.state || 'Unknown'
    if (!groups[st]) groups[st] = { count: 0, mrr: 0, atRisk: 0 }
    groups[st].count++
    groups[st].mrr    += a.mrr || 0
    if (a.band === 'at_risk') groups[st].atRisk++
  }
  return {
    by_state: Object.entries(groups)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([state, v]) => ({
        state,
        accounts: v.count,
        mrr:      '$' + Math.round(v.mrr).toLocaleString(),
        at_risk:  v.atRisk,
      })),
  }
}

function executeTool(name, input, data) {
  const { accounts = [], tickets = [] } = data
  switch (name) {
    case 'search_accounts':         return execSearchAccounts(input, accounts)
    case 'get_account_details':     return execGetAccountDetails(input, accounts)
    case 'get_churn_analysis':      return execChurnAnalysis(data)
    case 'get_mrr_breakdown':       return execMrrBreakdown(input, accounts)
    case 'get_upsell_pipeline':     return execUpsellPipeline(input, accounts)
    case 'get_support_tickets':     return execSupportTickets(input, tickets)
    case 'get_geographic_breakdown': return execGeographic(accounts)
    default: return { error: `Unknown tool: ${name}` }
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured in Vercel env vars' })

  const { messages = [], data = {} } = req.body || {}
  if (!messages.length) return res.status(400).json({ error: 'No messages provided' })

  const today  = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const system = buildSystem(data.summary || {}, today)

  let apiMessages = messages.map(m => ({ role: m.role, content: m.content }))

  try {
    let finalText = null
    let rounds    = 0

    while (rounds < MAX_ROUNDS) {
      rounds++

      const resp = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      MODEL,
          max_tokens: MAX_TOKENS,
          system,
          tools:      TOOLS,
          messages:   apiMessages,
        }),
      })

      if (!resp.ok) {
        const body = await resp.text()
        console.error('[jarvis-chat] Anthropic error:', body)
        return res.status(502).json({ error: `Anthropic API error ${resp.status}` })
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
          let result
          try {
            result = executeTool(block.name, block.input, data)
          } catch (err) {
            result = { error: err.message }
          }
          toolResults.push({
            type:        'tool_result',
            tool_use_id: block.id,
            content:     JSON.stringify(result),
          })
        }
        apiMessages.push({ role: 'user', content: toolResults })
        continue
      }

      finalText = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
      break
    }

    res.json({ content: finalText || 'No response generated. Please try again.' })
  } catch (err) {
    console.error('[jarvis-chat] error:', err)
    res.status(500).json({ error: err.message })
  }
}
