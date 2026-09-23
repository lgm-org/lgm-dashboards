// Read-only diagnostic: GHL's raw record for one sub-account via the agency key.
// Used to see status fields (paused / SaaS / snapshot state) that the list endpoint hides.
const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VER  = '2021-07-28'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const { locationId } = req.query
  if (!locationId) return res.status(400).json({ error: 'Missing locationId' })
  const agencyKey = process.env.GHL_AGENCY_API_KEY
  if (!agencyKey) return res.status(500).json({ error: 'GHL_AGENCY_API_KEY not configured' })

  const r = await fetch(`${GHL_BASE}/locations/${locationId}`, {
    headers: { Authorization: `Bearer ${agencyKey}`, Version: GHL_VER },
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  res.status(r.status).json(json ?? { raw: text.slice(0, 2000) })
}
