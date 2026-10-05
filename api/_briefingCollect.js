// Daily AI Briefings — fact packs per role.
// Every number in an email is computed here, deterministically, from the loaders in
// api/_briefingSources.js. The AI (api/_briefingAnalyze.js) only picks and explains.
//
// Roles: joe (DM growth) · kevin (sales + follow-up) · rachel (onboarding + retention)
//        inbound (Hope/Jessica/Kylie/Rachel call briefing) · john (CEO roll-up)

import { classifyScore, recommendedAction } from '../src/lib/healthScoreModel.js'
import { upsellTier, suggestAddon } from '../src/lib/healthEngine.js'
import { UPSELL_CALLS_7D, UPSELL_DISMISS_DAYS } from '../src/lib/healthConfig.js'
import {
  loadAccounts, loadStripe, matchBilling, ACTIVE_STRIPE, loadStats, loadHealthHistory, loadDmMap, loadMeetings,
  loadLgmCalls, loadFreshdeskCreated, loadLgmCustomers, loadLgmWonSales, loadUpsellDismissals, loadPreviousSnapshot, loadRecentItems,
  localDay, addDays, dayRange, daysBetween, daysSinceIso, inDays, avg, round2, accountLink, normalizeName, DASHBOARD_URL, reportingPeriod,
} from './_briefingSources.js'

export const ROLES = ['joe', 'kevin', 'rachel', 'inbound', 'john']

// Accounts flagged in the last N days are not repeated unless they changed or are still critical
const NO_REPEAT_DAYS  = 3
const REPEAT_DELTA    = 5
const CRITICAL_SCORE  = 30

const bandLabel = { healthy: 'Green', watch: 'Yellow', at_risk: 'Red', no_data: 'No data' }

// Rep names arrive two ways: "Kevin" from the customer record, "Kevin Wyatt" from the opportunity owner.
// Key everything by first name so the by-rep tables and kevinOwnSales line up.
export const repKey = (name) => {
  const first = String(name || '').trim().split(/\s+/)[0] || ''
  return first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : null
}

// ── Context: load everything once, enrich accounts ───────────────────────────

