// CRUD for Jarvis chat history stored in Supabase jarvis_chats table.
// GET  ?email=x           → list of conversations (id, title, updated_at)
// GET  ?email=x&id=uuid   → full conversation with messages
// POST { email, title, messages, id? } → create or update
// DELETE ?email=x&id=uuid  → delete

import { createClient } from '@supabase/supabase-js'

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'GET') {
    const { email, id } = req.query
    if (!email) return res.status(400).json({ error: 'email required' })

    if (id) {
      const { data, error } = await db()
        .from('jarvis_chats')
        .select('*')
        .eq('id', id)
        .eq('user_email', email)
        .maybeSingle()
      if (error) return res.status(500).json({ error: error.message })
      return res.json(data || null)
    }

    const { data, error } = await db()
      .from('jarvis_chats')
      .select('id, title, created_at, updated_at')
      .eq('user_email', email)
      .order('updated_at', { ascending: false })
      .limit(60)
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data || [])
  }

  if (req.method === 'POST') {
    const { email, title, messages, id } = req.body || {}
    if (!email || !messages) return res.status(400).json({ error: 'email and messages required' })
    const now = new Date().toISOString()

    if (id) {
      const { error } = await db()
        .from('jarvis_chats')
        .update({ messages, title: title || 'Conversation', updated_at: now })
        .eq('id', id)
        .eq('user_email', email)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ id })
    }

    const { data, error } = await db()
      .from('jarvis_chats')
      .insert({ user_email: email, title: title || 'New conversation', messages, created_at: now, updated_at: now })
      .select('id')
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ id: data.id })
  }

  if (req.method === 'DELETE') {
    const { email, id } = req.query
    if (!email || !id) return res.status(400).json({ error: 'email and id required' })
    const { error } = await db()
      .from('jarvis_chats')
      .delete()
      .eq('id', id)
      .eq('user_email', email)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  return res.status(405).end()
}
