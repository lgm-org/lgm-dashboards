// POST /api/jarvis-team — Jarvis Team Intelligence: Claude with tools over every analyzed
// call/meeting transcript. Streams NDJSON: {"type":"tool_start",...} … {"type":"done","content"}.
// Body: { messages:[{role,content}], scope:{ date_from, date_to, employees[], customer, call_type } }

import * as crypto from 'node:crypto'
import {
  loadData, execSearchCalls, execCallDetail, execAggregate, execSearchTranscripts, execListPeople,
} from './_jarvisTeamData.js'

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const MODEL         = 'claude-sonnet-4-6'
const MAX_TOKENS    = 4096
const MAX_ROUNDS    = 10
const COOKIE        = 'lgm-team-auth'

const TOOL_LABELS = {
  search_calls:       'Searching calls and meetings…',
  get_call_detail:    'Reading a transcript…',
  aggregate_calls:    'Counting and comparing…',
  search_transcripts: 'Scanning transcripts for mentions…',
  list_people:        'Checking who is in scope…',
}

const FILTER_PROPS = {
  date_from:  { type: 'string', description: 'YYYY-MM-DD inclusive' },
  date_to:    { type: 'string', description: 'YYYY-MM-DD inclusive' },
  employee:   { type: 'string', description: 'LGM team member name (substring match)' },
  customer:   { type: 'string', description: 'Customer / account name (substring match)' },
  category:   { type: 'string', description: 'Account Management | Sales | Onboarding | Support | Internal' },
  call_type:  { type: 'string', enum: ['all', 'Phone Call', 'Meeting'] },
  status:     { type: 'string', description: 'e.g. "Action Required"' },
  risk:       { type: 'string', description: 'Client risk level: Low | Medium | High' },
  frustrated: { type: 'boolean' },
  min_score:  { type: 'number' }, max_score: { type: 'number' },
  keyword:    { type: 'string', description: 'Keyword matched against summary, action items, red flags, coaching notes' },
}

const TOOLS = [
  { name: 'search_calls',
    description: 'Find analyzed calls/meetings matching filters. Returns per-call analysis summaries, action items, follow-up owner, promised deadline, risk, and recording links. Start here for most questions.',
    input_schema: { type: 'object', properties: { ...FILTER_PROPS, limit: { type: 'number', description: 'default 25, max 60' } } } },
  { name: 'get_call_detail',
    description: 'Full analysis plus the transcript of ONE call/meeting by id. Transcripts are long — read in 12k-char pages via transcript_offset. Use for evidence quotes and for comparing how people actually run calls.',
    input_schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, transcript_offset: { type: 'number' }, transcript_chars: { type: 'number', description: 'default 12000, max 20000' } } } },
  { name: 'aggregate_calls',
    description: 'Counts, minutes, average score, frustrated/action-required/high-risk counts grouped by employee, customer, category, call_type, verdict, sentiment, risk, status, day or week. When date_from/date_to are given it also returns the previous equal-length period for trend.',
    input_schema: { type: 'object', properties: { ...FILTER_PROPS, group_by: { type: 'string', enum: ['employee', 'customer', 'category', 'call_type', 'verdict', 'sentiment', 'risk', 'status', 'day', 'week'] }, limit: { type: 'number' } } } },
  { name: 'search_transcripts',
    description: 'Find which conversations mention a topic (word/phrase, or several alternatives via terms). Returns how many calls mention it, share of conversations, minutes involved, per-employee and per-week counts, previous-period comparison, and snippets with the call ids. This is how you QUANTIFY a recurring question or problem.',
    input_schema: { type: 'object', properties: { ...FILTER_PROPS, query: { type: 'string' }, terms: { type: 'array', items: { type: 'string' }, description: 'Alternative phrasings, matched as OR' }, max_calls: { type: 'number' }, snippet_chars: { type: 'number' } } } },
  { name: 'list_people',
    description: 'Employees, customers and categories present in scope with call counts, plus the date range of data. Use to resolve names before filtering.',
    input_schema: { type: 'object', properties: { date_from: FILTER_PROPS.date_from, date_to: FILTER_PROPS.date_to, limit: { type: 'number' } } } },
]