export async function buildContext(runDay = localDay()) {
  const yesterday = addDays(runDay, -1)
  const period = reportingPeriod(runDay)       // Tue-Fri: yesterday · Monday: the previous 7 days
  const beforePeriod = addDays(period.start, -1) // the day scores are compared against
  const d7  = addDays(runDay, -7)
  const d30 = addDays(runDay, -30)
  // Month-to-date runs through yesterday; on the 1st that means the whole previous month.
  const mtdStart = `${yesterday.slice(0, 7)}-01`

  const jobs = {
    accounts:  loadAccounts(),
    stripe:    loadStripe(),
    stats:     loadStats(),
    history:   loadHealthHistory(addDays(runDay, -8)),
    dmMap:     loadDmMap(),
    meetings:  loadMeetings(),
    lgmCalls:  loadLgmCalls(period.start, period.end),
    freshdesk: loadFreshdeskCreated(dayRange(period.start).start.toISOString()),
    customers: loadLgmCustomers(),
    wonSales:  loadLgmWonSales(),
    upsellDismissed: loadUpsellDismissals(),
  }
  const keys = Object.keys(jobs)
  const settled = await Promise.allSettled(Object.values(jobs))
  const src = {}, sourceStatus = {}
  settled.forEach((r, i) => {
    sourceStatus[keys[i]] = r.status === 'fulfilled' ? 'ok' : `failed: ${r.reason?.message || r.reason}`
    src[keys[i]] = r.status === 'fulfilled' ? r.value : null
  })
  if (!src.accounts) throw new Error(`Cannot build briefings without GHL accounts (${sourceStatus.accounts})`)

  const stats    = src.stats || {}
  const history  = src.history || {}
  const meetings = src.meetings || []
  const dmRows   = src.dmMap || []
  const customers = src.customers || { available: false, bySubAccount: {}, byEmail: {}, byContactId: {} }
  const wonSales  = src.wonSales  || { available: false, sales: [] }
  const dismissed = src.upsellDismissed || {}

  // Meeting rows indexed by customer name and by GHL location id (phone calls carry it in Meeting ID)
  const meetingsByNorm = {}, meetingsByLoc = {}
  for (const m of meetings) {
    if (m.normCustomer) (meetingsByNorm[m.normCustomer] ||= []).push(m)
    if (m.locationId)   (meetingsByLoc[m.locationId]   ||= []).push(m)
  }
  const dmByAgent = Object.fromEntries(dmRows.filter(r => r.agent_ghl_location_id).map(r => [r.agent_ghl_location_id, r]))

  const accounts = src.accounts.map(a => {
    const s = stats[a.ghlId] || null
    const billing = matchBilling(a, src.stripe)
    const score = s?.health_score ?? null
    const warnings = s?.health_parts?.warnings || []
    const band = classifyScore(score)
    const hist = history[a.ghlId] || {}
    const histDays = Object.keys(hist).filter(d => d < runDay).sort()
    const earliest = histDays.find(d => d >= d7) || histDays[0] || null
    const yScore = hist[beforePeriod] ?? hist[addDays(beforePeriod, -1)] ?? null
    const rows = [...(meetingsByNorm[normalizeName(a.ghlName)] || []), ...(meetingsByLoc[a.ghlId] || [])]
      .filter((m, i, arr) => arr.findIndex(x => x.ref === m.ref) === i)
      .sort((x, y) => y.date.localeCompare(x.date))
    const lastMeeting = rows[0] || null
    const onboarding = rows.filter(m => /onboard/i.test(m.category))
    const cust = customers.bySubAccount[a.ghlId] || (a.ghlEmail && customers.byEmail[(a.ghlEmail || '').toLowerCase().trim()]) || (billing?.stripeCustomerId && null) || null
    const soldDay = billing?.stripeStartDate || cust?.soldDate || null
    return {
      soldBy: repKey(cust?.soldBy) || null,
      onboarding: cust ? { preference: cust.onboardingPref, buildOut: cust.buildOut, a2pApprovedAt: cust.a2pApprovedAt, trainingDate: cust.trainingDate, subscriptionStatus: cust.subscriptionStatus, crmStatus: cust.crmStatus, districtOffice: cust.districtOffice, referrer: cust.referrer } : null,
      id: a.ghlId, name: a.ghlName, link: accountLink(a.ghlId), email: a.ghlEmail || null,
      dateAdded: a.ghlDateAdded, daysSinceAdded: a.ghlDateAdded ? daysBetween(a.ghlDateAdded, runDay) : null,
      mrr: billing ? round2(billing.totalRev) : null, stripeStatus: billing?.stripeStatus || null,
      users: billing?.users ?? 0, addOns: billing?.addOns ?? 0, addOnCount: billing?.addOnCount ?? ((billing?.addOns ?? 0) > 0 ? 1 : 0),
      hasLeadFlow: billing?.hasLeadFlow ?? false, hasCallCoach: billing?.hasCallCoach ?? false, addOnNames: (billing?.addOnItems || []).map(x => x.nickname).filter(Boolean),
      planPrice: billing?.planPrice ?? 0, upsellDismissedUntil: dismissed[a.ghlId]?.until || null,
      stripeCustomerId: billing?.stripeCustomerId || null, soldDay, accountType: billing?.accountType || null,
      score, band, bandLabel: bandLabel[band], warnings,
      recommendedAction: recommendedAction({ band, warnings }),
      yesterdayScore: yScore,
      trend7: earliest !== null && score !== null && hist[earliest] !== null ? score - hist[earliest] : null,
      trendFrom: earliest,
      calls7d: s?.calls_7d ?? null, won30d: s?.won_30d ?? null, wonPrior30d: s?.won_prior_30d ?? null,
      tickets7d: s?.tickets_7d ?? null,
      lastCallAt: s?.last_call_date || null, lastSaleAt: s?.last_sale_date || null,
      lastActivityAt: s?.meaningful_activity_at || null,
      daysSinceActivity: daysSinceIso(s?.meaningful_activity_at, runDay),
      syncNote: s?.sync_note || null,
      lastMeeting: lastMeeting ? { date: lastMeeting.date, category: lastMeeting.category, employee: lastMeeting.employee, status: lastMeeting.status, sentiment: lastMeeting.sentiment, summary: (lastMeeting.summary || '').slice(0, 240) } : null,
      onboardingMeetings: onboarding.length,
      lastOnboardingMeeting: onboarding[0] ? { date: onboarding[0].date, status: onboarding[0].status } : null,
      frustratedRecently: rows.some(m => m.frustrated && m.date >= d30),
      dm: dmByAgent[a.ghlId] ? { name: dmByAgent[a.ghlId].dm_name, district: dmByAgent[a.ghlId].district_office || null } : null,
    }
  })

  for (const a of accounts) {
    a.upsellTier = ACTIVE_STRIPE.has(a.stripeStatus || '') ? upsellTier(a) : null
    if (a.upsellTier) { const sg = suggestAddon(a); a.upsellSuggestion = sg.label; a.upsellExtra = sg.estExtra; a.upsellPriority = sg.priority }
  }
  const byId = Object.fromEntries(accounts.map(a => [a.id, a]))
  const byNorm = {}
  for (const a of accounts) { const n = normalizeName(a.name); if (n) (byNorm[n] ||= []).push(a) }
  const byCustomerId = Object.fromEntries(accounts.filter(a => a.stripeCustomerId).map(a => [a.stripeCustomerId, a]))
  const byEmail = {}
  for (const a of accounts) { const e = (a.email || '').toLowerCase().trim(); if (e && !byEmail[e]) byEmail[e] = a }

  // GHL won opportunities → accounts (customer record's Sub-account ID, then email, then name)
  const sales = (wonSales.sales || []).map(w => {
    const cust = w.contactId ? customers.byContactId?.[w.contactId] : null
    const acct = (cust?.subAccountId && byId[cust.subAccountId])
      || (w.contactEmail && byEmail[w.contactEmail])
      || (byNorm[normalizeName(w.contactName)] || [])[0] || null
    const soldBy = repKey(cust?.soldBy) || repKey(w.assignedToName) || null
    if (acct) { acct.soldDay = w.wonDay || acct.soldDay; if (!acct.soldBy && soldBy) acct.soldBy = soldBy; acct.oppValue = w.monetaryValue }
    return {
      ref: acct ? acct.id : `sale:${w.oppId}`, oppId: w.oppId, name: acct ? acct.name : w.contactName || w.oppName,
      link: acct?.link || null, accountId: acct?.id || null, mrr: w.monetaryValue, wonDay: w.wonDay, soldBy: soldBy || 'Unattributed',
      score: acct?.score ?? null, band: acct?.bandLabel || 'No data', warnings: acct?.warnings || [], trend7: acct?.trend7 ?? null,
      stage: w.stageName,
    }
  }).filter(x => x.wonDay)

  return {
    runDay, yesterday, period, beforePeriod, d7, d30, mtdStart, sourceStatus,
    accounts, byId, byNorm, byCustomerId, byEmail, sales, wonSales: { available: wonSales.available, reason: wonSales.reason || null, pipeline: wonSales.pipeline || null, stage: wonSales.stage || null },
    stripe: src.stripe, meetings, meetingsByNorm, dmRows, customers, lgmCalls: src.lgmCalls || { available: false, calls: [] },
    freshdesk: src.freshdesk || { available: false },
    generatedAt: new Date().toISOString(),
  }
}

// ── Shared helpers ───────────────────────────────────────────────────────────

const brief = (a) => ({
  ref: a.id, name: a.name, link: a.link, mrr: a.mrr, score: a.score, band: a.bandLabel, trend7: a.trend7,
  warnings: a.warnings, recommendedAction: a.recommendedAction, daysSinceActivity: a.daysSinceActivity,
  calls7d: a.calls7d, won30d: a.won30d, tickets7d: a.tickets7d, signupDate: a.dateAdded, soldDate: a.soldDay,
  lastMeeting: a.lastMeeting, dm: a.dm?.name || null, soldBy: a.soldBy || null,
  onboarding: a.onboarding ? { buildOut: a.onboarding.buildOut, trainingDate: a.onboarding.trainingDate, a2pApprovedAt: a.onboarding.a2pApprovedAt, subscriptionStatus: a.onboarding.subscriptionStatus, preference: a.onboarding.preference } : null,
})

