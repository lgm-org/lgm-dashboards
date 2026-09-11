// Shared data-layer core for the Master Dashboard — used by both the
// interactive api/master-leads.js handler and the cron-refresh-master-cache.js
// background job. Splitting this out means the expensive "pull everything
// from GHL" step (loadRaw) and the cheap "join + filter to a date window"
// step (buildLeads) can run on completely different schedules: loadRaw only
// needs to happen once every CACHE_TTL_MS, while buildLeads reruns instantly
// on every date-filter click against whatever was last cached.
//
// Root cause of the "every filter click takes 1-3 minutes" complaint: the
// old master-leads.js re-pulled all contacts + opportunities from GHL live,
// on every single request, even when only the date range changed. That's
// ~150+ sequential GHL API calls per load. Caching the raw pull and doing the
// date-window filtering in memory removes that entirely for every request
// except the first one after the cache goes stale.

import { kv } from './_supabase.js'
import { ghlFetch } from './_ghlAuth.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const PAGE_DELAY_MS = 40

const CONTACTS_MAX_PAGES = 200
const OPPS_MAX_PAGES = 100

// How long a cached pull is considered fresh before the next request triggers
// a live re-fetch. The cron (every 15 min) keeps this warm in the background
// so an interactive user should rarely be the one paying for a cold cache.
export const CACHE_TTL_MS = 20 * 60 * 1000

// Cached raw pull covers this many days back regardless of what date range is
// requested — wide enough to cover every preset the UI offers (today through
// last month / 90 days) from a single cache entry, so switching between them
// never needs a new GHL pull, only a re-filter of what's already cached.
const RAW_FETCH_FROM_DAYS = 400

export const KNOWN_LOCATIONS_KEY = 'master_cache:known_locations'
export function cacheKey(locationId) { return `master_cache:${locationId}` }

export async function touchKnownLocations(locationId) {
  const list = (await kv.get(KNOWN_LOCATIONS_KEY)) || []
  if (!list.includes(locationId)) {
    await kv.set(KNOWN_LOCATIONS_KEY, [...list, locationId])
  }
}

export const FIELD_TARGETS = {
  leadPrice:        ['lead price', 'lead cost'],
  callCount:        ['call count', 'calls count'],
  dispositionDate:  ['disposition date and time', 'disposition date'],
  badLeadDate:      ['bad lead date'],
  smsReplyDate:     ['sms reply date', 'sms reply'],
  oppSoldDate:      ['opp sold date', 'opportunity sold date', 'sold date', 'date sold', 'policy sold date'],
  // No bare 'quoted' alias — audited across all 293 client accounts on
  // 2026-09-12 and found it silently matched dollar-amount fields like
  // "Total Quoted Premium" / "Quoted Premium" / "Quoted By" / "Quoted Policy
  // Type" ahead of the real date field on 153 of 277 "fully matched"
  // accounts (55%) — a false-positive match is worse than a visible "missing
  // field" warning, since it looks fine but is computing quote rate off the
  // wrong data entirely. Every one of those 153 accounts also has a real
  // Quoted Timestamp/Date field, so removing the broad alias costs nothing.
  quotedTimestamp:  ['quoted timestamp', 'quoted date', 'quote date'],
  xdatedReason:     ['x-dated reason', 'xdated reason', 'x dated reason', 'reason x-dated', 'x-date reason', 'x date reason'],
  leadProfile:      ['lead profile'],
  badLeadReason:    ['bad lead reason'],
  optOutDate:       ['opt out date', 'opted out date', 'opt-out date', 'unsubscribed date', 'opt out'],
  subSource:        ['sub source', 'sub-source', 'subsource'],
}

// Exported so api/field-audit.js can run the exact same name-matching logic
// across every client account, instead of drifting into a second copy.
export async function getCustomFieldMap(token, locationId) {
  const { ok, json, text } = await ghlFetch(`/locations/${locationId}/customFields`, token)
  if (!ok) throw new Error(`Failed to fetch custom fields: ${text}`)
  const contactFields = json?.customFields || []

  let opportunityFields = []
  try {
    const oppRes = await ghlFetch(`/locations/${locationId}/customFields?model=opportunity`, token)
    if (oppRes.ok) opportunityFields = oppRes.json?.customFields || []
  } catch { /* best-effort supplement, contact fields already succeeded above */ }

  const byId = new Map()
  for (const f of [...contactFields, ...opportunityFields]) byId.set(f.id, f)
  const fields = [...byId.values()]

  const map = {}
  for (const [targetKey, aliases] of Object.entries(FIELD_TARGETS)) {
    const match = fields.find(f => {
      const name = (f.name || f.fieldKey || '').toLowerCase()
      return aliases.some(alias => name.includes(alias))
    })
    map[targetKey] = match ? { id: match.id, name: match.name || match.fieldKey } : null
  }

  return { map, allFields: fields.map(f => ({ id: f.id, name: f.name || f.fieldKey })) }
}

