import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Drop-in replacement for @vercel/kv — same get/set interface.
// GHL OAuth tokens live in the ghl_tokens table (server-side only, service key).
export const kv = {
  async get(key) {
    const { data } = await sb
      .from('ghl_tokens')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    return data?.value ?? null;
  },

  async set(key, value) {
    const { error } = await sb
      .from('ghl_tokens')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) console.error('[kv.set]', key, error.message);
  },

  async del(key) {
    await sb.from('ghl_tokens').delete().eq('key', key);
  },
};