const scoreAsc  = (x, y) => (x.score ?? 999) - (y.score ?? 999) || (y.mrr ?? 0) - (x.mrr ?? 0)
const scoreDesc = (x, y) => (y.score ?? -1) - (x.score ?? -1) || (y.calls7d ?? 0) - (x.calls7d ?? 0)

function suggestOwner(a) {
  if ((a.tickets7d ?? 0) >= 2) return 'Hope (support)'
  if (a.dm) return 'Joe (via DM relationship)'
  return 'Rachel'
}

function whyAtRisk(a) {
  const parts = [...a.warnings]
  if (a.frustratedRecently) parts.push('frustrated on a recent call')
  if (a.daysSinceActivity !== null && a.daysSinceActivity > 14) parts.push(`no meaningful activity in ${a.daysSinceActivity} days`)
  if (a.trend7 !== null && a.trend7 <= -10) parts.push(`score dropped ${Math.abs(a.trend7)} points this week`)
  return parts.length ? parts.join('; ') : 'Low health score'
}

// Apply the no-repeat rule: skip accounts flagged in the last 3 days unless changed or still critical.
function noRepeat(list, recent, itemType) {
  const fresh = [], repeats = []
  for (const a of list) {
    const prev = recent[`${itemType}:${a.id}`]
    if (!prev) { fresh.push(a); continue }
    const changed = prev.score !== null && a.score !== null && Math.abs(a.score - prev.score) >= REPEAT_DELTA
    const critical = a.score !== null && a.score < CRITICAL_SCORE
    if (changed || critical) fresh.push({ ...a, repeat: true, previouslyFlagged: prev.run_date, previousScore: prev.score })
    else repeats.push(a)
  }
  return { fresh, skipped: repeats.length }
}

// Sales = opportunities marked Won in LGM's GHL Sales Pipeline (Payment Made stage); New MRR = opportunity value.
// Falls back to Stripe subscription starts when the GHL pull is unavailable.
function salesIn(ctx, fromDay, toDay) {
  if (ctx.wonSales?.available) {
    const items = ctx.sales.filter(x => inDays(x.wonDay, fromDay, toDay))
    const newMrr = round2(items.reduce((s, x) => s + (x.mrr || 0), 0))
    const byRep = {}
    for (const x of items) {
      const b = (byRep[x.soldBy || 'Unattributed'] ||= { sales: 0, newMrr: 0, scores: [] })
      b.sales++; b.newMrr = round2(b.newMrr + (x.mrr || 0)); if (typeof x.score === 'number') b.scores.push(x.score)
    }
    for (const b of Object.values(byRep)) { b.avgHealth = avg(b.scores); delete b.scores }
    return { source: 'ghl', sales: items.length, newMrr, avgMrrPerSale: items.length ? round2(newMrr / items.length) : null,
             avgHealth: avg(items.map(x => x.score)), byRep, zeroValue: items.filter(x => !x.mrr).length, items, records: [] }
  }
  const recs = Object.values(ctx.stripe?.byCustomerId || {}).filter(r => inDays(r.stripeStartDate, fromDay, toDay))
  const scores = recs.map(r => ctx.byCustomerId[r.stripeCustomerId]?.score).filter(s => typeof s === 'number')
  const newMrr = round2(recs.reduce((s, r) => s + (r.totalRev || 0), 0))
  const byRep = {}
  for (const r of recs) {
    const rep = ctx.byCustomerId[r.stripeCustomerId]?.soldBy || 'Unattributed'
    const b = (byRep[rep] ||= { sales: 0, newMrr: 0, scores: [] })
    b.sales++; b.newMrr = round2(b.newMrr + (r.totalRev || 0))
    const sc = ctx.byCustomerId[r.stripeCustomerId]?.score; if (typeof sc === 'number') b.scores.push(sc)
  }
  for (const b of Object.values(byRep)) { b.avgHealth = avg(b.scores); delete b.scores }
  return { source: 'stripe', sales: recs.length, newMrr, avgMrrPerSale: recs.length ? round2(newMrr / recs.length) : null, avgHealth: avg(scores), byRep, zeroValue: 0, items: [], records: recs }
}

function demoIsClosed(ctx, m) {
  const cutoff = addDays(m.date, -3)
  const won = ctx.sales.find(x => x.wonDay >= cutoff && normalizeName(x.name) === m.normCustomer)
  if (won) return { id: won.accountId, name: won.name }
  const acct = (ctx.byNorm[m.normCustomer] || []).find(a => (a.dateAdded && a.dateAdded >= cutoff) || (a.soldDay && a.soldDay >= cutoff))
  if (acct) return acct
  const rec = ctx.stripe?.byNormName?.[m.normCustomer]
  return rec && rec.stripeStartDate >= cutoff ? { id: null, name: rec.stripeCustomerName } : null
}

// Upsell opportunities for the Sales briefing (same rule as the dashboard; unflagged accounts hidden 30 days)
function upsellOpportunities(ctx) {
  const all = ctx.accounts.filter(a => a.upsellTier)
  const visible = all.filter(a => !a.upsellDismissedUntil)
  const item = (a) => ({ ref: a.id, name: a.name, link: a.link, priority: a.upsellPriority, calls7d: a.calls7d, users: a.users,
    currentAddOns: [a.hasLeadFlow ? 'LeadFlow AI' : null, a.hasCallCoach ? 'AI Call Coach' : null].filter(Boolean).concat(!a.hasLeadFlow && !a.hasCallCoach ? a.addOnNames : []),
    mrr: a.mrr, suggestion: a.upsellSuggestion, estExtraMrr: a.upsellExtra, score: a.score, band: a.bandLabel, dm: a.dm?.name || null, soldBy: a.soldBy })
  const byCalls = (x, y) => (y.calls7d ?? 0) - (x.calls7d ?? 0)
  return {
    rule: `${UPSELL_CALLS_7D}+ calls in the past 7 days; no add-ons = upsell, exactly one add-on = high priority. Unflagged accounts are hidden for ${UPSELL_DISMISS_DAYS} days.`,
    highPriority: visible.filter(a => a.upsellTier === 'high').sort(byCalls).map(item),
    standard: visible.filter(a => a.upsellTier === 'upsell').sort(byCalls).map(item),
    hiddenUnflagged: all.length - visible.length,
    potentialMrr: round2(visible.reduce((s, a) => s + (a.upsellExtra || 0), 0)),
  }
}