function readCustomFieldValue(contact, fieldMatch) {
  if (!fieldMatch) return null
  const cf = (contact.customFields || []).find(f => f.id === fieldMatch.id)
  return cf?.value ?? cf?.fieldValue ?? null
}

function resolveAllCustomFields(entity, fieldsById) {
  const out = {}
  for (const cf of (entity.customFields || [])) {
    const key = fieldsById[cf.id]?.name || cf.id
    out[key] = cf.value ?? cf.fieldValue ?? null
  }
  return out
}

async function fetchAllContacts(token, locationId, fromMs) {
  const all = []
  let startAfter = null
  let startAfterId = null
  let pagesFetched = 0
  let hitPageCap = false

  for (let page = 0; page < CONTACTS_MAX_PAGES; page++) {
    if (page > 0) await sleep(PAGE_DELAY_MS)
    let path = `/contacts/?locationId=${locationId}&limit=100`
    if (startAfter && startAfterId) {
      path += `&startAfter=${startAfter}&startAfterId=${startAfterId}`
    }
    const { ok, json, text } = await ghlFetch(path, token)
    if (!ok) throw new Error(`Failed to fetch contacts (page ${page}): ${text}`)

    const batch = json?.contacts || []
    all.push(...batch)
    pagesFetched++
    if (batch.length < 100) break

    const last = batch[batch.length - 1]
    const lastDateMs = last?.dateAdded ? new Date(last.dateAdded).getTime() : null
    if (lastDateMs !== null && lastDateMs < fromMs) break

    startAfter = lastDateMs
    startAfterId = last?.id || null
    if (!startAfter || !startAfterId) break

    if (page === CONTACTS_MAX_PAGES - 1) hitPageCap = true
  }

  return { contacts: all, pagesFetched, hitPageCap }
}

async function fetchAllOpportunities(token, locationId) {
  const all = []
  let pagesFetched = 0
  let hitPageCap = false

  for (let pageNum = 1; pageNum <= OPPS_MAX_PAGES; pageNum++) {
    if (pageNum > 1) await sleep(PAGE_DELAY_MS)
    const path = `/opportunities/search?location_id=${locationId}&limit=100&page=${pageNum}`
    const { ok, json, text } = await ghlFetch(path, token)
    if (!ok) throw new Error(`Failed to fetch opportunities (page ${pageNum}): ${text}`)

    const batch = json?.opportunities || []
    all.push(...batch)
    pagesFetched++
    if (batch.length < 100) break
    if (pageNum === OPPS_MAX_PAGES) hitPageCap = true
  }

  return { opportunities: all, pagesFetched, hitPageCap }
}

async function fetchUsers(token, locationId) {
  try {
    const { ok, json } = await ghlFetch(`/users/?locationId=${locationId}`, token)
    if (!ok) return {}
    const users = json?.users || []
    return Object.fromEntries(users.map(u => [u.id, u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email]))
  } catch {
    return {}
  }
}

async function fetchStageNames(token, locationId) {
  try {
    const { ok, json } = await ghlFetch(`/opportunities/pipelines?locationId=${locationId}`, token, 'GET', null, 3, 'v3')
    if (!ok) return {}
    const pipelines = json?.pipelines || []
    const map = {}
    for (const p of pipelines) {
      for (const s of (p.stages || [])) {
        if (s.id) map[s.id] = s.name || s.label || s.id
      }
    }
    return map
  } catch {
    return {}
  }
}

