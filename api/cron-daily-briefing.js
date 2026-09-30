// Vercel cron — sends the daily AI briefings every Monday to Friday at 11:15 UTC (06:15 Central).
// Tuesday-Friday editions cover yesterday; the Monday edition covers the whole previous week
// (see reportingPeriod() in _briefingSources.js).
// vercel.json is shared by every Vercel project built from this repo, so this fires on all of
// them; only the Customer Health project (VITE_APP_MODE=health) does the work.
//
// Env (on lgm-customer-health): ANTHROPIC_API_KEY, RESEND_API_KEY, BRIEFING_FROM,
// BRIEFING_RECIPIENTS (JSON per role) and/or BRIEFING_TEST_TO (overrides everything while set),
// plus the existing GHL / Stripe / Supabase / Freshdesk secrets. BRIEFINGS_ENABLED=0 pauses it.

import { runBriefings } from './_briefingRun.js'

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (process.env.VITE_APP_MODE !== 'health') {
    return res.status(200).json({ skipped: `not the health project (VITE_APP_MODE=${process.env.VITE_APP_MODE || 'unset'})` })
  }
  if (process.env.BRIEFINGS_ENABLED === '0') return res.status(200).json({ skipped: 'BRIEFINGS_ENABLED=0' })

  try {
    const out = await runBriefings({ send: true })
    const summary = Object.fromEntries(Object.entries(out.results).map(([r, v]) => [r, { status: v.status, to: v.recipients, aiError: v.aiError, sendError: v.sendError, usage: v.usage }]))
    console.log('[cron-daily-briefing]', JSON.stringify({ runDay: out.runDay, elapsedMs: out.elapsedMs, sourceStatus: out.sourceStatus, summary }))
    res.json({ ok: true, runDay: out.runDay, elapsedMs: out.elapsedMs, sourceStatus: out.sourceStatus, results: summary })
  } catch (err) {
    console.error('[cron-daily-briefing] failed', err)
    res.status(500).json({ error: err.message })
  }
}