// New clients grouped by account age (John, 2026-10-05) — for Client Coordinators and Client Relations
const COHORTS = [[5, 9], [10, 15], [16, 30], [31, 60]]
function newClientCohorts(ctx) {
  return COHORTS.map(([from, to]) => {
    const list = ctx.accounts.filter(a => a.daysSinceAdded !== null && a.daysSinceAdded >= from && a.daysSinceAdded <= to)
      .sort((x, y) => (x.score ?? 999) - (y.score ?? 999))
    return {
      label: `${from}–${to} days old`, from, to, count: list.length, avgHealth: avg(list.map(a => a.score)),
      red: list.filter(a => a.band === 'at_risk').length, noData: list.filter(a => a.score === null).length,
      accounts: list.map(a => ({ ref: a.id, name: a.name, link: a.link, ageDays: a.daysSinceAdded, score: a.score, band: a.bandLabel, trend7: a.trend7, calls7d: a.calls7d, mrr: a.mrr, soldBy: a.soldBy,
        onboarding: a.onboarding ? [a.onboarding.buildOut, a.onboarding.trainingDate ? `training ${a.onboarding.trainingDate}` : 'no training date', a.onboarding.a2pApprovedAt ? 'A2P ok' : 'A2P pending'].filter(Boolean).join(' · ') : (a.onboardingMeetings ? `onboarding meeting ${a.lastOnboardingMeeting?.date}` : 'no onboarding record'),
        lastMeeting: a.lastMeeting ? `${a.lastMeeting.date} ${a.lastMeeting.category}` : null })),
    }
  })
}

// ── Role: Rachel ─────────────────────────────────────────────────────────────

export async function collectRachel(ctx) {
  const recent = await loadRecentItems('rachel', addDays(ctx.runDay, -NO_REPEAT_DAYS), ctx.runDay)
  const isNew30 = (a) => a.dateAdded && inDays(a.dateAdded, ctx.d30, ctx.yesterday)
  const new30 = ctx.accounts.filter(isNew30).sort((x, y) => y.dateAdded.localeCompare(x.dateAdded))
  const new7  = new30.filter(a => a.dateAdded >= ctx.d7)

  const onboardingStatus = (a) => {
    const o = a.onboarding
    if (o && (o.buildOut || o.trainingDate || o.subscriptionStatus)) {
      const parts = []
      if (o.buildOut) parts.push(o.buildOut)
      if (o.trainingDate) parts.push(`training ${o.trainingDate}${o.trainingDate > ctx.yesterday ? ' (scheduled)' : ''}`)
      else parts.push('no training date set')
      if (o.a2pApprovedAt) parts.push(`A2P approved ${o.a2pApprovedAt}`); else parts.push('A2P not approved')
      if (o.subscriptionStatus && o.subscriptionStatus !== 'Active') parts.push(o.subscriptionStatus)
      return parts.join(' · ')
    }
    if (a.lastOnboardingMeeting) return `Onboarding call held ${a.lastOnboardingMeeting.date}${a.lastOnboardingMeeting.status ? ` (${a.lastOnboardingMeeting.status})` : ''}`
    if ((a.calls7d ?? 0) > 0) return 'Using the platform, no onboarding meeting recorded'
    return 'No onboarding meeting recorded yet'
  }
  const newAccounts = new30.map(a => ({
    ...brief(a), onboardingStatus: onboardingStatus(a), onboardingMeetings: a.onboardingMeetings,
    lastActivityAt: a.lastActivityAt, frustratedRecently: a.frustratedRecently, syncNote: a.syncNote,
  }))

  const scored = new30.filter(a => a.score !== null)
  const mostSuccessful = [...scored].filter(a => a.band !== 'at_risk').sort(scoreDesc).slice(0, 5).map(brief)
  const atRiskNewRaw = [...new30].filter(a => a.band === 'at_risk' || a.score === null || (a.tickets7d ?? 0) >= 2 || a.frustratedRecently)
    .sort(scoreAsc)
  const atRiskNew = atRiskNewRaw.slice(0, 5).map(a => ({ ...brief(a), why: a.score === null ? `No GHL activity data yet${a.syncNote ? ` (${a.syncNote})` : ''}` : whyAtRisk(a), onboardingStatus: onboardingStatus(a) }))

  const overallRaw = ctx.accounts.filter(a => a.band === 'at_risk' && ACTIVE_STRIPE.has(a.stripeStatus || 'active')).sort(scoreAsc)
  const { fresh, skipped } = noRepeat(overallRaw, recent, 'at_risk')
  const overall = fresh.slice(0, 5).map(a => ({ ...brief(a), why: whyAtRisk(a), suggestedOwner: suggestOwner(a), repeat: !!a.repeat, previouslyFlagged: a.previouslyFlagged || null, previousScore: a.previousScore ?? null }))

  const scoreOf = (list) => avg(list.map(a => a.score))
  return {
    role: 'rachel', runDay: ctx.runDay, yesterday: ctx.yesterday, period: ctx.period, dashboard: DASHBOARD_URL,
    stats: {
      past7Days:  { newClients: new7.length,  avgHealth: scoreOf(new7) },
      past30Days: { newClients: new30.length, avgHealth: scoreOf(new30) },
      totalRedAccounts: overallRaw.length, atRiskSkippedAsRepeats: skipped,
    },
    newAccounts, newClientCohorts: newClientCohorts(ctx), mostSuccessfulNew: mostSuccessful, mostAtRiskNew: atRiskNew, topAtRiskOverall: overall,
    changesSinceYesterday: ctx.accounts.filter(a => a.yesterdayScore !== null && a.score !== null && Math.abs(a.score - a.yesterdayScore) >= 10)
      .sort((x, y) => (x.score - x.yesterdayScore) - (y.score - y.yesterdayScore)).slice(0, 10)
      .map(a => ({ ref: a.id, name: a.name, link: a.link, from: a.yesterdayScore, to: a.score })),
    items: overall.map(a => ({ account_id: a.ref, item_type: 'at_risk', score: a.score, reason: a.why })),
    sourceStatus: ctx.sourceStatus,
  }
}

