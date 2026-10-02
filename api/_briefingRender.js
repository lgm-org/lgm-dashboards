// Daily AI Briefings — HTML email rendering.
// Fixed order for every role: headline → what went well → needs attention → priorities →
// role sections (AI) → raw data tables (deterministic) → footer with data notes.
// Table-based, inline-styled HTML so it renders in Gmail/Outlook.

// Hosted logo (the wordmark is part of the image — never write the company name as text beside it).
// health.littlegiantmarketing.com challenges non-browser fetches, so default to the Goals domain which serves it plainly.
const LOGO_URL = process.env.BRIEFING_LOGO_URL || 'https://goals.littlegiantmarketing.com/lgm-logo.png'

const C = { green: '#8CC63F', orange: '#FF6112', heading: '#4A4A4A', bg: '#F4F6F4', text: '#1A1A1A', muted: '#6B7280', border: '#E5E7E5', red: '#EF4444', yellow: '#EAB308' }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const money = (n) => n === null || n === undefined ? '—' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const num = (n) => n === null || n === undefined ? '—' : String(n)
const pct = (n) => n === null || n === undefined ? '—' : `${n}%`
const trend = (t) => t === null || t === undefined ? '' : t > 0 ? ` <span style="color:${C.green}">▲${t}</span>` : t < 0 ? ` <span style="color:${C.red}">▼${Math.abs(t)}</span>` : ' <span style="color:#9CA3AF">→</span>'
const bandColor = (b) => b === 'Red' ? C.red : b === 'Yellow' ? C.yellow : b === 'Green' ? C.green : '#9CA3AF'
const scoreCell = (score, band, t) => score === null || score === undefined
  ? `<span style="color:#9CA3AF">no data</span>`
  : `<span style="display:inline-block;min-width:26px;padding:2px 7px;border-radius:999px;background:${bandColor(band)};color:#fff;font-weight:600;font-size:12px;text-align:center">${score}</span>${trend(t)}`
const link = (name, href) => href ? `<a href="${esc(href)}" style="color:${C.heading};font-weight:600;text-decoration:underline">${esc(name)}</a>` : `<strong>${esc(name)}</strong>`
const prioPill = (p) => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#fff;background:${p === 'High' ? C.red : p === 'Medium' ? C.orange : '#9CA3AF'}">${esc(p)}</span>`

const SUBJECTS = {
  joe: 'DM Growth Briefing', kevin: 'Sales + Follow-Up Briefing', rachel: 'Client Relations Briefing',
  inbound: 'Inbound Call Briefing', john: 'CEO Daily Briefing',
}
const GREETING = { joe: 'Joe', kevin: 'Kevin', rachel: 'Rachel', inbound: 'Team', john: 'John' }

const isWeek = (facts) => facts.period?.kind === 'week'
const per = (facts) => facts.period?.short || 'Yesterday'

