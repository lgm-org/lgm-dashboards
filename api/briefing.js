// Daily AI Briefings — preview & manual trigger.
//   GET  /api/briefing?role=kevin                 → the email as HTML (nothing sent, nothing stored)
//   GET  /api/briefing?role=kevin&format=json     → fact pack + AI analysis as JSON
//   GET  /api/briefing?role=kevin&skipAi=1        → raw-data-only render (no Claude call)
//   POST /api/briefing?role=john&send=1&to=me@x   → send to an override address (stored in briefing_sends)
//   POST /api/briefing?send=1                     → send all roles to their configured recipients
//   ...&runDay=2026-09-26                         → run as if it were that morning
// Auth: Authorization: Bearer <CRON_SECRET|BRIEFING_PREVIEW_KEY> or ?key=<...>.

import { runBriefings } from './_briefingRun.js'
import { ROLES } from './_briefingCollect.js'

export default async function handler(req, res) {
  // CRON_SECRET (what Vercel crons send) or BRIEFING_PREVIEW_KEY (a separate key for humans/tools)
  const secrets = [process.env.CRON_SECRET, process.env.BRIEFING_PREVIEW_KEY].filter(Boolean)
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const key  = req.query.key || ''
  if (!secrets.length || !secrets.some(s => s === auth || s === key)) return res.status(401).json({ error: 'Unauthorized' })
  res.setHeader('Cache-Control', 'no-store')

  const role   = req.query.role || null
  const roles  = role ? [role] : ROLES
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: `role must be one of ${ROLES.join(', ')}` })
  const send   = req.query.send === '1' && req.method === 'POST'
  const format = req.query.format || (role ? 'html' : 'json')

  try {
    const out = await runBriefings({
      runDay: req.query.runDay || undefined, roles, send, to: req.query.to || null,
      skipAi: req.query.skipAi === '1', persist: send,
    })
    if (format === 'html' && role) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.send(out.results[role].html)
    }
    const slim = Object.fromEntries(Object.entries(out.results).map(([r, v]) => {
      const { html, ...rest } = v
      return [r, format === 'json' ? rest : { status: rest.status, subject: rest.subject, recipients: rest.recipients, aiError: rest.aiError, sendError: rest.sendError, usage: rest.usage }]
    }))
    res.json({ runDay: out.runDay, elapsedMs: out.elapsedMs, sourceStatus: out.sourceStatus, accounts: out.accounts, results: slim })
  } catch (err) {
    console.error('[briefing]', err)
    res.status(500).json({ error: err.message })
  }
}
