// Daily AI Briefings — orchestration: load context once → per role: facts → AI → HTML → send → log.
// Used by api/cron-daily-briefing.js (scheduled) and api/briefing.js (preview / manual send).

import { buildContext, collectAll, ROLES } from './_briefingCollect.js'
import { analyze, MODEL } from './_briefingAnalyze.js'
import { render, renderText, subjectFor } from './_briefingRender.js'
import { saveSnapshot, saveItems, logSend, localDay } from './_briefingSources.js'

// Recipients: BRIEFING_RECIPIENTS = {"joe":["..."],"kevin":["..."],"rachel":["..."],"inbound":["...","..."],"john":["..."]}
// While BRIEFING_TEST_TO is set, EVERY briefing goes only to that address (safe rollout).
export function recipientsFor(role, override = null) {
  if (override) return String(override).split(',').map(s => s.trim()).filter(Boolean)
  if (process.env.BRIEFING_TEST_TO) return process.env.BRIEFING_TEST_TO.split(',').map(s => s.trim()).filter(Boolean)
  try {
    const cfg = JSON.parse(process.env.BRIEFING_RECIPIENTS || '{}')
    const v = cfg[role]
    return Array.isArray(v) ? v : typeof v === 'string' ? [v] : []
  } catch { return [] }
}

// Two delivery paths, first one configured wins:
//   1. Gmail SMTP  — GMAIL_USER + GMAIL_APP_PASSWORD (Google Workspace app password; 2-Step Verification required)
//   2. Resend      — RESEND_API_KEY + a verified sending domain (https://resend.com)
export async function sendEmail({ to, subject, html, text }) {
  const from = process.env.BRIEFING_FROM || 'LGM Briefings <briefings@littlegiantmarketing.com>'
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) return sendViaGmail({ to, subject, html, text, from })
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('No email provider configured: set GMAIL_USER + GMAIL_APP_PASSWORD or RESEND_API_KEY')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, text }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${body?.message || JSON.stringify(body).slice(0, 200)}`)
  return body.id || null
}

async function sendViaGmail({ to, subject, html, text, from }) {
  const { default: nodemailer } = await import('nodemailer')
  const user = process.env.GMAIL_USER
  const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass: process.env.GMAIL_APP_PASSWORD } })
  // Gmail only sends as the authenticated user (or one of its verified aliases); keep the display name from BRIEFING_FROM
  const name = (from.match(/^(.*?)\s*</) || [])[1] || 'LGM Briefings'
  const info = await transport.sendMail({ from: `${name} <${user}>`, to, subject, html, text })
  return info.messageId || null
}

// opts: { runDay, roles, send, to, skipAi, persist }
export async function runBriefings(opts = {}) {
  const runDay  = opts.runDay || localDay()
  const roles   = (opts.roles || ROLES).filter(r => ROLES.includes(r))
  const persist = opts.persist !== false
  const t0 = Date.now()

  const ctx = await buildContext(runDay)
  const packs = await collectAll(ctx, roles.includes('john') ? ROLES : roles) // john needs the others
  const results = {}

  // The AI step for every role runs in parallel — five short calls, not one long one
  await Promise.all(roles.map(async (role) => {
    const facts = packs[role]
    const out = { role, runDay, recipients: recipientsFor(role, opts.to), status: 'rendered', aiError: null, sendError: null, model: null, usage: null }
    let analysis = null
    if (!opts.skipAi) {
      try {
        const a = await analyze(role, facts)
        analysis = a.analysis; out.model = a.model; out.usage = a.usage
      } catch (err) {
        out.aiError = err.message
        console.error('[briefing] analyze failed', role, err.message)
      }
    }
    const html = render(role, facts, analysis)
    const text = renderText(role, facts, analysis)
    const subject = subjectFor(role, facts, analysis)
    out.subject = subject; out.html = html; out.text = text; out.analysis = analysis; out.facts = facts

    if (opts.send) {
      if (!out.recipients.length) { out.status = 'not_sent'; out.sendError = 'no recipients configured (BRIEFING_RECIPIENTS / BRIEFING_TEST_TO)' }
      else {
        try { out.messageId = await sendEmail({ to: out.recipients, subject, html, text }); out.status = 'sent' }
        catch (err) { out.status = 'send_failed'; out.sendError = err.message; console.error('[briefing] send failed', role, err.message) }
      }
    }

    if (persist) {
      const { _stripeSnapshot, ...storable } = facts
      await saveSnapshot(role, runDay, storable)
      if (role === 'john' && _stripeSnapshot) await saveSnapshot('_stripe', runDay, _stripeSnapshot)
      if (facts.items?.length) await saveItems(facts.items.map(i => ({ role, run_date: runDay, ...i })))
      await logSend({
        role, run_date: runDay, recipients: out.recipients, status: out.status, subject,
        html: opts.send ? html : null, error: out.sendError || out.aiError, model: out.model || MODEL, usage: out.usage,
        sent_at: out.status === 'sent' ? new Date().toISOString() : null,
      })
    }
    results[role] = out
  }))

  return { runDay, roles, elapsedMs: Date.now() - t0, sourceStatus: ctx.sourceStatus, accounts: ctx.accounts.length, results }
}