export function subjectFor(role, facts, analysis) {
  const d = new Date(`${facts.runDay}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${SUBJECTS[role]}${isWeek(facts) ? ' (week recap)' : ''} — ${d}`
}

// ── building blocks ──────────────────────────────────────────────────────────

function section(title, body, accent = C.green) {
  return `<tr><td style="padding:18px 24px 6px"><h2 style="margin:0 0 10px;font-size:15px;letter-spacing:.04em;text-transform:uppercase;color:${C.heading};border-left:4px solid ${accent};padding-left:10px">${esc(title)}</h2>${body}</td></tr>`
}
const p = (text, color = C.text) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:${color}">${text}</p>`
const empty = (text) => p(`<em>${esc(text)}</em>`, C.muted)

function refLink(item, linkMap) {
  const href = item.ref && linkMap[item.ref]
  return href ? ` <a href="${esc(href)}" style="color:${C.green};font-size:12px;text-decoration:none">Open ↗</a>` : ''
}
function bullets(items, linkMap) {
  if (!items?.length) return empty('Nothing to report.')
  return `<ul style="margin:0;padding-left:18px">${items.map(i => `<li style="margin:0 0 7px;font-size:14px;line-height:1.5;color:${C.text}">${esc(i.text)}${refLink(i, linkMap)}</li>`).join('')}</ul>`
}
function actions(items, linkMap) {
  if (!items?.length) return empty('Nothing needs attention today.')
  return items.map(a => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;border:1px solid ${C.border};border-radius:10px;background:#fff">
      <tr><td style="padding:10px 12px">
        <div style="font-size:14px;font-weight:700;color:${C.heading}">${prioPill(a.priority)} &nbsp;${esc(a.title)}${refLink(a, linkMap)}</div>
        <div style="font-size:13px;color:${C.text};margin-top:5px"><strong>Why:</strong> ${esc(a.why)}</div>
        <div style="font-size:13px;color:${C.text};margin-top:3px"><strong>Do:</strong> ${esc(a.action)}${a.owner ? ` <span style="color:${C.muted}">· Owner: ${esc(a.owner)}</span>` : ''}</div>
      </td></tr>
    </table>`).join('')
}
function numbered(items) {
  if (!items?.length) return empty('No priorities identified.')
  return `<ol style="margin:0;padding-left:20px">${items.map(t => `<li style="margin:0 0 7px;font-size:14px;line-height:1.5;color:${C.text};font-weight:600">${esc(t)}</li>`).join('')}</ol>`
}

function table(headers, rows) {
  if (!rows.length) return empty('No rows.')
  const th = headers.map(h => `<th align="left" style="padding:8px 10px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:${C.green};white-space:nowrap">${esc(h)}</th>`).join('')
  const tr = rows.map((r, i) => `<tr style="background:${i % 2 ? '#fff' : C.bg}">${r.map(c => `<td style="padding:8px 10px;font-size:13px;color:${C.text};border-bottom:1px solid ${C.border};vertical-align:top">${c ?? '—'}</td>`).join('')}</tr>`).join('')
  return `<div style="overflow-x:auto"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${C.border};border-radius:8px;overflow:hidden">
    <thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`
}
const kpis = (pairs) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 10px"><tr>${pairs.map(([label, value]) => `<td style="padding:8px 14px 8px 0"><div style="font-size:22px;font-weight:700;color:${C.heading}">${value}</div><div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:${C.muted}">${esc(label)}</div></td>`).join('')}</tr></table>`

// Map every ref in the facts to its deep link
export function buildLinkMap(obj, out = {}) {
  if (Array.isArray(obj)) obj.forEach(x => buildLinkMap(x, out))
  else if (obj && typeof obj === 'object') {
    if (typeof obj.ref === 'string' && obj.link) out[obj.ref] = obj.link
    if (typeof obj.accountRef === 'string' && obj.link) out[obj.accountRef] = obj.link
    for (const v of Object.values(obj)) if (v && typeof v === 'object') buildLinkMap(v, out)
  }
  return out
}

// ── raw data per role ────────────────────────────────────────────────────────

const acctRow = (a, extra = []) => [link(a.name, a.link), scoreCell(a.score, a.band, a.trend7), money(a.mrr), ...extra]

function rawRachel(f) {
  const s = f.stats
  return [
    section('New client stats', table(['Period', 'New clients', 'Avg health'], [['Past 7 days', num(s.past7Days.newClients), num(s.past7Days.avgHealth)], ['Past 30 days', num(s.past30Days.newClients), num(s.past30Days.avgHealth)]]), C.heading),
    section('New accounts (past 30 days)', table(['Account', 'Health', 'MRR', 'Signed up', 'Onboarding', 'Last meeting', 'Last activity'],
      f.newAccounts.map(a => acctRow(a, [esc(a.signupDate), esc(a.onboardingStatus), a.lastMeeting ? `${esc(a.lastMeeting.date)} · ${esc(a.lastMeeting.category)}` : '—', a.lastActivityAt ? esc(a.lastActivityAt.slice(0, 10)) : '—']))), C.heading),
    section(`Retention hit list — Red accounts (${s.totalRedAccounts} total${s.atRiskSkippedAsRepeats ? `, ${s.atRiskSkippedAsRepeats} unchanged repeats hidden` : ''})`,
      table(['Account', 'Health', 'MRR', 'Why', 'Recommended action', 'Owner'], f.topAtRiskOverall.map(a => acctRow(a, [esc(a.why) + (a.repeat ? ` <span style="color:${C.muted}">(flagged ${esc(a.previouslyFlagged)}, was ${a.previousScore})</span>` : ''), esc(a.recommendedAction), esc(a.suggestedOwner)]))), C.red),
  ].join('')
}

function rawKevin(f) {
  const t = f.salesTable
  const rows = [[per(f), t.yesterday], ['Past 7 days', t.past7Days], ['MTD', t.mtd], ['Past 30 days', t.past30Days]].map(([l, w]) => [l, num(w.sales), money(w.newMrr), money(w.avgMrrPerSale), num(w.avgHealth)])
  const reps = Array.from(new Set(Object.values(t).flatMap(w => Object.keys(w.byRep || {})))).sort((a, b) => (a === 'Unattributed') - (b === 'Unattributed') || a.localeCompare(b))
  const repRows = reps.map(r => [r, ...[t.yesterday, t.past7Days, t.mtd, t.past30Days].map(w => { const b = w.byRep?.[r]; return b ? `${b.sales} · ${money(b.newMrr)}` : '0' })])
  return [
    section('Sales performance', table(['Period', 'Sales', 'New MRR', 'Avg MRR / sale', 'Avg health'], rows) +
      (reps.length ? `<div style="height:8px"></div>` + table(['By rep (sales · new MRR)', per(f), 'Past 7 days', 'MTD', 'Past 30 days'], repRows) : '') +
      p(`<span style="color:${C.muted};font-size:12px">${esc(f.notes.join(' '))}</span>`), C.heading),
    section('Open demo follow-ups', table(['Prospect', 'Demo', 'Source', 'Rep', 'Status', 'Follow-up by', 'Notes'],
      f.openDemoFollowUps.map(d => [`<strong>${esc(d.prospect)}</strong>`, esc(d.demoDate), esc(d.source), esc(d.rep), `${prioPill(d.suggestedPriority)} ${esc(d.status)}`, esc(d.followUpDate || '—'), esc((d.actionItems || d.summary || '').slice(0, 180))])), C.orange),
    section('Recently closed after a demo', table(['Prospect', 'Demo', 'Closed as'], f.recentlyClosed.map(d => [esc(d.prospect), esc(d.demoDate), esc(d.closedAs)])), C.green),
    section('Recent sales health (sold in the past 30 days)', table(['Account', 'Health', 'MRR', 'Sold', 'Sold by', 'Concern'], f.recentSalesHealth.map(a => acctRow(a, [esc(a.soldDate), esc(a.soldBy || '—'), esc(a.concern || '—')]))), C.heading),
  ].join('')
}

function rawJoe(f) {
  if (!f.dmDataAvailable) return section('District managers', empty(f.notes[0]), C.heading)
  return [
    section('Dormant high-value DMs (4+ active agents, no new agent in 30 days)', table(['DM', 'Active agents', 'Total MRR', 'Last agent signup', 'Avg health'],
      f.dormantHighValueDms.map(d => [link(d.dm, d.link), num(d.activeAgents), money(d.totalMrr), `${esc(d.lastAgentSignup || '—')} (${num(d.daysSinceLastSignup)}d)`, `${num(d.avgHealth)}${trend(d.avgTrend7)}`])), C.orange),
    section('New agents under DMs (past 7 days)', table(['Agent', 'DM', 'Signed up', 'MRR', 'Health', 'Signal'],
      f.newAgentsPast7Days.map(a => [link(a.name, a.link), esc(a.dm), esc(a.signupDate), money(a.mrr), scoreCell(a.score, a.band), esc(a.signal)])), C.green),
    section('All DMs', table(['DM', 'Active agents', 'Total MRR', 'Last signup', 'Avg health', 'Red agents'],
      f.allDms.map(d => [link(d.dm, d.link), num(d.activeAgents), money(d.totalMrr), esc(d.lastAgentSignup || '—'), `${num(d.avgHealth)}${trend(d.avgTrend7)}`, num(d.redAgents)])), C.heading),
  ].join('')
}

function rawInbound(f) {
  const s = f.stats
  const statsBlock = s.available
    ? kpis([['Inbound calls', num(s.totalInbound)], ['Answered', num(s.answered)], ['Missed', num(s.missed)], ['Answer rate', pct(s.answerRatePct)], ['Avg time to answer', '—'], ['Missed needing follow-up', num(s.missedRequiringFollowUp)]])
    : empty(`Call stats unavailable: ${s.reason || 'unknown'}`)
  return [
    section(`Inbound call stats (${(f.period?.label || 'yesterday')})`, statsBlock + p(`<span style="color:${C.muted};font-size:12px">${esc(f.notes[0])}</span>`), C.heading),
    section('Missed calls needing follow-up', table(['Caller', 'Time', 'Outcome'], f.missedCallsNeedingFollowUp.map(c => [esc(c.caller), esc(c.time), esc(c.outcome)])), C.red),
    section(`Call breakdown (analysed calls, ${f.period?.label || 'yesterday'})`, table(['Customer', 'Handled by', isWeek(f) ? 'Date' : 'Time', 'Min', 'Reason', 'Result', 'Follow-up', 'Owner', 'Summary'],
      f.callBreakdown.map(c => [link(c.customer, c.link), esc(c.employee), esc(isWeek(f) ? c.date : c.time), num(c.durationMin), esc(c.reason), esc(c.result), c.followUpNeeded ? '<strong>Yes</strong>' : 'No', esc(c.owner), esc(c.summary.slice(0, 200))])), C.heading),
    section('Repeat callers (past 7 days)', table(['Customer', 'Calls', 'Last reason', 'Last status'], f.repeatCallers.map(r => [esc(r.customer), num(r.calls7d), esc(r.lastReason), esc(r.lastStatus)])), C.orange),
  ].join('')
}

function rawJohn(f) {
  const r = f.revenue, s = f.sales, h = f.customerHealth, o = f.onboarding, a = f.customerActivity, d = f.districtManagers
  const mv = (x) => [link(x.name, x.link), `${num(x.from)} → ${num(x.to)}`, money(x.mrr)]
  return [
    section('1 · Revenue', kpis([[`Sales ${per(f).toLowerCase()}`, num(r.salesYesterday)], ['Past 7 days', num(r.salesPast7Days)], ['MTD', num(r.salesMtd)], ['New MRR (MTD)', money(r.newMrrMtd)]]) +
      kpis([['Expansion MRR', money(r.expansionMrrSinceYesterday)], ['Churned MRR', money(r.churnedMrrSinceYesterday)], ['Net new MRR', money(r.netNewMrrSinceYesterday)], ['Active MRR', money(r.totalActiveMrr)]]) +
      p(`<span style="color:${C.muted};font-size:12px">${esc(r.note)}</span>`) +
      (r.churnedAccounts.length ? table(['Churned since the last briefing', 'MRR'], r.churnedAccounts.map(c => [link(c.name, c.link), money(c.mrr)])) : ''), C.heading),
    section('2 · Sales', kpis([[`Demos ${per(f).toLowerCase()}`, num(s.demosHeldYesterday)], ['Demos 7d', num(s.demosHeldPast7Days)], ['Close rate 30d', pct(s.closeRatePct)], ['Avg MRR / sale', money(s.avgMrrPerSalePast30Days)]]) +
      (s.byRepPast30Days && Object.keys(s.byRepPast30Days).length ? table(['Sold by (MTD · 30d)', 'Sales', 'New MRR', 'Avg health'], Object.entries(s.byRepPast30Days).map(([r, b]) => [esc(r), `${num(s.byRepMtd?.[r]?.sales ?? 0)} · ${num(b.sales)}`, `${money(s.byRepMtd?.[r]?.newMrr ?? 0)} · ${money(b.newMrr)}`, num(b.avgHealth)])) + `<div style="height:8px"></div>` : '') +
      (s.importantLostDemos.length ? table(['Important open demos', 'Demo', 'Rep', 'Status'], s.importantLostDemos.map(x => [`<strong>${esc(x.prospect)}</strong>`, esc(x.demoDate), esc(x.rep), esc(x.status)])) : ''), C.heading),
    section('3 · Customer health', kpis([['Avg health', num(h.avgHealth)], ['Red', `<span style="color:${C.red}">${num(h.bands.red)}</span>`], ['Yellow', `<span style="color:${C.yellow}">${num(h.bands.yellow)}</span>`], ['Green', `<span style="color:${C.green}">${num(h.bands.green)}</span>`], ['No data', num(h.bands.noData)]]) +
      table(['Top 5 at risk', 'Health', 'MRR', 'Why', 'Owner'], h.top5AtRisk.map(x => acctRow(x, [esc(x.why), esc(x.suggestedOwner)]))) +
      (h.newAtRiskSinceYesterday.length ? `<div style="height:8px"></div>` + table([`New at-risk since ${isWeek(f) ? 'last week' : 'yesterday'}`, 'Score', 'MRR'], h.newAtRiskSinceYesterday.map(mv)) : '') +
      (h.deteriorated.length ? `<div style="height:8px"></div>` + table(['Deteriorated', 'Score', 'MRR'], h.deteriorated.map(mv)) : '') +
      (h.improved.length ? `<div style="height:8px"></div>` + table(['Improved', 'Score', 'MRR'], h.improved.map(mv)) : ''), C.heading),
    section('4 · Onboarding', kpis([['New 7d', num(o.newCustomersPast7Days)], ['New 30d', num(o.newCustomersPast30Days)], ['Avg health (new 30d)', num(o.avgHealthNewPast30Days)], ['Stuck', num(o.stuckInOnboarding.length)]]) +
      table(['Stuck in onboarding', 'Health', 'MRR', 'Signed up', 'Missing'], o.stuckInOnboarding.map(x => acctRow(x, [esc(x.signupDate), esc(x.missing.join(', '))]))), C.heading),
    section('5 · Customer activity', kpis([['Inbound calls', a.callDataAvailable ? num(a.inboundCalls) : '—'], ['Missed', a.callDataAvailable ? num(a.missedCalls) : '—'], ['Meetings', num(a.meetingsYesterday)], ['Support tickets', num(a.supportTicketsYesterday)], ['Escalations', num(a.escalations.length)]]) +
      (a.escalations.length ? table(['Escalation', 'Employee', 'Status', 'Summary'], a.escalations.map(e => [esc(e.customer), esc(e.employee), esc(e.status), esc(e.summary)])) : ''), C.heading),
    section('6 · District managers', d.dataAvailable
      ? kpis([['DMs', num(d.dms)], ['New agents 7d', num(d.newAgentsPast7Days.length)], ['Dormant high-value', num(d.dormantHighValueDms.length)], ['Weakening', num(d.weakeningDistricts.length)]]) +
        (d.dormantHighValueDms.length ? table(['Dormant DM', 'Active agents', 'MRR', 'Last signup'], d.dormantHighValueDms.map(x => [esc(x.dm), num(x.activeAgents), money(x.totalMrr), esc(x.lastAgentSignup || '—')])) : '')
      : empty('DM → agent mapping is empty; DM metrics will appear once the sync populates it.'), C.heading),
  ].join('')
}

const RAW = { rachel: rawRachel, kevin: rawKevin, joe: rawJoe, inbound: rawInbound, john: rawJohn }

// ── page ─────────────────────────────────────────────────────────────────────

// What mail clients show as the preview line: the headline, never the logo URL.
export function previewText(role, facts, analysis) {
  const head = analysis?.headline || `${SUBJECTS[role]} for ${facts.period?.label || 'yesterday'}.`
  return head.length > 140 ? head.slice(0, 137).replace(/\s+\S*$/, '') + '…' : head
}

// Plain-text alternative (used by Gmail/Outlook previews and text-only clients)
export function renderText(role, facts, analysis) {
  const a = analysis
  const lines = [SUBJECTS[role], '', `Good morning, ${GREETING[role]}.`, '', previewText(role, facts, analysis), '']
  if (a?.went_well?.length) { lines.push('WHAT WENT WELL'); for (const i of a.went_well) lines.push(`- ${i.text}`); lines.push('') }
  if (a?.needs_attention?.length) { lines.push('NEEDS ATTENTION'); for (const x of a.needs_attention) lines.push(`- [${x.priority}] ${x.title}: ${x.action}`); lines.push('') }
  if (a?.priorities?.length) { lines.push('TOP 3 TODAY'); a.priorities.forEach((t, i) => lines.push(`${i + 1}. ${t}`)); lines.push('') }
  lines.push(`Open the dashboard: ${facts.dashboard}`)
  return lines.join('\n')
}

export function render(role, facts, analysis) {
  const linkMap = buildLinkMap(facts)
  const a = analysis || { headline: 'AI summary unavailable — raw data below.', went_well: [], needs_attention: [], priorities: [], role_sections: [] }
  const preheader = previewText(role, facts, analysis)
  const dateLabel = new Date(`${facts.runDay}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  const failed = Object.entries(facts.sourceStatus || {}).filter(([, v]) => v !== 'ok')
  const isJohn = role === 'john'
  const when = isWeek(facts) ? 'last week' : 'yesterday'
  const body = [
    section(isJohn ? `What went well ${when}` : 'What went well', bullets(a.went_well, linkMap), C.green),
    section(isJohn ? 'What needs attention today' : 'Needs attention', actions(a.needs_attention, linkMap), C.orange),
    section(isJohn ? 'CEO priorities' : 'Your top 3 today', numbered(a.priorities), C.heading),
    ...a.role_sections.map(s => section(s.title, bullets(s.items, linkMap), C.heading)),
    `<tr><td style="padding:14px 24px 0"><div style="border-top:2px dashed ${C.border};padding-top:8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.muted}">Raw data</div></td></tr>`,
    RAW[role](facts),
  ].join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(SUBJECTS[role])}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.bg};opacity:0">${esc(preheader)}${'&nbsp;&zwnj;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;background:#fff;border-radius:16px;border:1px solid ${C.border};overflow:hidden">
  <tr><td style="background:#fff;padding:16px 24px 12px;border-bottom:1px solid ${C.border}">
    <img src="${esc(LOGO_URL)}" alt="Little Giant Marketing" width="150" height="40" style="display:block;width:150px;height:40px;border:0">
  </td></tr>
  <tr><td style="background:${C.green};padding:16px 24px">
    <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#fff;opacity:.9">Daily briefing</div>
    <div style="font-size:22px;font-weight:700;color:#fff;margin-top:4px">${esc(SUBJECTS[role])}</div>
    <div style="font-size:13px;color:#fff;opacity:.9;margin-top:2px">${esc(dateLabel)}${isWeek(facts) ? ` · Monday edition: covers ${esc(facts.period.label)}` : ''}</div>
  </td></tr>
  <tr><td style="padding:20px 24px 4px">
    <p style="margin:0 0 6px;font-size:14px;color:${C.muted}">Good morning, ${esc(GREETING[role])}.</p>
    <p style="margin:0;font-size:17px;font-weight:600;line-height:1.4;color:${C.heading}">${esc(a.headline)}</p>
  </td></tr>
  ${body}
  <tr><td style="padding:18px 24px 22px;font-size:11px;line-height:1.6;color:${C.muted};border-top:1px solid ${C.border}">
    Generated ${esc(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))} CT from the Customer Health data, Stripe, GHL, Freshdesk and the Team AI call analysis.
    <a href="${esc(facts.dashboard)}" style="color:${C.green}">Open the dashboard</a>.
    ${failed.length ? `<br><span style="color:${C.red}">Data sources that failed this run: ${failed.map(([k, v]) => `${esc(k)} (${esc(v)})`).join('; ')}</span>` : ''}
    ${facts.notes?.length ? `<br>${facts.notes.map(esc).join('<br>')}` : ''}
  </td></tr>
</table></td></tr></table></body></html>`
}