function buildSystem({ today, scope, dataRange, counts }) {
  const sc = []
  if (scope?.date_from || scope?.date_to) sc.push(`dates ${scope.date_from || '…'} to ${scope.date_to || today}`)
  if (scope?.employees?.length) sc.push(`employees: ${scope.employees.join(', ')}`)
  if (scope?.customer) sc.push(`customer: ${scope.customer}`)
  if (scope?.call_type && scope.call_type !== 'all') sc.push(`type: ${scope.call_type}`)

  return `You are Jarvis — Little Giant Marketing's Team Intelligence assistant. Little Giant (LGM) is a GoHighLevel reseller serving insurance agencies. You have listened to every customer phone call and meeting the team has recorded: ${counts.calls.toLocaleString()} analyzed conversations (${counts.meetings} meetings, ${counts.phone} phone calls) from ${dataRange.from} to ${dataRange.to}, each with an AI analysis and, for most, the full transcript.
Today: ${today}.

SCOPE SELECTED IN THE UI: ${sc.length ? sc.join(' · ') : 'none — all data'}. Tool calls default to this scope; you may narrow further but only widen it if the user explicitly asks.

HOW TO WORK
- Size the question first (aggregate_calls / search_transcripts / search_calls), then read a handful of representative transcripts with get_call_detail (at most ~6 per answer, paging only when needed). For person-vs-person comparisons read 2–3 transcripts per person.
- To find recurring questions or problems, use search_transcripts with several phrasings, then quantify: calls matched, share of conversations, minutes, trend vs previous period.
- When asked about commitments, use search_calls with status "Action Required" and the action_items / follow_up_owner / promised_deadline fields.

EVIDENCE RULES — these are not optional
- Every finding about a person, customer or topic must cite its sources as markdown links: [Employee → Customer · Sep 18 · 14 min](link). If link is null write (Call ID GHL-… · Sep 18). Never cite a conversation you did not get from a tool.
- Separate what was SAID from what you INFER. Quote short transcript lines verbatim for key claims and keep the [mm:ss] timestamp that precedes them so the reader can jump to that moment in the recording. Label interpretation explicitly, e.g. "Inference: …". A transcript proves a promise was made, never that it was completed — say "committed to", not "did".
- Sentiment or a single call never decides an employee's performance or a customer's cancellation risk. Require at least two independent signals and say how strong the evidence is. Fewer than 3 relevant conversations → say the evidence is thin.
- Quantify: number of conversations, share of conversations in scope, minutes involved, trend vs the previous period. Prefer "mentioned in 27 of 212 calls (13%), 6.1 hours, up from 9 last period" over "frequently".
- Never fabricate names, dates, numbers or ids. If data is missing, say what is missing.

OUTPUT
- Plain conversational paragraphs and bullet lists. No # headers. **Bold** sparingly for names and numbers.
- Lead with the answer, then evidence, then "Recommended actions" (owner + concrete next step) when the question calls for it, then a short "Sources" list.
- Offer a natural follow-up question when useful.

CHARTS — you may render a chart after your text:
\`\`\`chart
{"type":"bar","title":"Title","xKey":"name","yKey":"value","color":"#8CC63F","data":[{"name":"Kevin Wyatt","value":12}],"note":"optional"}
\`\`\`
Types: "bar" (horizontal), "bar" + "direction":"vertical", "line" (trend), "pie" (nameKey/valueKey). ≤15 items. Colors: #8CC63F green, #3B82F6 blue, #EAB308 yellow, #FF6112 orange.

FILES — you can hand the user a downloadable file. CSV for lists/reports someone would open in a spreadsheet; Markdown/text for briefs, agendas, coaching notes, L10 issue lists, training outlines:
\`\`\`csv-download
{"filename":"report.csv","content":"Col A,Col B\\nrow,row"}
\`\`\`
\`\`\`file-download
{"filename":"leadership-brief-2026-10-09.md","content":"# Title\\n\\nBody…"}
\`\`\`
Use \\n for newlines inside the JSON string. Offer a file whenever the user asks for a report, list, brief, document, export, or something to share — and still give a short summary in the chat.`
}

