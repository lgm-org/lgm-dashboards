// POST /api/jarvis-chat
// Powers the Jarvis AI analyst tab in the Customer Health dashboard.
// Calls the Anthropic Messages API with LGM account data as context.

const ANTHROPIC_API  = 'https://api.anthropic.com/v1/messages'
const MODEL          = 'claude-haiku-4-5-20251001'
const MAX_TOKENS     = 1024

function buildSystemPrompt(ctx) {
  const {
    asOf, totalAccounts, stripeMatched, healthy, watch, atRisk,
    totalMRR, dmCount, agentCount,
    cohort30, cohort60, cohort90,
    logoChurnLastMonth, logoChurnAvg6m,
    topAtRisk = [], topUpsell = [], recentCancellations = [],
  } = ctx || {}

  const money = n => n != null ? `$${Math.round(n).toLocaleString()}` : 'N/A'
  const pct   = n => n != null ? `${n.toFixed(1)}%` : 'N/A'

  const atRiskList = topAtRisk.map((a, i) =>
    `  ${i + 1}. ${a.name} | Score: ${a.score} | MRR: ${money(a.mrr)} | Type: ${a.type} | Issue: ${a.issue}`
  ).join('\n')

  const upsellList = topUpsell.map((a, i) =>
    `  ${i + 1}. ${a.name} | Score: ${a.score} | MRR: ${money(a.mrr)} | Est. upsell: ${money(a.estExtra)}/mo | Add-on: ${a.addon}`
  ).join('\n')

  const cancelList = recentCancellations.slice(0, 10).map((a, i) =>
    `  ${i + 1}. ${a.name} | MRR: ${money(a.mrr)} | Cancelled: ${a.canceledAt} | Type: ${a.type}`
  ).join('\n')

  return `You are Jarvis, the internal AI analyst for Little Giant Marketing (LGM).
LGM provides GoHighLevel (GHL) sub-accounts to insurance agents and direct-managed (DM) clients.

DATA SNAPSHOT — as of ${asOf || 'today'}:

ACCOUNTS:
- Total GHL sub-accounts: ${totalAccounts}
- Stripe-matched (billing): ${stripeMatched}
- Healthy (score ≥80): ${healthy}
- Watch (score 50–79): ${watch}
- At-Risk (score <50): ${atRisk}
- DM accounts: ${dmCount} | Agent accounts: ${agentCount}
- Total MRR: ${money(totalMRR)}

CHURN:
- 30-day cohort churn: ${cohort30 != null ? pct(cohort30) : 'N/A'}
- 60-day cohort churn: ${cohort60 != null ? pct(cohort60) : 'N/A'}
- 90-day cohort churn: ${cohort90 != null ? pct(cohort90) : 'N/A'}
- Logo churn last complete month: ${pct(logoChurnLastMonth)}
- Logo churn 6-month average: ${pct(logoChurnAvg6m)}

TOP AT-RISK ACCOUNTS:
${atRiskList || '  (none in data)'}

UPSELL-READY ACCOUNTS:
${upsellList || '  (none in data)'}

RECENT CANCELLATIONS (last 90 days):
${cancelList || '  (none in data)'}

HEALTH SCORING LOGIC (for reference):
- Score is weighted: transactions 40%, users 20%, revenue 15%, tenure 15%, activity 10%
- At-Risk: score <50 OR transactions <3500/month
- Upsell-ready: transactions >3500 AND users >3
- Account types: DM (direct-managed, ~$250/mo) vs Agent (~$269+/mo)

Respond concisely and directly. Use specific numbers from the data above.
If the answer is not in the data, say so rather than guessing.
Format lists with line breaks for readability. Keep answers under 200 words unless a detailed breakdown is specifically requested.`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured in Vercel env vars' })

  const { messages = [], context = {} } = req.body || {}
  if (!messages.length) return res.status(400).json({ error: 'No messages provided' })

  try {
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
        system:     buildSystemPrompt(context),
        messages,
      }),
    })

    if (!resp.ok) {
      const body = await resp.text()
      console.error('Anthropic error:', body)
      return res.status(502).json({ error: `Anthropic API error: ${resp.status}` })
    }

    const data    = await resp.json()
    const content = data.content?.[0]?.text || ''
    res.json({ content })
  } catch (err) {
    console.error('jarvis-chat error:', err)
    res.status(500).json({ error: err.message })
  }
}
