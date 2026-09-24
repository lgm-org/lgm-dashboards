import { useState, useEffect, useCallback, useRef } from 'react'
import { useGHLAccounts }     from './useGHLAccounts'
import { useCallData }        from './useCallData'
import { useGhlAccountStats } from './useGhlAccountStats'
import { computeHealth } from '../lib/healthScoreModel'

const STRIPE_REFRESH_MS = 300_000 // 5 min — match GHL cadence

// "2026-07" → days since July 31, 2026 (0 if still within that month or future)
function daysSinceLatestMonth(latestMonth) {
  if (!latestMonth) return null
  try {
    const [yearStr, monthStr] = latestMonth.split('-')
    const year  = parseInt(yearStr, 10)
    const month = parseInt(monthStr, 10)   // 1-indexed (1 = Jan, 12 = Dec)
    if (!year || !month || month < 1 || month > 12) return null
    // new Date(year, month, 0): month is treated as 0-indexed by Date constructor, so passing the
    // 1-indexed value as-is gives us day-0 of the NEXT month, which equals the last day of our month.
    // e.g. new Date(2026, 7, 0) = last day before month-index-7 (Aug) = July 31 ✓
    const lastDay = new Date(year, month, 0)
    return Math.max(0, Math.floor((Date.now() - lastDay.getTime()) / (1000 * 60 * 60 * 24)))
  } catch {
    return null
  }
}

function useLcChargesBulk() {
  const [byLocationId,    setByLocationId]    = useState({})
  const [latestMonthById, setLatestMonthById] = useState({})
  useEffect(() => {
    fetch('/api/lc-charges-bulk')
      .then(r => r.json())
      .then(d => {
        if (d.byLocationId)    setByLocationId(d.byLocationId)
        if (d.latestMonthById) setLatestMonthById(d.latestMonthById)
      })
      .catch(() => {})
  }, [])
  return { byLocationId, latestMonthById }
}

// Sub-accounts to exclude from all counts, KPIs, and tables (internal/test/snapshot accounts)
const EXCLUDED_NAMES = new Set([
  'lgm nps survey',
  "joe perniciaro's account",
  'hlpt saas snapshot',
  'tippy taps',
  'farmers sandbox',
  '(new) sandbox',
  'mallard',
  // LGM internal add-on / test accounts (John flagged 2026-08-18 demo)
  'lgm add-on',
  'lgm add on',
  'lgm addon',
  'lgm training',
  'lgm training account',
  'lgm test',
  'lgm test account',
  'lgm demo',
  'lgm demo account',
  'little giant marketing',
  'little giant marketing agency',
  'data forest lgm add-on',
  'data forest lgm add on',
])

// Normalize phone to 10 digits for matching
function normalizePhone(p) {
  const d = (p || '').replace(/\D/g, '')
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d
}

