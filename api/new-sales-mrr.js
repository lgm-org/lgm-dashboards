// New Sale MRR for the Customer Health dashboard (per John, 2026-10-01):
//   GHL >> LGM's own sub-account >> Sales Pipeline >> "Payment Made" stage >> Status = Won
//   >> opportunity value = projected new MRR.
// Reuses the briefing loader so the dashboard and the morning emails can never disagree.
// Returns every qualifying won opportunity with its value and won date; the dashboard sums
// them for whatever date window is selected.

import { loadLgmWonSales } from './_briefingSources.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')
  try {
    const r = await loadLgmWonSales()
    if (!r.available) return res.status(503).json({ available: false, reason: r.reason, sales: [] })

    const stageId = r.stage?.id || null
    // John's rule needs the Payment Made stage. If the stage can't be found, say so instead of
    // silently counting every won deal in the pipeline.
    const sales = (r.sales || [])
      .filter(s => !stageId || s.stageId === stageId)
      .map(s => ({
        oppId: s.oppId, name: s.oppName, contactName: s.contactName, assignedTo: s.assignedToName,
        value: s.monetaryValue, wonAt: s.wonAt, wonDay: s.wonDay,
      }))
      .sort((a, b) => (b.wonAt || '').localeCompare(a.wonAt || ''))

    res.json({
      available: true,
      pipeline: r.pipeline, stage: r.stage,
      stageFound: !!stageId,
      totalWonInPipeline: (r.sales || []).length,
      sales,
      syncedAt: new Date().toISOString(),
    })
  } catch (err) {
    res.status(500).json({ available: false, reason: err.message, sales: [] })
  }
}