// ── Role: Kevin ──────────────────────────────────────────────────────────────

export function collectKevin(ctx) {
  const windows = {
    yesterday:  salesIn(ctx, ctx.period.start, ctx.period.end),
    past7Days:  salesIn(ctx, ctx.d7, ctx.yesterday),
    mtd:        salesIn(ctx, ctx.mtdStart, ctx.yesterday),
    past30Days: salesIn(ctx, ctx.d30, ctx.yesterday),
  }
  const table = Object.fromEntries(Object.entries(windows).map(([k, v]) => [k, { sales: v.sales, newMrr: v.newMrr, avgMrrPerSale: v.avgMrrPerSale, avgHealth: v.avgHealth, byRep: v.byRep }]))
  const kevinOwn = Object.fromEntries(Object.entries(windows).map(([k, v]) => [k, v.byRep.Kevin || { sales: 0, newMrr: 0, avgHealth: null }]))

  // Demos = Sales-category meetings in the last 14 days, latest row per prospect
  const d14 = addDays(ctx.runDay, -14)
  const salesRows = ctx.meetings.filter(m => /sales/i.test(m.category) && m.date >= d14 && m.date <= ctx.yesterday)
  const byProspect = {}
  for (const m of salesRows) if (!byProspect[m.normCustomer] || m.date > byProspect[m.normCustomer].date) byProspect[m.normCustomer] = m
  const openFollowUps = [], closedRecently = []
  for (const m of Object.values(byProspect)) {
    const closed = demoIsClosed(ctx, m)
    const entry = {
      ref: `demo:${m.normCustomer}`, prospect: m.customer, demoDate: m.date, source: m.callType, rep: m.employee,
      status: m.status, sentiment: m.sentiment, riskLevel: m.riskLevel, followUpDate: m.promisedDeadline || null,
      followUpOwner: m.followUpOwner || null, actionItems: m.actionItems, redFlags: m.redFlags,
      summary: (m.summary || '').slice(0, 400), daysSinceDemo: daysBetween(m.date, ctx.runDay),
    }
    if (closed) closedRecently.push({ ...entry, closedAs: closed.name, accountRef: closed.id })
    else if (!/resolved/i.test(m.status)) openFollowUps.push({ ...entry, suggestedPriority: /high/i.test(m.riskLevel) || /action required/i.test(m.status) ? 'High' : entry.daysSinceDemo > 7 ? 'Low' : 'Medium' })
  }
  openFollowUps.sort((x, y) => y.demoDate.localeCompare(x.demoDate))

  const recentSales = ctx.wonSales.available
    ? ctx.sales.filter(x => inDays(x.wonDay, ctx.d30, ctx.yesterday)).sort((x, y) => y.wonDay.localeCompare(x.wonDay)).map(x => {
        const a = x.accountId ? ctx.byId[x.accountId] : null
        return a
          ? { ...brief(a), mrr: x.mrr, soldDate: x.wonDay, soldBy: x.soldBy, concern: a.band === 'at_risk' ? whyAtRisk(a) : a.band === 'watch' ? a.warnings.join('; ') || 'Watch band' : null }
          : { ref: x.ref, name: x.name, link: null, mrr: x.mrr, score: null, band: 'No data', trend7: null, warnings: [], soldDate: x.wonDay, soldBy: x.soldBy, concern: 'No linked sub-account yet (Sub-account ID missing on the LGM customer record)' }
      })
    : ctx.accounts.filter(a => a.soldDay && inDays(a.soldDay, ctx.d30, ctx.yesterday))
    .sort((x, y) => y.soldDay.localeCompare(x.soldDay))
    .map(a => ({ ...brief(a), concern: a.band === 'at_risk' ? whyAtRisk(a) : a.band === 'watch' ? a.warnings.join('; ') || 'Watch band' : null }))

  return {
    role: 'kevin', runDay: ctx.runDay, yesterday: ctx.yesterday, period: ctx.period, dashboard: DASHBOARD_URL,
    salesTable: table,
    kevinOwnSales: kevinOwn,
    salesSource: windows.past30Days.source,
    notes: [
      windows.past30Days.source === 'ghl'
        ? `Sales = opportunities marked Won in the GHL Sales Pipeline${ctx.wonSales.stage ? ` (${ctx.wonSales.stage.name})` : ''}; New MRR = the opportunity value.`
        : `GHL won opportunities unavailable this run (${ctx.wonSales.reason || 'unknown'}); sales fall back to Stripe subscription starts.`,
      windows.past30Days.zeroValue ? `${windows.past30Days.zeroValue} of the last 30 days' sales have no opportunity value in GHL and count as $0 new MRR.` : null,
      'Rep = "New Customer Signed Up By" on the LGM customer record, else the opportunity owner.',
    ].filter(Boolean),
    demosHeld: { yesterday: salesRows.filter(m => inDays(m.date, ctx.period.start, ctx.period.end) && m.callType === 'Meeting').length, past7Days: salesRows.filter(m => m.date >= ctx.d7 && m.callType === 'Meeting').length },
    openDemoFollowUps: openFollowUps.slice(0, 15),
    recentlyClosed: closedRecently.slice(0, 10),
    recentSalesHealth: recentSales.slice(0, 20),
    upsellOpportunities: upsellOpportunities(ctx),
    sourceStatus: ctx.sourceStatus,
  }
}

