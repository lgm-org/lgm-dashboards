// Daily AI Briefings — the analyst step.
// One Claude call per role. Input: the deterministic fact pack from api/_briefingCollect.js.
// Output: a structured pick-and-explain (wins, actions, priorities, role sections).
// Claude never computes numbers; every ref it cites must exist in the fact pack or it is dropped.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

export const MODEL = process.env.BRIEFING_MODEL || 'claude-opus-5'

const Item = z.object({
  text: z.string().describe('One or two short sentences. Name the account/person. No numbers that are not in the facts.'),
  ref: z.string().nullable().describe('The ref of the account/demo/call this is about, copied exactly from the facts, or null'),
})
const Action = z.object({
  title: z.string().describe('Short imperative title naming the account/person'),
  why: z.string().describe('Why this needs attention — cite the fact(s)'),
  action: z.string().describe('The specific recommended next step'),
  priority: z.enum(['High', 'Medium', 'Low']),
  owner: z.string().nullable().describe('Who should do it, or null'),
  ref: z.string().nullable(),
})
const Section = z.object({
  title: z.string(),
  items: z.array(Item),
})
export const BriefingSchema = z.object({
  headline: z.string().describe('One sentence, the best positive result of the period (a sale, a win, a healthy account). Never a warning, never "but ...". If nothing positive exists, a neutral factual sentence with no judgement.'),
  went_well: z.array(Item).describe('3-5 positive results from yesterday / this week. Empty only if nothing positive is in the facts.'),
  needs_attention: z.array(Action).describe('3-8 actions, highest priority first'),
  priorities: z.array(z.string()).describe('Top 3 things this person should personally do today'),
  role_sections: z.array(Section).describe('The role-specific sections requested in the instructions, in that order'),
})

const RULES = `You write the morning briefing email for one Little Giant Marketing (LGM) team member.
LGM sells a GHL-based CRM/AI platform to insurance agents; District Managers (DMs) refer agents.
Health scores are 0-100 (Green >= 70, Yellow 55-69, Red < 55).

Non-negotiable rules:
- Use ONLY the facts provided. Never invent names, numbers, dates or events. If a section has no data, say so in one short line.
- Positive results first, actions second. Keep every item to one or two short sentences.
- The headline is the lead of the email: ONE positive result (yesterday's sale, a closed demo, an account that improved). It must never pivot to a concern with "but", "however" or "while" — every concern belongs under needs_attention, never in the headline or in went_well.
- Every risk must say WHY (cite the fact) and give a recommended action.
- Highlight changes and trends (score moved, new since yesterday, repeat caller) over static numbers.
- Items marked repeat:true were already reported recently — mention them only because they changed or are still critical, and say so.
- Copy "ref" values exactly from the facts so the email can deep-link. Use null when there is no matching ref.
- Tone: direct, specific, no fluff, no hedging. Plain sentences, no markdown.
- Refer to the reporting period by its label ("yesterday" or "last week"); the 7-day / MTD / 30-day tables are always to-date.`

const ROLE_INSTRUCTIONS = {
  joe: `Recipient: Joe, who owns District Manager (DM) relationships and agent growth.
Role sections to produce, in this order:
1. "Top 3 DMs to contact today" — from dormantHighValueDms and weakeningDistricts; say what to say to each.
2. "Top 3 recent agent wins" — from newAgentsPast7Days with healthy scores or strong activity.
3. "Districts showing weakening health" — from weakeningDistricts with the why.
If dmDataAvailable is false, say plainly that the DM mapping is empty and what is needed, and keep the sections to one line each.`,
  kevin: `Recipient: Kevin, sales. Wins first (sales, closed demos, healthy recent customers), then exactly who to follow up with.
salesTable is company-wide with a byRep breakdown; kevinOwnSales is Kevin's own numbers (soldBy = Kevin). Use "your" only for accounts whose soldBy is Kevin.
Role sections to produce, in this order:
1. "Demo follow-ups" — one item per openDemoFollowUps entry (max 10): objection summary in the buyer's terms, recommended next action, and Priority High/Medium/Low (start from suggestedPriority, adjust with judgement). ref = the demo ref.
2. "Recent sales health" — items for recentSalesHealth accounts with a concern (poor fit or early churn risk) and the 1-2 strongest ones. ref = account ref.
Sales quality matters as much as sales count — call out any recent sale that looks like a poor fit.`,
  rachel: `Recipient: Rachel, client relations and onboarding. This is her daily retention hit list.
Role sections to produce, in this order:
1. "Most successful new accounts" — up to 5 from mostSuccessfulNew, one line each on what is going right.
2. "Most at-risk new accounts" — up to 5 from mostAtRiskNew: why, and the onboarding step to take.
3. "Retention hit list" — the topAtRiskOverall accounts: why at risk, recommended action, suggested owner (use suggestedOwner unless the facts argue otherwise).
Use changesSinceYesterday for trend call-outs.`,
  inbound: `Recipients: Hope, Jessica, Kylie and Rachel — the team handling inbound customer calls. Goal: understand inbound demand and whether calls were handled well, and stop customer calls drifting back to Sales.
Role sections to produce, in this order:
1. "Calls not resolved" — from unresolvedCalls: customer, what is pending, owner.
2. "Customers who called repeatedly" — from repeatCallers with the likely reason.
3. "Calls that should have gone elsewhere" — calls whose reason/category does not match who handled them (e.g. Sales questions handled by support, support issues handled by Sales). Say "None spotted" if none.
4. "Concerning sentiment" — from concerningSentiment.
5. "Sales or upsell opportunities" — anything in the call summaries suggesting an add-on, upgrade, referral or expansion.
If stats.available is false, say the GHL call stats could not be loaded and why.`,
  john: `Recipient: John, CEO. This is the roll-up, not a repeat of every employee email.
went_well = "What went well yesterday" (3-5 bullets). needs_attention = "What needs attention today" (3-5 bullets).
priorities = "CEO priorities": the top 3 things John should personally care about today — this is the most important part; be decisive and specific.
Role sections to produce, in this order, each 1-4 crisp items:
1. "Revenue" 2. "Sales" 3. "Customer health" 4. "Onboarding" 5. "Customer activity" 6. "District managers".
Each section: the trend or change that matters, not a restatement of every number (the raw tables follow the summary).`,
}

