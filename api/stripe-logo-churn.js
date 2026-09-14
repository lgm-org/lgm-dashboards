// GET /api/stripe-logo-churn
// Computes Cliff's Logo Churn model: monthly churn rate based on active SaaS accounts
// at the START of each month vs confirmed cancellations that month.
// Accounts reinstated within 28 days are excluded from the confirmed churn count.

const STRIPE_BASE = 'https://api.stripe.com/v1'

async function stripeGet(path, key) {
  const encoded = Buffer.from(`${key}:`).toString('base64')
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    headers: { Authorization: `Basic ${encoded}` },
  })
  if (!res.ok) throw new Error(`Stripe ${path} → HTTP ${res.status}`)
  return res.json()
}

async function fetchAllSubs(key) {
  const all = []
  let startingAfter = null
  while (true) {
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

// Returns true if this subscription item is a SaaS base plan
// (not user billing, not add-on, not $1 placeholder)
function isSaaSItem(item) {
  const nick = (item.plan?.nickname || item.price?.nickname || '').toLowerCase()
  const amt  = (item.plan?.amount || item.price?.unit_amount || 0) / 100
  const interval = item.plan?.interval || item.price?.recurring?.interval || 'month'
  const monthly  = interval === 'month' ? amt : amt / 12

  if (monthly < 50) return false  // exclude $1/yr placeholders and very cheap add-ons

  const excluded = [
    'additional user', 'user seat', '@ 64',
    'leadflow', 'ai assistant', 'add-on', 'addon', 'ai call coach',
  ]
  return !excluded.some(kw => nick.includes(kw))
}

function hasSaaSItem(sub) {
  return (sub.items?.data || []).some(isSaaSItem)
}

// Format Unix timestamp → 'YYYY-MM' string in CT timezone
function toYearMonth(ts) {
  return new Date(ts * 1000).toLocaleDateString('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit',
  }).slice(0, 7) // 'YYYY-MM'
}

// First day of 'YYYY-MM' as Unix timestamp (midnight CT)
function monthStartTs(ym) {
  return Math.floor(new Date(`${ym}-01T06:00:00Z`).getTime() / 1000)
}

function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthsBetween(start, end) {
  const months = []
  let cur = start
  while (cur <= end) {
    months.push(cur)
    cur = addMonths(cur, 1)
  }
  return months
}

export default async function handler(req, res) {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return res.status(500).json({ error: 'STRIPE_SECRET_KEY not configured' })

  try {
    const allSubs = await fetchAllSubs(key)

    // ── Group SaaS subscriptions by customer ─────────────────────────────────
    // custId → [{ subId, startTs, canceledAtTs, status, cancelAtPeriodEnd, cancelAtTs }]
    const byCust = {}

    for (const sub of allSubs) {
      if (!hasSaaSItem(sub)) continue

      const cust   = sub.customer
      const custId = typeof cust === 'object' ? cust?.id : cust
      if (!custId) continue

      const custName = (typeof cust === 'object' ? cust?.name : '') || ''

      if (!byCust[custId]) byCust[custId] = { custId, custName, subs: [] }

      byCust[custId].subs.push({
        subId:             sub.id,
        startTs:           sub.start_date || sub.created,
        canceledAtTs:      sub.canceled_at || null,   // null if still active
        status:            sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end || false,
        cancelAtTs:        sub.cancel_at || null,     // scheduled cancel timestamp
      })
    }

    // ── Build the month range ─────────────────────────────────────────────────
    const now        = new Date()
    const currentYM  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    let earliestYM = currentYM
    for (const { subs } of Object.values(byCust)) {
      for (const s of subs) {
        const ym = toYearMonth(s.startTs)
        if (ym < earliestYM) earliestYM = ym
      }
    }

    const months = monthsBetween(earliestYM, currentYM)

    // ── Per-month churn computation ───────────────────────────────────────────
    const monthRows = months.map(ym => {
      const mStart = monthStartTs(ym)
      const mEnd   = monthStartTs(addMonths(ym, 1))
      const isCurrentMonth = ym === currentYM
      const DAY28 = 28 * 24 * 3600

      let activeStart       = 0
      let cancelsConfirmed  = 0
      let reinstated28d     = 0
      let cancelsPending    = 0  // active but scheduled to cancel

      for (const { subs } of Object.values(byCust)) {
        // Was this customer active at the START of this month?
        const wasActive = subs.some(s => {
          const started  = s.startTs < mStart
          const notYetCancelled = s.canceledAtTs === null || s.canceledAtTs >= mStart
          return started && notYetCancelled
        })

        if (wasActive) activeStart++

        // Did this customer have a SaaS cancel DURING this month?
        const cancelledSubs = subs.filter(s =>
          s.canceledAtTs !== null &&
          s.canceledAtTs >= mStart &&
          s.canceledAtTs < mEnd
        )

        for (const cancelled of cancelledSubs) {
          // Reinstatement check: did this customer re-subscribe within 28 days?
          const reinstated = subs.some(s =>
            s.subId !== cancelled.subId &&
            s.startTs > cancelled.canceledAtTs &&
            s.startTs <= cancelled.canceledAtTs + DAY28
          )

          if (reinstated) {
            reinstated28d++
          } else {
            cancelsConfirmed++
          }
        }

        // Pending: scheduled to cancel but still active (relevant for current & recent months)
        if (isCurrentMonth) {
          const hasPending = subs.some(s =>
            s.canceledAtTs === null &&
            (s.status === 'active' || s.status === 'trialing') &&
            (s.cancelAtPeriodEnd || s.cancelAtTs)
          )
          if (hasPending) cancelsPending++
        }
      }

      const churnRateConfirmed = activeStart > 0
        ? Math.round((cancelsConfirmed / activeStart) * 10000) / 100
        : 0

      const churnRateTotal = activeStart > 0
        ? Math.round(((cancelsConfirmed + cancelsPending) / activeStart) * 10000) / 100
        : 0

      return {
        month: ym,
        activeStart,
        cancelsConfirmed,
        reinstated28d,
        cancelsPending,
        churnRateConfirmed,
        churnRateTotal,
        isCurrentMonth,
      }
    })

    // ── Summary stats ─────────────────────────────────────────────────────────
    const completeMonths = monthRows.filter(m => !m.isCurrentMonth && m.activeStart > 0)
    const lastComplete   = completeMonths[completeMonths.length - 1] || null
    const prev6          = completeMonths.slice(-6)
    const avg6mRate      = prev6.length
      ? Math.round(prev6.reduce((s, m) => s + m.churnRateConfirmed, 0) / prev6.length * 10) / 10
      : null
    const totalCancels   = completeMonths.reduce((s, m) => s + m.cancelsConfirmed, 0)

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600')
    res.json({
      months: monthRows,
      summary: {
        lastCompleteMonth:    lastComplete?.month || null,
        lastMonthRate:        lastComplete?.churnRateConfirmed ?? null,
        lastMonthCancels:     lastComplete?.cancelsConfirmed ?? null,
        lastMonthActive:      lastComplete?.activeStart ?? null,
        lastMonthReinstated:  lastComplete?.reinstated28d ?? null,
        avg6mRate,
        totalCancels,
        currentMonth:         currentYM,
        currentPending:       monthRows.find(m => m.isCurrentMonth)?.cancelsPending ?? 0,
        currentActiveStart:   monthRows.find(m => m.isCurrentMonth)?.activeStart ?? 0,
      },
    })
  } catch (err) {
    console.error('stripe-logo-churn error:', err)
    res.status(500).json({ error: err.message })
  }
}
