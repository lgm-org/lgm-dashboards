// Vercel cron — refreshes ghl_account_stats / health_score_daily for every sub-account before the
// daily briefings go out. The health dashboard only runs the batch sync when someone opens it, so
// without this the 6am emails would use whatever the last visitor left behind.
//
// Schedule: every 10 min 09:00–10:50 UTC on weekdays. Each run continues from a per-day cursor
// stored in ghl_tokens (key briefing:health_sync:<day>) and stops after ~4 minutes; the next run
// picks up where it left off. ~330 accounts × 20 per batch = 17 batches ≈ 2-3 runs.

import { runSync } from './ghl-sync-activity-batch.js'
import { kv } from './_supabase.js'
import { localDay } from './_briefingSources.js'

const TIME_BUDGET_MS = 240_000

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (process.env.VITE_APP_MODE !== 'health') {
    return res.status(200).json({ skipped: `not the health project (VITE_APP_MODE=${process.env.VITE_APP_MODE || 'unset'})` })
  }

  const day = localDay()
  const key = `briefing:health_sync:${day}`
  const cursor = (await kv.get(key)) || { skip: 0, done: false, batches: [] }
  if (cursor.done && req.query.force !== '1') return res.json({ day, skipped: 'already complete today', cursor })

  const started = Date.now()
  let skip = req.query.force === '1' ? 0 : cursor.skip
  const batches = []
  try {
    while (Date.now() - started < TIME_BUDGET_MS) {
      const { status, body } = await runSync({ skip })
      batches.push({ skip, status, synced: body.synced, unchanged: body.unchanged, noToken: body.noToken, failed: body.failed, error: body.error })
      if (status !== 200) break
      if (!body.hasMore) { cursor.done = true; break }
      skip = body.nextSkip
    }
  } catch (err) {
    batches.push({ skip, error: err.message })
  }
  cursor.skip = cursor.done ? skip : skip
  cursor.batches = [...(cursor.batches || []), ...batches].slice(-40)
  cursor.updatedAt = new Date().toISOString()
  await kv.set(key, cursor)
  res.json({ day, done: cursor.done, nextSkip: skip, ranBatches: batches.length, elapsedMs: Date.now() - started, batches })
}