// ── Auth: team cookie is g.<base64url(email:member)>.<hmac> signed with SESSION_SECRET ─
function callerFromCookie(req) {
  const raw = req.cookies?.[COOKIE] || ''
  const secret = process.env.SESSION_SECRET
  if (process.env.AUTH_ENABLED !== 'true') return { ok: true, email: decodeEmail(raw) || 'team' }
  if (!secret) return { ok: false }
  if (raw === secret) return { ok: true, email: 'team' }
  const parts = raw.split('.')
  if (parts.length !== 3 || parts[0] !== 'g') return { ok: false }
  const expected = crypto.createHmac('sha256', secret).update(parts[1]).digest('base64url')
  if (expected.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return { ok: false }
  return { ok: true, email: decodeEmail(raw) }
}
function decodeEmail(raw) {
  try { if (raw.startsWith('g.')) return Buffer.from(raw.split('.')[1], 'base64url').toString().split(':')[0] } catch {}
  return null
}

function withScope(input, scope) {
  const out = { ...input }
  if (scope?.date_from && !out.date_from) out.date_from = scope.date_from
  if (scope?.date_to && !out.date_to)     out.date_to = scope.date_to
  if (scope?.employees?.length && !out.employee && !out.employees) out.employees = scope.employees
  if (scope?.customer && !out.customer)   out.customer = scope.customer
  if (scope?.call_type && scope.call_type !== 'all' && !out.call_type) out.call_type = scope.call_type
  return out
}

function executeTool(name, input, data, scope) {
  const { calls, transcripts } = data
  const args = withScope(input || {}, scope)
  switch (name) {
    case 'search_calls':       return execSearchCalls(args, calls)
    case 'get_call_detail':    return execCallDetail(args, calls, transcripts)
    case 'aggregate_calls':    return execAggregate(args, calls)
    case 'search_transcripts': return execSearchTranscripts(args, calls, transcripts)
    case 'list_people':        return execListPeople(args, calls)
    default: return { error: `Unknown tool ${name}` }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const caller = callerFromCookie(req)
  if (!caller.ok) return res.status(401).json({ error: 'Not signed in' })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on this project' })

  const { messages = [], scope = {} } = req.body || {}
  if (!messages.length) return res.status(400).json({ error: 'No messages' })

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Transfer-Encoding', 'chunked')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')
  const emit = obj => res.write(JSON.stringify(obj) + '\n')

  try {
    emit({ type: 'tool_start', tool: 'load', label: 'Loading call library…' })
    const data = await loadData()
    const dates = data.calls.map(c => c.date).sort()
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
    const system = buildSystem({
      today, scope,
      dataRange: { from: dates[0], to: dates[dates.length - 1] },
      counts: { calls: data.calls.length, meetings: data.calls.filter(c => c.callType === 'Meeting').length, phone: data.calls.filter(c => c.callType !== 'Meeting').length },
    })

    const apiMessages = messages.map(m => ({ role: m.role, content: m.content }))
    let finalText = null

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, tools: TOOLS, messages: apiMessages }),
      })
      if (!resp.ok) {
        console.error('[jarvis-team]', resp.status, await resp.text())
        emit({ type: 'error', message: `AI API error ${resp.status}` })
        return res.end()
      }
      const msg = await resp.json()
      if (msg.stop_reason === 'tool_use') {
        apiMessages.push({ role: 'assistant', content: msg.content })
        const results = []
        for (const block of msg.content) {
          if (block.type !== 'tool_use') continue
          emit({ type: 'tool_start', tool: block.name, label: TOOL_LABELS[block.name] || block.name })
          let result
          try { result = executeTool(block.name, block.input, data, scope) } catch (err) { result = { error: err.message } }
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
        }
        apiMessages.push({ role: 'user', content: results })
        continue
      }
      finalText = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
      if (msg.stop_reason === 'max_tokens') finalText += '\n\n*(Answer was cut short — ask me to continue.)*'
      break
    }
    emit({ type: 'done', content: finalText || 'I ran out of steps before finishing — try a narrower question or date range.' })
    res.end()
  } catch (err) {
    console.error('[jarvis-team]', err)
    emit({ type: 'error', message: err.message })
    res.end()
  }
}
