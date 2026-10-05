// Vercel serverless function — fetches all active Stripe subscriptions for LGM.
// Expands customer inline to avoid N+1 calls.
// Returns { byEmail, byPhone, byNormName } lookup maps for the frontend to merge with GHL data.
//
// Env var required: STRIPE_SECRET_KEY (set in Vercel project settings)

const STRIPE_BASE = 'https://api.stripe.com/v1'

// Normalize company name for fuzzy matching — must mirror useMergedHealthData.js exactly
export function normalizeName(n) {
  return (n || '')
    .toLowerCase()
    .replace(/'s\b/g, '')
    .replace(/\b(llc|inc|corp|ltd|l\.l\.c\.|incorporated|limited|company|the|agency|marketing|services|group|associates|account|insurance|at)\b\.?/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Add-on products (John, 2026-10-05): LeadFlow AI ($50/mo) and AI Call Coach ($50/user/mo).
// Detected from the Stripe price nickname; addOnItems is returned so the names can be verified.
export const ADD_ON_PATTERNS = { leadFlow: /lead\s*flow/i, callCoach: /call\s*coach|ai\s*assistant|coach/i }
export function addOnFlags(items) {
  const hasLeadFlow  = items.some(i => ADD_ON_PATTERNS.leadFlow.test(i.nickname))
  const hasCallCoach = items.some(i => ADD_ON_PATTERNS.callCoach.test(i.nickname))
  const addOnCount   = ((hasLeadFlow ? 1 : 0) + (hasCallCoach ? 1 : 0)) || (items.length ? 1 : 0)
  return { addOnItems: items, hasLeadFlow, hasCallCoach, addOnCount }
}

// Normalize phone to 10 digits (strip country code if present)
export function normalizePhone(p) {
  const d = (p || '').replace(/\D/g, '')
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d
}

async function stripeGet(path, key) {
  const encoded = Buffer.from(`${key}:`).toString('base64')
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    headers: { Authorization: `Basic ${encoded}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Stripe ${path} → HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function fetchAllSubscriptions(key) {
  const all = []
  let startingAfter = null

  while (true) {
    // 'all' includes active, trialing, past_due, unpaid, paused — excludes nothing.
    // Without this, Stripe defaults to active only and past_due accounts disappear.
    const params = new URLSearchParams({ limit: '100', status: 'all', 'expand[]': 'data.customer' })
    if (startingAfter) params.set('starting_after', startingAfter)

    const page = await stripeGet(`/subscriptions?${params}`, key)
    const batch = page.data || []
    all.push(...batch)
    if (!page.has_more || batch.length === 0) break
    startingAfter = batch[batch.length - 1].id
  }

  return all
}

// Returns a Set of Stripe customer IDs that have at least one open invoice
// with amount_remaining > 0. These are "active" subs that still owe money.
async function fetchOpenInvoiceCustomerIds(key) {
  const customerIds = new Set()
  let startingAfter = null

  while (true) {
    const params = new URLSearchParams({ limit: '100', status: 'open' })
    if (startingAfter) params.set('starting_after', startingAfter)

    const page = await stripeGet(`/invoices?${params}`, key)
    const batch = page.data || []

    for (const inv of batch) {
      if (Number(inv.amount_remaining || 0) <= 0) continue
      const customerId = typeof inv.customer === 'string'
        ? inv.customer
        : inv.customer?.id || ''
      if (customerId) customerIds.add(customerId)
    }

    if (!page.has_more || batch.length === 0) break
    startingAfter = batch[batch.length - 1].id
  }

  return customerIds
}

// Priority used when a customer has multiple subscriptions — prefer active over trialing
const STATUS_PRIORITY = { active: 0, trialing: 1, past_due: 2, unpaid: 2, paused: 3, canceled: 4 }

// Shared by the HTTP handler below and the daily briefing job (api/_briefingSources.js).
export async function buildStripeBilling(key) {
    const [allSubs, openInvoiceCustomerIds] = await Promise.all([
      fetchAllSubscriptions(key),
      fetchOpenInvoiceCustomerIds(key),
    ])

    // Group subscriptions by customer — email as primary key, customer ID as fallback
    // for customers with no email (e.g. district offices) so manual overrides can find them.
    const subsByEmail = {}
    const subsByCustomerId = {} // customers with no email
    for (const sub of allSubs) {
      const cust = sub.customer
      if (typeof cust !== 'object' || !cust?.id) continue
      if (cust.email) {
        const email = cust.email.toLowerCase().trim()
        if (!subsByEmail[email]) subsByEmail[email] = { customer: cust, subs: [] }
        subsByEmail[email].subs.push(sub)
      } else {
        if (!subsByCustomerId[cust.id]) subsByCustomerId[cust.id] = { customer: cust, subs: [] }
        subsByCustomerId[cust.id].subs.push(sub)
      }
    }

    // Build per-email billing summary
    const byEmail = {}
    const byCustomerIdNoEmail = {} // billing records for email-less customers

    for (const [email, { customer, subs }] of Object.entries(subsByEmail)) {
      let planPrice = 0
      let planNickname = ''
      let planInterval = 'month'
      let monthlyUserSub = 0
      let addOns = 0
      const addOnItems = []
      let userCount = 0
      let primaryStatus = 'canceled'
      let primarySubId = null
      let startDate = null
      let canceledAt = null

      for (const sub of subs) {
        // Track the highest-priority (best) status across all subscriptions
        if ((STATUS_PRIORITY[sub.status] ?? 9) < (STATUS_PRIORITY[primaryStatus] ?? 9)) {
          primaryStatus = sub.status
          primarySubId = sub.id
        }

        // Earliest subscription start = when this client first paid us
        const subDate = new Date(sub.created * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
        if (!startDate || subDate < startDate) startDate = subDate

        for (const item of sub.items?.data || []) {
          const plan = item.plan || {}
          const amtDollars = (plan.amount || 0) / 100
          const qty = item.quantity || 0
          if (qty === 0 || amtDollars === 0) continue

          const interval = plan.interval || 'month'
          const nick = (plan.nickname || '').toLowerCase()
          // Convert to monthly equivalent for consistent math
          const monthlyEquiv = interval === 'month' ? amtDollars : amtDollars / 12

          if (nick.includes('additional user') || nick.includes('user seat') || nick.includes('@ 64')) {
            monthlyUserSub += monthlyEquiv * qty
            userCount += qty
          } else if (
            nick.includes('leadflow') ||
            nick.includes('ai assistant') ||
            nick.includes('add-on') ||
            nick.includes('addon')
          ) {
            addOns += monthlyEquiv * qty
            addOnItems.push({ nickname: plan.nickname || '', qty, monthly: Math.round(monthlyEquiv * qty * 100) / 100 })
          } else {
            // Base plan — keep the highest-value one if there are multiple
            if (monthlyEquiv > planPrice) {
              planPrice = monthlyEquiv
              planNickname = plan.nickname || ''
              planInterval = interval
            }
          }
        }
      }

      const totalRev = planPrice + monthlyUserSub + addOns

      // canceledAt — ISO date if primary subscription is cancelled, else null
      const primarySub = subs.find(s => s.id === primarySubId) ?? subs[0]
      if (primarySub?.status === 'canceled' && primarySub?.canceled_at) {
        canceledAt = new Date(primarySub.canceled_at * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
      }

      // Scheduled cancellation flags — sub is still active but set to cancel at period end
      const cancelAtPeriodEnd = primarySub?.cancel_at_period_end || false
      const cancelAt          = primarySub?.cancel_at || null
      const stripeCanceling   = cancelAtPeriodEnd || !!cancelAt

      // DM detection: monthly plan ≈ $250, or annual plan where monthly equiv ≈ $208 ($2500/yr)
      const monthlyBase = planInterval === 'month' ? planPrice : planPrice / 12
      const isDM =
        (monthlyBase >= 245 && monthlyBase <= 255) ||
        (planInterval === 'year' && monthlyBase >= 205 && monthlyBase <= 215)

      const stripePhone    = normalizePhone(customer.phone)
      const stripeNormName = normalizeName(customer.name)

      // Cliff's Postman script "Stripe – Enrich Active Subs with GHL Location Id"
      // stores the GHL location ID on subscription metadata (not customer metadata).
      // Check sub metadata first across all subs, then fall back to customer metadata.
      const META_KEYS = ['location_id', 'ghl_location_id', 'locationId', 'ghlLocationId', 'GHL_Location_ID']
      let metaLocId = null
      for (const sub of subs) {
        for (const k of META_KEYS) {
          if (sub.metadata?.[k]) { metaLocId = sub.metadata[k]; break }
        }
        if (metaLocId) break
      }
      if (!metaLocId) {
        for (const k of META_KEYS) {
          if (customer.metadata?.[k]) { metaLocId = customer.metadata[k]; break }
        }
      }

      const record = {
        stripeCustomerId:     customer.id,
        stripeCustomerName:   customer.name || '',
        stripePhone,
        stripeNormName,
        stripeGhlLocationId:  metaLocId,
        stripeStatus:         primaryStatus,
        stripeSubscriptionId: primarySubId,
        stripeStartDate:      startDate,
        planNickname,
        planInterval,
        planPrice:       Math.round(planPrice       * 100) / 100,
        monthlyUserSub:  Math.round(monthlyUserSub  * 100) / 100,
        addOns:          Math.round(addOns          * 100) / 100,
        ...addOnFlags(addOnItems),
        totalRev:        Math.round(totalRev        * 100) / 100,
        users:           userCount,
        accountType:     isDM ? 'DM' : 'Agent',
        canceledAt,
        cancelAtPeriodEnd,
        cancelAt,
        stripeCanceling,
        lcWalletCharges: 0,
        transactions:    0,
        gp:              0,
      }

      // Override active → open_invoice when the customer has an unpaid open invoice
      if (record.stripeStatus === 'active' && openInvoiceCustomerIds.has(customer.id)) {
        record.stripeStatus = 'open_invoice'
      }

      byEmail[email] = record
    }

    // Process customers with no email — keyed by Stripe customer ID so manual overrides work
    for (const [custId, { customer, subs }] of Object.entries(subsByCustomerId)) {
      let primaryStatus = 'canceled', primarySubId = null, startDate = null, canceledAt = null
      let planPrice = 0, planNickname = '', planInterval = 'month'
      let monthlyUserSub = 0, addOns = 0, userCount = 0
      const addOnItems = []

      for (const sub of subs) {
        if ((STATUS_PRIORITY[sub.status] ?? 9) < (STATUS_PRIORITY[primaryStatus] ?? 9)) {
          primaryStatus = sub.status; primarySubId = sub.id
        }
        const subDate = new Date(sub.created * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
        if (!startDate || subDate < startDate) startDate = subDate
        for (const item of sub.items?.data || []) {
          const plan = item.plan || {}
          const amtDollars = (plan.amount || 0) / 100
          const qty = item.quantity || 0
          if (qty === 0 || amtDollars === 0) continue
          const interval = plan.interval || 'month'
          const nick = (plan.nickname || '').toLowerCase()
          const monthlyEquiv = interval === 'month' ? amtDollars : amtDollars / 12
          if (nick.includes('additional user') || nick.includes('user seat') || nick.includes('@ 64')) {
            monthlyUserSub += monthlyEquiv * qty; userCount += qty
          } else if (nick.includes('leadflow') || nick.includes('ai assistant') || nick.includes('add-on') || nick.includes('addon')) {
            addOns += monthlyEquiv * qty
            addOnItems.push({ nickname: plan.nickname || '', qty, monthly: Math.round(monthlyEquiv * qty * 100) / 100 })
          } else {
            if (monthlyEquiv > planPrice) { planPrice = monthlyEquiv; planNickname = plan.nickname || ''; planInterval = interval }
          }
        }
      }
      const primarySub = subs.find(s => s.id === primarySubId) ?? subs[0]
      if (primarySub?.status === 'canceled' && primarySub?.canceled_at) {
        canceledAt = new Date(primarySub.canceled_at * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
      }
      const catelAtPeriodEnd2 = primarySub?.cancel_at_period_end || false
      const cancelAt2         = primarySub?.cancel_at || null
      const stripeCanceling2  = catelAtPeriodEnd2 || !!cancelAt2
      const totalRev = planPrice + monthlyUserSub + addOns
      const record = {
        stripeCustomerId: custId, stripeCustomerName: customer.name || '',
        stripePhone: normalizePhone(customer.phone), stripeNormName: normalizeName(customer.name),
        stripeGhlLocationId: null, stripeStatus: primaryStatus, stripeSubscriptionId: primarySubId,
        stripeStartDate: startDate, planNickname, planInterval,
        planPrice: Math.round(planPrice * 100) / 100, monthlyUserSub: Math.round(monthlyUserSub * 100) / 100,
        addOns: Math.round(addOns * 100) / 100, ...addOnFlags(addOnItems), totalRev: Math.round(totalRev * 100) / 100,
        users: userCount, accountType: 'Agent', canceledAt,
        cancelAtPeriodEnd: catelAtPeriodEnd2, cancelAt: cancelAt2, stripeCanceling: stripeCanceling2,
        lcWalletCharges: 0, transactions: 0, gp: 0,
      }
      if (record.stripeStatus === 'active' && openInvoiceCustomerIds.has(custId)) {
        record.stripeStatus = 'open_invoice'
      }
      byCustomerIdNoEmail[custId] = record
    }

    // Build secondary lookup maps — phone and normalized name (unique only, skip collisions)
    const byPhone    = {}
    const byNormName = {}
    const phoneDupes = new Set()
    const nameDupes  = new Set()
    const byLocId    = {}

    for (const rec of Object.values(byEmail)) {
      if (rec.stripePhone && rec.stripePhone.length >= 10) {
        if (byPhone[rec.stripePhone]) phoneDupes.add(rec.stripePhone)
        else byPhone[rec.stripePhone] = rec
      }
      if (rec.stripeNormName) {
        if (byNormName[rec.stripeNormName]) nameDupes.add(rec.stripeNormName)
        else byNormName[rec.stripeNormName] = rec
      }
      if (rec.stripeGhlLocationId) {
        byLocId[rec.stripeGhlLocationId] = rec
      }
    }
    for (const p of phoneDupes)   delete byPhone[p]
    for (const n of nameDupes)    delete byNormName[n]

    return {
      byEmail,
      byPhone,
      byNormName,
      byLocId,
      byCustomerIdNoEmail,  // email-less customers (district offices etc.) — for manual overrides
      count:     Object.keys(byEmail).length,
      totalSubs: allSubs.length,
      syncedAt:  new Date().toISOString(),
    }
}

export default async function handler(req, res) {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY env var not configured in Vercel' })
  }

  try {
    const payload = await buildStripeBilling(key)
    // Stripe billing data changes infrequently — cache at edge for 10 min, serve stale up to 1 hour
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600')
    return res.json(payload)
  } catch (err) {
    console.error('[stripe-billing]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