// ── Role: Joe ────────────────────────────────────────────────────────────────

export function collectJoe(ctx) {
  const groups = {}
  for (const r of ctx.dmRows) {
    const dmName = (r.dm_name || '').trim()
    if (!dmName) continue
    const g = (groups[dmName] ||= { dm: dmName, dmLocationId: r.dm_ghl_location_id || null, district: r.district_office || null, agents: [] })
    const a = r.agent_ghl_location_id ? ctx.byId[r.agent_ghl_location_id] : null
    g.agents.push(a ? { ...brief(a), active: ACTIVE_STRIPE.has(a.stripeStatus || '') || (a.stripeStatus === null && a.score !== null) }
                    : { ref: r.agent_ghl_location_id || `dm-agent:${r.id}`, name: r.agent_name || 'Unknown agent', mrr: r.monthly_revenue ? Number(r.monthly_revenue) : null, score: null, band: 'No data', active: false, signupDate: null, link: null })
  }
  const dms = Object.values(groups).map(g => {
    const active = g.agents.filter(a => a.active)
    const lastSignup = g.agents.map(a => a.signupDate).filter(Boolean).sort().at(-1) || null
    const dmAcct = g.dmLocationId ? ctx.byId[g.dmLocationId] : null
    return {
      ref: g.dmLocationId || `dm:${g.dm}`, dm: g.dm, district: g.district, link: dmAcct?.link || null,
      activeAgents: active.length, totalAgents: g.agents.length,
      totalMrr: round2(active.reduce((s, a) => s + (a.mrr || 0), 0)),
      lastAgentSignup: lastSignup, daysSinceLastSignup: lastSignup ? daysBetween(lastSignup, ctx.runDay) : null,
      avgHealth: avg(active.map(a => a.score)), avgTrend7: avg(active.map(a => a.trend7)),
      redAgents: active.filter(a => a.band === 'Red').length,
      agents: g.agents.map(a => ({ ref: a.ref, name: a.name, link: a.link, mrr: a.mrr, score: a.score, band: a.band, signupDate: a.signupDate, active: a.active })),
    }
  })
  const dormant = dms.filter(d => d.activeAgents >= 4 && d.daysSinceLastSignup !== null && d.daysSinceLastSignup > 30).sort((x, y) => y.totalMrr - x.totalMrr)
  const newAgents = []
  for (const d of dms) for (const a of d.agents) if (a.signupDate && inDays(a.signupDate, ctx.d7, ctx.yesterday)) {
    const full = ctx.byId[a.ref]
    newAgents.push({ ...a, dm: d.dm, warnings: full?.warnings || [], calls7d: full?.calls7d ?? null, lastMeeting: full?.lastMeeting || null,
      signal: full ? (full.band === 'healthy' ? 'early success: healthy score' : full.band === 'at_risk' ? `early warning: ${whyAtRisk(full)}` : full.score === null ? 'no activity data yet' : 'watch') : 'no data' })
  }
  const weakening = dms.filter(d => d.activeAgents > 0 && ((d.avgHealth !== null && d.avgHealth < 55) || (d.avgTrend7 !== null && d.avgTrend7 <= -5)))
    .sort((x, y) => (x.avgHealth ?? 999) - (y.avgHealth ?? 999))
  return {
    role: 'joe', runDay: ctx.runDay, yesterday: ctx.yesterday, period: ctx.period, dashboard: DASHBOARD_URL,
    dmDataAvailable: ctx.dmRows.length > 0,
    notes: ctx.dmRows.length ? [] : ['The DM → agent mapping table (dm_agent_map) is empty, so DM groupings cannot be computed yet. The n8n hourly DM sync needs to populate it.'],
    totals: { dms: dms.length, agentsMapped: ctx.dmRows.length },
    dormantHighValueDms: dormant, newAgentsPast7Days: newAgents, weakeningDistricts: weakening,
    allDms: dms.sort((x, y) => y.totalMrr - x.totalMrr).slice(0, 40),
    sourceStatus: ctx.sourceStatus,
  }
}

// ── Role: Inbound calls ──────────────────────────────────────────────────────

