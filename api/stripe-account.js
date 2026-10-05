// On-demand Stripe data for a single customer: subscriptions + paginated invoices.
// Called when the account modal opens (not part of the bulk billing fetch).

const STRIPE_BASE = 'https://api.stripe.com/v1'

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

function fmtSub(sub, productMap = {}) {
  return {
    id:                 sub.id,
    status:             sub.status,
    currentPeriodStart: sub.current_period_start,
    currentPeriodEnd:   sub.current_period_end,
    cancelAtPeriodEnd:  sub.cancel_at_period_end || false,
    cancelAt:           sub.cancel_at || null,
    canceledAt:         sub.canceled_at || null,
    items: (sub.items?.data || []).map(item => ({
      id:            item.id,
      // Product name (separate fetch) → price nickname → readable fallback
      description:   productMap[item.price?.product] || item.price?.nickname
                     || (item.price?.unit_amount ? `$${(item.price.unit_amount / 100).toFixed(0)}/${item.price?.recurring?.interval || 'mo'} plan` : 'Plan'),
      quantity:      item.quantity || 1,
      unitAmount:    item.price?.unit_amount || 0,
      currency:      item.price?.currency || 'usd',
      interval:      item.price?.recurring?.interval || 'month',
      intervalCount: item.price?.recurring?.interval_count || 1,
    })),
  }
}

function fmtInv(inv) {
  return {
    id:              inv.id,
    number:          inv.number || '',
    status:          inv.status,
    total:           inv.total,
    amountPaid:      inv.amount_paid,
    amountRemaining: inv.amount_remaining,
    subtotal:        inv.subtotal,
    tax:             inv.tax || 0,
    currency:        inv.currency || 'usd',
    created:         inv.created,
    dueDate:         inv.due_date || null,
    hostedUrl:       inv.hosted_invoice_url || null,
    lines: (inv.lines?.data || []).map(line => ({
      id:          line.id,
      description: line.description || '',
      quantity:    line.quantity || 1,
      amount:      line.amount,
      currency:    line.currency || 'usd',
      periodStart: line.period?.start || null,
      periodEnd:   line.period?.end   || null,
    })),
  }
}

export default async function handler(req, res) {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return res.status(500).json({ error: 'STRIPE_SECRET_KEY not configured' })

  const { customerId, invoiceStartingAfter, paymentStartingAfter } = req.query
  if (!customerId || !customerId.startsWith('cus_')) {
    return res.status(400).json({ error: 'Missing or invalid customerId' })
  }

  try {
    const invParams = new URLSearchParams({ customer: customerId, limit: '10' })
    if (invoiceStartingAfter) invParams.set('starting_after', invoiceStartingAfter)

    const chargeParams = new URLSearchParams({ customer: customerId, limit: '10' })
    if (paymentStartingAfter) chargeParams.set('starting_after', paymentStartingAfter)

    // Step 1: subscriptions with price expanded (product is 5 levels deep — exceeds Stripe limit)
    const subPage = await stripeGet(
      `/subscriptions?customer=${customerId}&status=all&limit=20&expand[]=data.items.data.price`,
      key
    )

    // Step 2: collect unique product IDs from price objects, then fetch in parallel
    const productIds = [...new Set(
      (subPage.data || []).flatMap(sub =>
        (sub.items?.data || [])
          .map(item => item.price?.product)
          .filter(id => typeof id === 'string')
      )
    )]

    const [productPage, invPage, chgPage] = await Promise.all([
      productIds.length > 0
        ? stripeGet(`/products?${productIds.map(id => `ids[]=${encodeURIComponent(id)}`).join('&')}&limit=100`, key)
        : Promise.resolve({ data: [] }),
      stripeGet(`/invoices?${invParams}`, key),
      stripeGet(`/charges?${chargeParams}`, key),
    ])

    // Build product name lookup
    const productMap = {}
    for (const prod of productPage.data || []) productMap[prod.id] = prod.name

    const payments = (chgPage.data || []).map(ch => ({
      id:          ch.id,
      amount:      ch.amount,
      currency:    ch.currency || 'usd',
      status:      ch.status,       // succeeded | failed | pending
      description: ch.description || '',
      created:     ch.created,
      receiptUrl:  ch.receipt_url || null,
    }))

    res.setHeader('Cache-Control', 'no-store')
    return res.json({
      subscriptions:    (subPage.data || []).filter(s => s.status !== 'canceled').map(s => fmtSub(s, productMap)),
      invoices:         (invPage.data  || []).map(fmtInv),
      payments,
      hasMoreInvoices:  invPage.has_more || false,
      lastInvoiceId:    invPage.data?.at(-1)?.id || null,
      hasMorePayments:  chgPage.has_more || false,
      lastPaymentId:    chgPage.data?.at(-1)?.id || null,
    })
  } catch (err) {
    console.error('[stripe-account]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