let _client = null
function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 240_000, maxRetries: 2 })
  return _client
}

// Collect every ref that appears anywhere in the fact pack so hallucinated refs can be dropped
export function collectRefs(obj, out = new Set()) {
  if (Array.isArray(obj)) obj.forEach(x => collectRefs(x, out))
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if ((k === 'ref' || k === 'accountRef') && typeof v === 'string') out.add(v)
      else collectRefs(v, out)
    }
  }
  return out
}

// John (2026-10-01): the headline must not go straight into a negative. If the model still writes
// "X happened, but Y is overdue", keep only the positive clause; the concern is already under needs_attention.
export function positiveHeadline(text) {
  let h = String(text || '').trim()
  const m = h.match(/^(.*?\S)\s*(?:,|;|—|–|-)?\s+(?:but|however|while|yet|although|though)\b/i)
  if (m && m[1].length >= 20) h = m[1].replace(/[,;—–-]\s*$/, '')
  if (h && !/[.!?]$/.test(h)) h += '.'
  return h
}

function scrub(result, refs) {
  const fix = (it) => ({ ...it, ref: it.ref && refs.has(it.ref) ? it.ref : null })
  return {
    headline: positiveHeadline(result.headline),
    went_well: (result.went_well || []).slice(0, 5).map(fix),
    needs_attention: (result.needs_attention || []).slice(0, 8).map(fix),
    priorities: (result.priorities || []).slice(0, 3),
    role_sections: (result.role_sections || []).slice(0, 6).map(s => ({ title: s.title, items: (s.items || []).slice(0, 12).map(fix) })),
  }
}

// Strip the internal snapshot and other bulky fields before the model sees the pack
function packForModel(facts) {
  const { _stripeSnapshot, sourceStatus, ...rest } = facts
  return rest
}

export async function analyze(role, facts) {
  const instructions = ROLE_INSTRUCTIONS[role]
  if (!instructions) throw new Error(`Unknown role ${role}`)
  const refs = collectRefs(facts)
  const response = await client().messages.parse({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: 'medium', format: zodOutputFormat(BriefingSchema) },
    system: [{ type: 'text', text: `${RULES}\n\n${instructions}`, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: `Today is ${facts.runDay} (Central time). Reporting period: ${facts.period?.label || 'yesterday'} (${facts.period?.start || facts.yesterday} to ${facts.period?.end || facts.yesterday}).${facts.period?.kind === 'week' ? ' This is the Monday edition: it covers the whole previous week, so say "last week", not "yesterday".' : ''}\n\nFACTS (JSON):\n${JSON.stringify(packForModel(facts))}`,
    }],
  })
  if (response.stop_reason === 'refusal') throw new Error(`Model refused (${response.stop_details?.category || 'unknown'})`)
  if (!response.parsed_output) throw new Error(`Model returned no parseable output (stop_reason=${response.stop_reason})`)
  return {
    analysis: scrub(response.parsed_output, refs),
    model: response.model,
    usage: { input: response.usage?.input_tokens, output: response.usage?.output_tokens, cache_read: response.usage?.cache_read_input_tokens ?? 0 },
  }
}