// Pulls everything from GHL for one location — the slow, rate-limit-sensitive
// step. Always fetches a wide RAW_FETCH_FROM_DAYS window so the cached result
// can serve any of the UI's date presets without a re-pull.
export async function loadRaw(token, locationId) {
  const fromMs = Date.now() - RAW_FETCH_FROM_DAYS * 86400000

  const [fieldMapResult, contactsResult, oppsResult, usersById, stageNames] = await Promise.all([
    getCustomFieldMap(token, locationId).catch(err => ({ error: err.message })),
    fetchAllContacts(token, locationId, fromMs),
    fetchAllOpportunities(token, locationId),
    fetchUsers(token, locationId),
    fetchStageNames(token, locationId),
  ])

  const fieldMap  = fieldMapResult.map || {}
  const allFields = fieldMapResult.allFields || []
  const customFieldsError = fieldMapResult.error || null

  return {
    locationId,
    fieldMap,
    allFields,
    customFieldsError,
    contacts: contactsResult.contacts,
    opportunities: oppsResult.opportunities,
    contactsPagination: { pagesFetched: contactsResult.pagesFetched, hitPageCap: contactsResult.hitPageCap },
    opportunitiesPagination: { pagesFetched: oppsResult.pagesFetched, hitPageCap: oppsResult.hitPageCap },
    usersById,
    stageNames,
    fetchedAt: new Date().toISOString(),
  }
}

// Cheap step — pure in-memory join + filter, no network calls. Runs on every
// request, even against a cached raw pull, so a date-filter click is instant.
export function buildLeads(raw, fromMs, toMs) {
  const { contacts, opportunities, fieldMap, allFields, usersById, stageNames } = raw
  const fieldsById = Object.fromEntries(allFields.map(f => [f.id, f]))

  const oppsByContact = {}
  for (const o of opportunities) {
    const cid = o.contactId || o.contact?.id
    if (!cid) continue
    ;(oppsByContact[cid] ||= []).push({
      id:                o.id,
      name:              o.name,
      monetaryValue:     o.monetaryValue ?? null,
      pipelineId:        o.pipelineId,
      pipelineStageId:   o.pipelineStageId,
      pipelineStageName: stageNames[o.pipelineStageId] || null,
      status:            o.status,
      dateAdded:         o.dateAdded,
      lastStageChangeAt: o.lastStageChangeAt,
      customFields:      resolveAllCustomFields(o, fieldsById),
    })
  }

  const leads = contacts
    .filter(c => {
      const t = c.dateAdded ? new Date(c.dateAdded).getTime() : null
      return t !== null && t >= fromMs && t <= toMs
    })
    .map(c => {
      const opps = oppsByContact[c.id] || []
      const latestOpp = opps.length
        ? [...opps].sort((a, b) => new Date(b.lastStageChangeAt || 0) - new Date(a.lastStageChangeAt || 0))[0]
        : null

      return {
        contactId:          c.id,
        name:               c.contactName || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
        dateAdded:          c.dateAdded,
        lastStatusChangeAt: c.lastStatusChangeAt || null,
        salesStage:         latestOpp?.pipelineStageName || null,
        source:             c.source || null,
        assignedTo:         c.assignedTo || null,
        assignedToName:     usersById[c.assignedTo] || null,
        leadPrice:          readCustomFieldValue(c, fieldMap.leadPrice),
        callCount:          readCustomFieldValue(c, fieldMap.callCount),
        dispositionDate:    readCustomFieldValue(c, fieldMap.dispositionDate),
        badLeadDate:        readCustomFieldValue(c, fieldMap.badLeadDate),
        smsReplyDate:       readCustomFieldValue(c, fieldMap.smsReplyDate),
        oppSoldDate:        readCustomFieldValue(c, fieldMap.oppSoldDate),
        quotedTimestamp:    readCustomFieldValue(c, fieldMap.quotedTimestamp),
        xdatedReason:       readCustomFieldValue(c, fieldMap.xdatedReason),
        leadProfile:        readCustomFieldValue(c, fieldMap.leadProfile),
        badLeadReason:      readCustomFieldValue(c, fieldMap.badLeadReason),
        optOutDate:         readCustomFieldValue(c, fieldMap.optOutDate),
        subSource:          readCustomFieldValue(c, fieldMap.subSource),
        customFields:       resolveAllCustomFields(c, fieldsById),
        opportunities:      opps,
      }
    })

  const missingFields = Object.entries(fieldMap)
    .filter(([, v]) => v === null)
    .map(([k]) => k)

  return { leads, missingFields }
}