// Normalize name for call-sheet matching — must mirror useCallData.js exactly
function normalizeName(n) {
  return (n || '')
    .toLowerCase()
    .replace(/'s\b/g, '')                // strip possessives: "Lewis's" → "Lewis"
    .replace(/\b(llc|inc|corp|ltd|l\.l\.c\.|incorporated|limited|company|the|agency|marketing|services|group|associates|account|insurance|at)\b\.?/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function useStripeBilling() {
  const [byEmail,      setByEmail]      = useState({})
  const [byPhone,      setByPhone]      = useState({})
  const [byNormName,   setByNormName]   = useState({})
  const [byLocId,      setByLocId]      = useState({}) // from Stripe sub/customer metadata
  const [byCustomerId, setByCustomerId] = useState({}) // keyed by Stripe cus_xxx ID
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [syncedAt,     setSyncedAt]     = useState(null)
  const timerRef = useRef(null)

  const doFetch = useCallback(async () => {
    try {
      const res = await fetch('/api/stripe-billing')
      if (!res.ok) throw new Error(`Stripe billing API returned HTTP ${res.status}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      const emailMap = data.byEmail || {}
      setByEmail(emailMap)
      setByPhone(data.byPhone || {})
      setByLocId(data.byLocId || {})
      setSyncedAt(data.syncedAt ? new Date(data.syncedAt) : new Date())
      setError(null)

      // byCustomerId — email-keyed customers + email-less customers (district offices etc.)
      const custIdx = {}
      for (const rec of Object.values(emailMap)) {
        if (rec.stripeCustomerId) custIdx[rec.stripeCustomerId] = rec
      }
      // Merge in email-less customers so manual overrides by customer ID still work
      Object.assign(custIdx, data.byCustomerIdNoEmail || {})
      setByCustomerId(custIdx)

      // byNormName — server builds it; rebuild client-side if absent (older deploy)
      if (data.byNormName && Object.keys(data.byNormName).length > 0) {
        setByNormName(data.byNormName)
      } else {
        const normIdx = {}
        const dupes   = new Set()
        for (const val of Object.values(emailMap)) {
          const n = normalizeName(val.stripeCustomerName)
          if (!n) continue
          if (normIdx[n]) dupes.add(n)
          else normIdx[n] = val
        }
        for (const n of dupes) delete normIdx[n]
        setByNormName(normIdx)
      }
    } catch (err) {
      console.warn('[useStripeBilling] fetch failed:', err.message)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    doFetch()
    timerRef.current = setInterval(doFetch, STRIPE_REFRESH_MS)
    return () => clearInterval(timerRef.current)
  }, [doFetch])

  return { byEmail, byPhone, byNormName, byLocId, byCustomerId, loading, error, syncedAt }
}

// Reads Cliff's published Google Sheet — authoritative GHL Location ID → Stripe Customer ID mapping
function useCliffSheet() {
  const [byLocId,  setByLocId]  = useState({})
  const [loading,  setLoading]  = useState(true)
  const timerRef = useRef(null)

  const doFetch = useCallback(async () => {
    try {
      const res = await fetch('/api/cliff-sheet')
      const data = await res.json()
      if (data.byLocId) setByLocId(data.byLocId)
    } catch (_) {
      // Cliff sheet is optional — don't surface errors, just keep stale data
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    doFetch()
    timerRef.current = setInterval(doFetch, STRIPE_REFRESH_MS)
    return () => clearInterval(timerRef.current)
  }, [doFetch])

  return { byLocId, loading }
}

// Manual GHL location ID → Stripe customer ID overrides.
// Used when auto-matching (email/phone/name) fails due to data inconsistencies
// between GHL and Stripe (different contact emails, name variations, etc.).
// Priority: Cliff's sheet → these overrides → Stripe metadata → email → name → phone.
const MANUAL_LOC_TO_CUST = {
  'mlf5bQzFhF3lxeyrekKM': 'cus_UpyBvugEpAOzt1', // Ana Alvarez
  'PO3oiOr3SB7B2pFINE4e': 'cus_UTSrspbT4W6TPJ', // Angel Alfred Najar
  'Hu2SAV4L661GRSMchLhi': 'cus_TWetgnBH8VvRZH', // Ashlynne Elrod Pushee
  'x2MlzNrhGpm0QknRAYpa': 'cus_Uz0w4Imdhs1xpe', // Charmagne Parker
  'nub1s1txx5gns0FdQYpt': 'cus_UGOUmOB4DSIkpT', // Cory Washam
  'Hzp2YEU5O8hRXkSDhPDU': 'cus_Unl8AyA9owPIcl', // Daniel Valdez
  'jfUXHS7u55gJfsnmZnaY': 'cus_T1tmQMPIl8Pr53', // David Huntley
  'MGwDBEhvgPaCB4cmVPZy': 'cus_UpvfKDEig0Z7io', // Flores Agency → Jose Flores
  'Zs4TN6xMTEnxAF1PnhqK': 'cus_UvbjdTifMqLsRA', // Gail Mirchandani
  'oMKDUZDit5o7gO6XVZUr': 'cus_UQXISuKUQ2uUzK', // Gerald Cummings
  '1doWoVuSH2bDGwzpQj7s': 'cus_UwMKuHEop8C8MR', // Justin Wilson
  'Ob4OLJALqFZcQBtFgPJb': 'cus_U0z9pLIXSFsHtn', // Kahl Insurance Agency
  'gdMsXRnC1F5h5xUdcQQT': 'cus_UCYLpyz1S5dUzm', // Kurt Haddock District Office
  'n22YswtEDJ7aeCLmgv0t': 'cus_So2jd7lAtTJZQl', // Les Palcsik (Leslie N Palcsik)
  '2KO3cImKm53ROl6oGrTg': 'cus_ULfrTQbu2zRNZW', // Luis Cortez
  'qb18A53QB0HF0bBob52d': 'cus_UTrw8xlTNUfJXi', // Nicolas Gwyn
  'tEyhikNKcsoHn0jqegxA': 'cus_S6EOt3M0E1ejqv', // Peter Raschio
  'rXnFUYrXyM0HAtZqoE1F': 'cus_QIH1QM93K4JygX', // Prospera NW Consulting Group
  'F5GAwcnB42JDWiV2sieb': 'cus_TF4omavbLkJc78', // Rappa District Office
  'r0inx3zRUkDjR17zARmM': 'cus_RTImIzHEYnsGm1', // Sean Verhoeff
  'WEf0nt2zV2opHao5bUTt': 'cus_Rqa1qbCdmepZ20', // Toni Begic
  '6v7IXovjffVw6TaILwPQ': 'cus_P5EFcRcW0CzzQg', // The Waldron Agency
  'l3qJBTDFDARPxyfRhTzh': 'cus_QUHFLckQdO0lEr', // Walters Meis Agency
  'NEbEmdI23GC0ZGB2eJcM': 'cus_Tn9HfsNYHOoXSE', // Alex at Farmers → Alex Andrews
  'dvUbkdW8VLflHuZ9N3KK': 'cus_ThAbs9GewxyCds', // Virginia District 61 (confirmed by Cliff)
  'QHBIwZQeg1cYHFRUm38K': 'cus_PapSBPUVk47eaI', // Rikki Wilkerson Farmers (confirmed by Cliff)
  // From Cliff's LC Audit WS Pack Snapshot (2026-08-31):
  'p5ZScDfio2eKwcvnXJ37': 'cus_UQSfxDYJNhetzC', // Ashley Atkinson
  'OqziJmqncZXK59l7YCQT': 'cus_UBTXOcnopFXB8d', // Blake Jordan
  'lYA78yZwn2GhOBLxhzJX': 'cus_U57cZn7yShe0JP', // Brandi Clark
  'rmbDFqgko1SbYd5yQhOg': 'cus_SE8AWGK5lHlI3y', // Jeremiah/Taylor District
  'ZS6HDc70FathkNxMwriI': 'cus_Pmon8MVNyNn6XD', // Leo Gibson Farmers Agency
  'aqdohx8mNwHV6EpfWewQ': 'cus_Ts3pIDHTPW6AsD', // Robert Lafler
  'yVeQhP4kwqYp2oK4kJrB': 'cus_UsyBlzaNFMXJQ3', // StClair Agency
  'WW8hlI5uJg0qB8etlSoX': 'cus_UJKbDQQdPzLASO', // The Wood Agency (confirmed in both Cliff files)
}

export function useMergedHealthData() {
  const ghl    = useGHLAccounts()
  const stripe = useStripeBilling()
  const cliff  = useCliffSheet()
  const calls  = useCallData()
  const { byLocationId: lcBulk, latestMonthById: lcMonths } = useLcChargesBulk()
  const { statsMap } = useGhlAccountStats()

  const accounts = (ghl.accounts || [])
    .filter(g => !EXCLUDED_NAMES.has((g.ghlName || '').toLowerCase().trim()))
    .map(g => {
    // Join priority (highest confidence first):
    // 1. Cliff's sheet: locationId → stripeCustomerId → full Stripe record  (authoritative)
    // 2. Stripe subscription/customer metadata: locationId stored by Cliff's Postman script
    // 3. Email exact match (case-insensitive)
    // 4. Normalized company name (unique Stripe customers only, strips LLC/Inc/etc.)
    // 5. Phone number (10-digit normalized, unique customers only)
    const email    = (g.ghlEmail || '').toLowerCase().trim()
    const normName = normalizeName(g.ghlName)
    const phone    = normalizePhone(g.ghlPhone)

    // Cliff sheet: look up location → get their Stripe customer ID → full Stripe record
    const cliffRecord   = cliff.byLocId[g.ghlId] || null
    const cliffCustRec  = cliffRecord?.stripeCustomerId
      ? stripe.byCustomerId[cliffRecord.stripeCustomerId]
      : null

    // Manual override: hardcoded GHL location ID → Stripe customer ID
    const manualCustId  = MANUAL_LOC_TO_CUST[g.ghlId]
    const manualCustRec = manualCustId ? stripe.byCustomerId[manualCustId] : null

    const billing = cliffCustRec
                 || manualCustRec
                 || (g.ghlId  && stripe.byLocId[g.ghlId])
                 || (email    && stripe.byEmail[email])
                 || (normName && stripe.byNormName[normName])
                 || (phone    && phone.length >= 10 && stripe.byPhone[phone])
                 || null

    return {
      // ── Identity ──────────────────────────────────────────
      id:               g.ghlId,
      accountName:      g.ghlName,
      locationId:       g.ghlId,
      ghlId:            g.ghlId,

      // ── GHL fields ────────────────────────────────────────
      ghlEmail:         g.ghlEmail,
      ghlPhone:         g.ghlPhone,
      ghlCity:          g.ghlCity,
      ghlState:         g.ghlState,
      ghlCountry:       g.ghlCountry,
      ghlWebsite:       g.ghlWebsite,
      ghlTimezone:      g.ghlTimezone,
      ghlDateAdded:     g.ghlDateAdded,
      ghlDateUpdated:   g.ghlDateUpdated,
      ghlDaysSinceUpdate: g.ghlDaysSinceUpdate,
      ghlPermissions:   g.ghlPermissions,
      ghlSnapshotId:    g.ghlSnapshotId,

      // ── Health scoring inputs ──────────────────────────────
      // Stripe only (per John) — GHL create date is kept separately as ghlDateAdded
      stripeStartDate:  billing?.stripeStartDate || null,
      // lastActivity: use GHL contact-level activity (from Supabase cache written by AccountModal opens)
      // as the primary signal — it's the native GHL "contact last activity" field.
      // Fall back to LC wallet billing month when the cache hasn't been populated for this account yet.
      // ghlDaysSinceUpdate (sub-account settings update) is intentionally excluded — it's not contact activity.
      ...(() => {
        const lcDays = daysSinceLatestMonth(lcMonths[g.ghlId])
        const s = statsMap[g.ghlId] || {}
        // Signals for John's 100-point model (batch-synced into ghl_account_stats)
        const hasGhlData = s.healthScore !== null && s.healthScore !== undefined
        const signals = {
          hasGhlData,
          calls7d:              s.calls7d            ?? null,
          callsYesterdayIn:     s.callsYesterdayIn   ?? null,
          callsYesterdayOut:    s.callsYesterdayOut  ?? null,
          callsSource:          s.callsSource        || null,
          lastCallAt:           s.lastCallDate       || null,
          lastSaleAt:           s.lastSaleDate       || null,
          won30d:               s.won30d             ?? null,
          wonPrior30d:          s.wonPrior30d        ?? null,
          tickets7d:            s.tickets7d          ?? null,
          lastContactCreatedAt: s.lastContactCreated || null,
        }
        const health = computeHealth(signals)
        // Last Meaningful Activity = most recent of call / new contact created / won sale
        const meaningfulAt = health.meaningfulActivityAt || s.meaningfulActivityAt || null
        const ghlDays = meaningfulAt
          ? Math.max(0, Math.floor((Date.now() - new Date(meaningfulAt).getTime()) / 86_400_000))
          : null
        const usedLc = ghlDays === null && lcDays !== null
        return {
          _signals:            signals,
          _healthV2:           health,
          lastActivity:        ghlDays !== null ? ghlDays : lcDays,
          lastLcActivityMonth: usedLc ? lcMonths[g.ghlId] : null,
          _lastActivitySource: ghlDays !== null ? 'ghl_contact' : (lcDays !== null ? 'lc' : null),
          meaningfulActivityAt: meaningfulAt,
          lastContactUpdate:   s.lastContactUpdate  || null,
          lastContactCreated:  s.lastContactCreated || null,
          lastCallDate:        s.lastCallDate       || null,
          lastSaleDate:        s.lastSaleDate       || null,
          ghlSyncNote:         s.syncNote           || null, // GHL's reason when no activity could be read
        }
      })(),

      // ── Stripe / billing fields ───────────────────────────
      stripeCustomerId:     billing?.stripeCustomerId     || null,
      stripeCustomerName:   billing?.stripeCustomerName   || null,
      stripeStatus:         billing?.stripeStatus         || null,
      stripeSubscriptionId: billing?.stripeSubscriptionId || null,
      planNickname:         billing?.planNickname         || null,
      planInterval:         billing?.planInterval         || null,

      // ── Monetary fields (all in $/month) ──────────────────
      totalRev:        billing?.totalRev        ?? 0,
      planPrice:       billing?.planPrice       ?? 0,
      monthlyUserSub:  billing?.monthlyUserSub  ?? 0,
      addOns:          billing?.addOns          ?? 0,
      lcWalletCharges: lcBulk[g.ghlId] ?? billing?.lcWalletCharges ?? 0,
      annualSubs:      billing?.planInterval === 'year'
        ? Math.round((billing?.planPrice ?? 0) * 12 * 100) / 100
        : 0,

      // ── Non-monetary billing fields ───────────────────────
      users:        billing?.users        ?? 0,
      transactions: billing?.transactions ?? 0, // pending: Cliff's DataHealthStatus
      gp:           billing?.gp           ?? 0, // pending: cost data
      multiLocation: false,
      // Priority: Cliff's explicit column → Stripe price detection → 'Unknown'
      accountType:  cliffRecord?.accountType || billing?.accountType || (billing ? 'Agent' : 'Unknown'),

      // Stripe cancellation date (ISO string) — set only if subscription was cancelled
      canceledAt: billing?.canceledAt || null,

      // Scheduled cancellation — subscription still active but set to cancel at period end
      stripeCanceling:   billing?.stripeCanceling   || false,
      cancelAtPeriodEnd: billing?.cancelAtPeriodEnd || false,
      cancelAt:          billing?.cancelAt          || null,

      // GHL account disabled/paused (client can't login)
      ghlDisabled: g.ghlDisabled || false,

      // Internal flag — true when Stripe data was matched
      _stripeBound: !!billing,

      // ── Call intelligence (from AI Team Assistant call sheet) ─────────────
      callStats: calls.byCustomerName[normName] || null,
    }
  })

  const matched   = accounts.filter(a => a._stripeBound).length
  const unmatched = accounts.length - matched

  const dataSourceStatus = {
    ghlTotal:       ghl.accounts.length,
    stripeTotal:    Object.keys(stripe.byCustomerId).length,
    matched,
    unmatched,
    ghlSyncedAt:    ghl.syncedAt,
    stripeSyncedAt: stripe.syncedAt,
    byLocIdCount:   Object.keys(stripe.byLocId).length,
  }

  return {
    accounts,
    loading:      ghl.loading,   // show spinner only for GHL (primary source)
    stripeLoading: stripe.loading,
    ghlLoading:   ghl.loading,
    error:        ghl.error,
    ghlError:     ghl.error,
    stripeError:  stripe.error,
    lastUpdated:  ghl.syncedAt,
    refetch:      ghl.refetch,
    retrying:     false,
    dataSourceStatus,
  }
}
