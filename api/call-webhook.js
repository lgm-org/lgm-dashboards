// GHL webhook receiver for live phone call tracking.
// Handles InboundCallConnected / OutboundCallConnected → upsert into active_calls.
// Handles CallCompleted / MissedCall / VoicemailCompleted / NoAnswer → delete from active_calls.
// The active_calls table has Supabase Realtime enabled, so the frontend updates instantly.
//
// Configure in GHL on LGM's own internal sub-account (NOT the marketplace app):
//   Sub-account → Settings → Integrations → Webhooks → Add Webhook
//   URL: https://calls.littlegiantmarketing.com/api/call-webhook
//   Events: InboundCallConnected, OutboundCallConnected, CallCompleted, MissedCall
//
// This fires only for LGM team calls — not client sub-accounts.
//
// Optional: set GHL_WEBHOOK_SECRET in Vercel env vars to the webhook key shown in GHL
// for signature verification. If not set, the endpoint accepts all POST requests.

import { createClient } from '@supabase/supabase-js';
import { createHmac }   from 'node:crypto';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const CALL_START_EVENTS = new Set(['InboundCallConnected', 'OutboundCallConnected']);
const CALL_END_EVENTS   = new Set(['CallCompleted', 'MissedCall', 'VoicemailCompleted', 'NoAnswer']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify GHL webhook HMAC signature when the shared secret is configured
  const secret = process.env.GHL_WEBHOOK_SECRET;
  if (secret) {
    const sig      = req.headers['x-ghl-signature'] || '';
    const rawBody  = JSON.stringify(req.body);
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (sig !== expected) {
      console.warn('[call-webhook] signature mismatch — rejecting');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const payload = req.body || {};
  const { type, callId, locationId, userId, fullName, firstName, lastName,
          contactName, phone, direction } = payload;

  if (!type || !callId) return res.status(400).json({ error: 'Missing type or callId' });

  if (CALL_START_EVENTS.has(type)) {
    const agentName = fullName
      || [firstName, lastName].filter(Boolean).join(' ')
      || 'Unknown';
    const dir = direction || (type === 'InboundCallConnected' ? 'inbound' : 'outbound');

    const { error } = await sb.from('active_calls').upsert({
      id:            callId,
      agent_name:    agentName,
      agent_id:      userId   || null,
      contact_name:  contactName || null,
      contact_phone: phone    || null,
      direction:     dir,
      location_id:   locationId || null,
      started_at:    new Date().toISOString(),
    }, { onConflict: 'id' });

    if (error) console.error('[call-webhook] upsert error:', error.message);
    return res.status(200).json({ ok: true, action: 'started', callId });
  }

  if (CALL_END_EVENTS.has(type)) {
    await sb.from('active_calls').delete().eq('id', callId);

    if (type === 'MissedCall') {
      const agentName = fullName
        || [firstName, lastName].filter(Boolean).join(' ')
        || null;
      const { error: missedErr } = await sb.from('missed_calls').upsert({
        id:            callId,
        contact_name:  contactName || null,
        contact_phone: phone       || null,
        agent_name:    agentName,
        agent_id:      userId      || null,
        direction:     direction   || 'inbound',
        location_id:   locationId  || null,
        missed_at:     new Date().toISOString(),
      }, { onConflict: 'id' });
      if (missedErr) console.error('[call-webhook] missed_calls upsert error:', missedErr.message);
    }

    return res.status(200).json({ ok: true, action: 'ended', callId });
  }

  // Unknown event type — acknowledge so GHL doesn't retry
  return res.status(200).json({ ok: true, action: 'ignored', type });
}