export function collectInbound(ctx) {
  const calls = ctx.lgmCalls.calls || []
  const inbound = calls.filter(c => c.direction === 'inbound')
  const answered = inbound.filter(c => c.outcome === 'answered')
  const missed = inbound.filter(c => c.outcome === 'missed' || c.outcome === 'voicemail')
  // Missed calls with no answered call from the same contact later that day
  const needFollowUp = missed.filter(m => !inbound.some(c => c.contactId && c.contactId === m.contactId && c.outcome === 'answered' && c.at > m.at) && !calls.some(c => c.direction === 'outbound' && c.contactId && c.contactId === m.contactId && c.outcome === 'answered' && c.at > m.at))
    .filter((m, i, arr) => arr.findIndex(x => x.contactId ? x.contactId === m.contactId : x.id === m.id) === i)

  const phoneRows = ctx.meetings.filter(m => m.callType === 'Phone Call' && inDays(m.date, ctx.period.start, ctx.period.end) && m.employee && !/^none$/i.test(m.employee))
  const breakdown = phoneRows.map(m => ({
    ref: m.ref, customer: m.customer, employee: m.employee, date: m.date, time: m.time, durationMin: m.durationMin,
    reason: m.category, result: m.status, verdict: m.verdict, sentiment: m.sentiment, riskLevel: m.riskLevel,
    followUpNeeded: !/resolved/i.test(m.status), owner: m.followUpOwner || m.employee,
    summary: (m.summary || '').slice(0, 400), actionItems: m.actionItems, redFlags: m.redFlags, frustrated: m.frustrated,
    accountRef: m.locationId && ctx.byId[m.locationId] ? m.locationId : null, link: m.locationId && ctx.byId[m.locationId] ? ctx.byId[m.locationId].link : null,
  }))
  const week = ctx.meetings.filter(m => m.callType === 'Phone Call' && m.date >= ctx.d7 && m.date <= ctx.yesterday)
  const counts = {}
  for (const m of week) counts[m.normCustomer] = (counts[m.normCustomer] || 0) + 1
  const repeatCallers = Object.entries(counts).filter(([, n]) => n >= 2).map(([norm, n]) => {
    const rows = week.filter(m => m.normCustomer === norm).sort((x, y) => y.date.localeCompare(x.date))
    return { customer: rows[0].customer, calls7d: n, lastReason: rows[0].category, lastStatus: rows[0].status, lastSummary: (rows[0].summary || '').slice(0, 200) }
  }).sort((x, y) => y.calls7d - x.calls7d).slice(0, 10)

  return {
    role: 'inbound', runDay: ctx.runDay, yesterday: ctx.yesterday, period: ctx.period, dashboard: DASHBOARD_URL,
    stats: {
      available: ctx.lgmCalls.available, reason: ctx.lgmCalls.reason || null,
      totalInbound: inbound.length, answered: answered.length, missed: missed.length,
      voicemails: inbound.filter(c => c.outcome === 'voicemail').length,
      answerRatePct: inbound.length ? Math.round((answered.length / inbound.length) * 100) : null,
      avgTimeToAnswerSec: null, longestTimeToAnswerSec: null,
      missedRequiringFollowUp: needFollowUp.length,
      avgAnsweredDurationSec: answered.length ? Math.round(answered.reduce((s, c) => s + c.durationSec, 0) / answered.length) : null,
      outboundCalls: calls.filter(c => c.direction === 'outbound').length,
    },
    notes: [
      'Time-to-answer is not available: GHL only reports call start and duration, not ring time. It will appear once the n8n call tracker stores ring timestamps.',
      'Call breakdown comes from the Team AI call analysis sheet (transcribed calls only).',
      ctx.period.kind === 'week' ? 'Monday edition: stats and calls cover the whole previous week.' : null,
    ].filter(Boolean),
    missedCallsNeedingFollowUp: needFollowUp.map(c => ({ ref: c.ref, caller: c.contactName, time: c.timeLocal, outcome: c.outcome })),
    callBreakdown: breakdown,
    newClientCohorts: newClientCohorts(ctx),
    unresolvedCalls: breakdown.filter(b => b.followUpNeeded),
    repeatCallers,
    concerningSentiment: breakdown.filter(b => b.frustrated || /frustrat|confus|angry|upset/i.test(b.sentiment) || /high/i.test(b.riskLevel)),
    sourceStatus: ctx.sourceStatus,
  }
}

// ── Role: John (roll-up) ─────────────────────────────────────────────────────

export async function collectJohn(ctx, packs) {
  const prev = await loadPreviousSnapshot('_stripe', ctx.runDay)
  const today = {}
  for (const r of Object.values(ctx.stripe?.byCustomerId || {})) today[r.stripeCustomerId] = { mrr: r.totalRev || 0, active: ACTIVE_STRIPE.has(r.stripeStatus), name: r.stripeCustomerName }
  let expansion = null, churned = null, churnedAccounts = [], expandedAccounts = []
  if (prev?.facts) {
    expansion = 0; churned = 0
    for (const [cid, p] of Object.entries(prev.facts)) {
      const t = today[cid]
      if (p.active && (!t || !t.active)) { churned += p.mrr; churnedAccounts.push({ name: p.name, mrr: p.mrr, ref: ctx.byCustomerId[cid]?.id || null, link: ctx.byCustomerId[cid]?.link || null }) }
      else if (p.active && t?.active && t.mrr > p.mrr + 0.5) { expansion += t.mrr - p.mrr; expandedAccounts.push({ name: t.name, from: p.mrr, to: t.mrr, ref: ctx.byCustomerId[cid]?.id || null, link: ctx.byCustomerId[cid]?.link || null }) }
    }
    expansion = round2(expansion); churned = round2(churned)
  }
  const y = salesIn(ctx, ctx.period.start, ctx.period.end), w = salesIn(ctx, ctx.d7, ctx.yesterday), m = salesIn(ctx, ctx.mtdStart, ctx.yesterday)
  const kevin = packs.kevin, rachel = packs.rachel, inbound = packs.inbound, joe = packs.joe

  const d30rows = ctx.meetings.filter(x => /sales/i.test(x.category) && x.callType === 'Meeting' && x.date >= ctx.d30 && x.date <= ctx.yesterday)
  const prospects = {}
  for (const r of d30rows) prospects[r.normCustomer] = r
  const demos30 = Object.values(prospects)
  const closed30 = demos30.filter(r => demoIsClosed(ctx, r)).length

  const scored = ctx.accounts.filter(a => a.score !== null)
  const bands = { red: scored.filter(a => a.band === 'at_risk').length, yellow: scored.filter(a => a.band === 'watch').length, green: scored.filter(a => a.band === 'healthy').length, noData: ctx.accounts.length - scored.length }
  const movedInto = ctx.accounts.filter(a => a.band === 'at_risk' && a.yesterdayScore !== null && classifyScore(a.yesterdayScore) !== 'at_risk')
  const improved = ctx.accounts.filter(a => a.yesterdayScore !== null && a.score !== null && a.score - a.yesterdayScore >= 10).sort((p, q) => (q.score - q.yesterdayScore) - (p.score - p.yesterdayScore))
  const deteriorated = ctx.accounts.filter(a => a.yesterdayScore !== null && a.score !== null && a.yesterdayScore - a.score >= 10).sort((p, q) => (q.yesterdayScore - q.score) - (p.yesterdayScore - p.score))
  const mv = (a) => ({ ref: a.id, name: a.name, link: a.link, from: a.yesterdayScore, to: a.score, mrr: a.mrr })

  const new30 = ctx.accounts.filter(a => a.dateAdded && inDays(a.dateAdded, ctx.d30, ctx.yesterday))
  const stuckReasons = (a) => {
    const o = a.onboarding
    const out = []
    if (o) {
      if (o.buildOut && !/ready/i.test(o.buildOut)) out.push(`account build-out: ${o.buildOut}`)
      if (!o.trainingDate) out.push('no training date set')
      if (!o.a2pApprovedAt) out.push('A2P not approved')
      if (o.subscriptionStatus && /pending/i.test(o.subscriptionStatus)) out.push(o.subscriptionStatus)
    } else if (a.onboardingMeetings === 0) out.push('no onboarding meeting recorded')
    if ((a.calls7d ?? 0) === 0) out.push('no calls in 7 days (platform not in use)')
    if (a.score === null) out.push('no GHL activity data')
    return out
  }
  const stuck = new30.filter(a => a.daysSinceAdded >= 7 && stuckReasons(a).length).map(a => ({ ...brief(a), missing: stuckReasons(a) }))
  const escalations = ctx.meetings.filter(x => inDays(x.date, ctx.period.start, ctx.period.end) && (/escalat/i.test(x.status) || x.frustrated)).map(x => ({ ref: x.ref, customer: x.customer, employee: x.employee, status: x.status, summary: (x.summary || '').slice(0, 240) }))

  return {
    role: 'john', runDay: ctx.runDay, yesterday: ctx.yesterday, period: ctx.period, dashboard: DASHBOARD_URL,
    revenue: {
      salesYesterday: y.sales, salesPast7Days: w.sales, salesMtd: m.sales,
      newMrrYesterday: y.newMrr, newMrrPast7Days: w.newMrr, newMrrMtd: m.newMrr,
      expansionMrrSinceYesterday: expansion, churnedMrrSinceYesterday: churned,
      netNewMrrSinceYesterday: expansion === null ? null : round2(y.newMrr + expansion - churned),
      churnedAccounts: churnedAccounts.slice(0, 10), expandedAccounts: expandedAccounts.slice(0, 10),
      totalActiveMrr: round2(Object.values(today).filter(t => t.active).reduce((s, t) => s + t.mrr, 0)),
      activeCustomers: Object.values(today).filter(t => t.active).length,
      salesSource: y.source,
      note: `${y.source === 'ghl' ? 'Sales and New MRR = opportunities marked Won in the GHL Sales Pipeline (opportunity value).' : 'Sales fall back to Stripe subscription starts this run.'} Active MRR, expansion and churn come from Stripe${prev ? `, compared with the ${prev.run_date} snapshot` : ' (expansion/churn appear from the next briefing)'}.`,
    },
    sales: {
      demosHeldYesterday: kevin.demosHeld.yesterday, demosHeldPast7Days: kevin.demosHeld.past7Days,
      demosPast30Days: demos30.length, closedPast30Days: closed30, closeRatePct: demos30.length ? Math.round((closed30 / demos30.length) * 100) : null,
      avgMrrPerSalePast30Days: kevin.salesTable.past30Days.avgMrrPerSale,
      byRepPast30Days: kevin.salesTable.past30Days.byRep, byRepMtd: kevin.salesTable.mtd.byRep,
      upsell: { highPriority: kevin.upsellOpportunities.highPriority.length, standard: kevin.upsellOpportunities.standard.length, potentialMrr: kevin.upsellOpportunities.potentialMrr, top: kevin.upsellOpportunities.highPriority.slice(0, 5) },
      importantLostDemos: kevin.openDemoFollowUps.filter(d => d.suggestedPriority === 'High').slice(0, 5),
      biggestOpportunities: kevin.openDemoFollowUps.filter(d => /interest|engaged|happy/i.test(d.sentiment)).slice(0, 5),
    },
    customerHealth: {
      avgHealth: avg(scored.map(a => a.score)), bands,
      newAtRiskSinceYesterday: movedInto.map(mv), improved: improved.slice(0, 8).map(mv), deteriorated: deteriorated.slice(0, 8).map(mv),
      top5AtRisk: rachel.topAtRiskOverall.slice(0, 5),
    },
    onboarding: {
      newCustomersPast7Days: rachel.stats.past7Days.newClients, newCustomersPast30Days: rachel.stats.past30Days.newClients,
      avgHealthNewPast30Days: rachel.stats.past30Days.avgHealth,
      stuckInOnboarding: stuck.slice(0, 10), mostAtRiskNew: rachel.mostAtRiskNew.slice(0, 5), mostSuccessfulNew: rachel.mostSuccessfulNew.slice(0, 3),
    },
    customerActivity: {
      inboundCalls: inbound.stats.totalInbound, answered: inbound.stats.answered, missedCalls: inbound.stats.missed, answerRatePct: inbound.stats.answerRatePct,
      callDataAvailable: inbound.stats.available,
      meetingsYesterday: ctx.meetings.filter(x => inDays(x.date, ctx.period.start, ctx.period.end) && x.callType === 'Meeting').length,
      analysedCallsYesterday: ctx.meetings.filter(x => inDays(x.date, ctx.period.start, ctx.period.end) && x.callType === 'Phone Call').length,
      supportTicketsYesterday: ctx.freshdesk.available ? ctx.freshdesk.created : null, urgentTicketsYesterday: ctx.freshdesk.available ? ctx.freshdesk.urgent : null,
      escalations,
    },
    districtManagers: {
      dataAvailable: joe.dmDataAvailable, dms: joe.totals.dms,
      newAgentsPast7Days: joe.newAgentsPast7Days.slice(0, 10), dormantHighValueDms: joe.dormantHighValueDms.slice(0, 5), weakeningDistricts: joe.weakeningDistricts.slice(0, 5),
    },
    sourceStatus: ctx.sourceStatus,
    _stripeSnapshot: today,
  }
}

// ── Orchestration ────────────────────────────────────────────────────────────

export async function collectAll(ctx, roles = ROLES) {
  const packs = {}
  packs.rachel  = await collectRachel(ctx)
  packs.kevin   = collectKevin(ctx)
  packs.joe     = collectJoe(ctx)
  packs.inbound = collectInbound(ctx)
  packs.john    = await collectJohn(ctx, packs)
  return Object.fromEntries(roles.map(r => [r, packs[r]]))
}
