// Jarvis — Team Intelligence assistant over every analyzed call and meeting.
// Home = prompt library by category + scope filters; chat = streaming answers with sources.
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { format, subDays } from 'date-fns'
import { PROMPT_LIBRARY } from './promptLibrary'
import { MessageBubble, HistorySidebar, JarvisAvatar } from './JarvisUI'

const G = '#8CC63F'
const HISTORY_NS = 'team:' // keeps Team Intelligence chats apart from the Customer Health Jarvis in the same table

const RANGES = [
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d',  label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
]

function rangeDates(range, custom) {
  const today = new Date()
  const iso = d => format(d, 'yyyy-MM-dd')
  switch (range) {
    case 'yesterday': { const y = subDays(today, 1); return { date_from: iso(y), date_to: iso(y) } }
    case '7d':  return { date_from: iso(subDays(today, 6)),  date_to: iso(today) }
    case '30d': return { date_from: iso(subDays(today, 29)), date_to: iso(today) }
    case '90d': return { date_from: iso(subDays(today, 89)), date_to: iso(today) }
    case 'custom': return { date_from: custom.from || undefined, date_to: custom.to || undefined }
    default: return {}
  }
}

function getUserEmail() {
  try {
    const raw = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('lgm-team-auth='))?.slice('lgm-team-auth='.length) || ''
    if (raw.startsWith('g.')) {
      const email = atob(raw.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')).split(':')[0]
      if (email.includes('@')) return email
    }
  } catch {}
  try {
    let id = localStorage.getItem('jarvis-user-id')
    if (!id) { id = 'anon-' + Math.random().toString(36).slice(2, 10); localStorage.setItem('jarvis-user-id', id) }
    return id
  } catch { return 'anon' }
}

function greeting(email) {
  const h = new Date().getHours()
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  const first = email.includes('@') ? email.split('@')[0].split(/[._-]/)[0] : ''
  return first ? `${part}, ${first.charAt(0).toUpperCase()}${first.slice(1)}` : part
}

const INTRO = "I'm Jarvis. I've read every recorded customer call and meeting — ask me about coaching, training needs, customer risk, revenue signals, commitments, or what happened this week. Every answer cites the conversations it comes from."

// ── Scope bar ─────────────────────────────────────────────────────────────────
function ScopeBar({ scope, setScope, employees, compact }) {
  const toggleEmp = name => setScope(s => ({ ...s, employees: s.employees.includes(name) ? s.employees.filter(e => e !== name) : [...s.employees, name] }))
  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'bg-white border border-brand-border rounded-2xl p-3'}`}>
      <div className="flex items-center gap-0.5 bg-brand-bg border border-brand-border rounded-lg p-0.5">
        {RANGES.map(r => (
          <button key={r.id} onClick={() => setScope(s => ({ ...s, range: r.id }))}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap transition-all ${scope.range === r.id ? 'text-white' : 'text-brand-muted hover:text-brand-text hover:bg-white'}`}
            style={scope.range === r.id ? { background: G } : {}}>
            {r.label}
          </button>
        ))}
      </div>
      {scope.range === 'custom' && (
        <div className="flex items-center gap-1 text-[11px]">
          <input type="date" value={scope.custom.from} onChange={e => setScope(s => ({ ...s, custom: { ...s.custom, from: e.target.value } }))}
            className="border border-brand-border rounded-lg px-2 py-1 bg-white text-brand-text" />
          <span className="text-brand-muted">to</span>
          <input type="date" value={scope.custom.to} onChange={e => setScope(s => ({ ...s, custom: { ...s.custom, to: e.target.value } }))}
            className="border border-brand-border rounded-lg px-2 py-1 bg-white text-brand-text" />
        </div>
      )}
      <select value={scope.callType} onChange={e => setScope(s => ({ ...s, callType: e.target.value }))}
        className="text-[11px] border border-brand-border rounded-lg px-2 py-1.5 bg-brand-bg text-brand-text">
        <option value="all">Calls + meetings</option>
        <option value="Phone Call">Phone calls only</option>
        <option value="Meeting">Meetings only</option>
      </select>
      <input value={scope.customer} onChange={e => setScope(s => ({ ...s, customer: e.target.value }))} placeholder="Customer / account…"
        className="text-[11px] border border-brand-border rounded-lg px-2.5 py-1.5 bg-brand-bg text-brand-text w-40 focus:outline-none focus:border-brand-green" />
      <div className="flex flex-wrap items-center gap-1">
        {employees.map(name => {
          const on = scope.employees.includes(name)
          return (
            <button key={name} onClick={() => toggleEmp(name)}
              className={`text-[10px] px-2 py-1 rounded-full border transition-all ${on ? 'text-white border-transparent' : 'bg-white text-brand-muted border-brand-border hover:border-brand-green hover:text-brand-green'}`}
              style={on ? { background: G } : {}}>
              {name.split(' ')[0]}
            </button>
          )
        })}
        {scope.employees.length > 0 && (
          <button onClick={() => setScope(s => ({ ...s, employees: [] }))} className="text-[10px] text-brand-muted underline ml-1">clear</button>
        )}
      </div>
    </div>
  )
}

// ── Prompt library ────────────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [done, setDone] = useState(false)
  return (
    <button title="Copy prompt" onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200) }}
      className="opacity-0 group-hover:opacity-100 text-[10px] text-brand-muted hover:text-brand-heading px-1.5 py-0.5 rounded border border-transparent hover:border-brand-border flex-shrink-0 transition-all">
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

function PromptLibrary({ onPick }) {
  const [open, setOpen] = useState(null)
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {PROMPT_LIBRARY.map(cat => {
        const expanded = open === cat.id
        return (
          <div key={cat.id} className={`bg-white border border-brand-border rounded-2xl p-4 flex flex-col ${expanded ? 'sm:col-span-2 xl:col-span-2' : ''}`}
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.05)', borderTop: `3px solid ${cat.color}` }}>
            <button onClick={() => setOpen(expanded ? null : cat.id)} className="text-left">
              <div className="flex items-center gap-2">
                <span className="text-lg">{cat.icon}</span>
                <span className="text-[13px] font-bold text-brand-heading">{cat.title}</span>
                <span className="ml-auto text-[10px] text-brand-muted">{expanded ? 'hide' : `${cat.prompts.length} prompts`}</span>
              </div>
              <p className="text-[11px] text-brand-muted mt-1 leading-snug">{cat.goal}</p>
            </button>
            {expanded && (
              <ul className="mt-3 space-y-1.5">
                {cat.prompts.map((p, i) => (
                  <li key={i} className="group flex items-start gap-2 rounded-xl border border-brand-border hover:border-brand-green bg-brand-bg/40 px-3 py-2 cursor-pointer transition-colors"
                    onClick={() => onPick(p)}>
                    <span className="text-[12px] text-brand-text leading-snug flex-1">{p}</span>
                    <CopyButton text={p} />
                  </li>
                ))}
              </ul>
            )}
            {!expanded && (
              <button onClick={() => onPick(cat.prompts[0])}
                className="mt-3 text-left text-[11px] text-brand-text bg-brand-bg/60 border border-brand-border rounded-xl px-3 py-2 hover:border-brand-green transition-colors line-clamp-2">
                {cat.prompts[0]}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function JarvisTeam({ employees = [] }) {
  const [userEmail] = useState(() => getUserEmail())
  const historyKey  = HISTORY_NS + userEmail

  const [scope, setScope] = useState({ range: '30d', custom: { from: '', to: '' }, employees: [], customer: '', callType: 'all' })
  const [messages, setMessages]   = useState([])
  const [input, setInput]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [chatId, setChatId]       = useState(null)
  const [chatList, setChatList]   = useState([])
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  const apiScope = useMemo(() => ({
    ...rangeDates(scope.range, scope.custom),
    employees: scope.employees,
    customer: scope.customer.trim() || undefined,
    call_type: scope.callType,
  }), [scope])

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/jarvis-history?email=${encodeURIComponent(historyKey)}`)
      const data = await res.json()
      if (Array.isArray(data)) setChatList(data)
    } catch {}
  }, [historyKey])
  useEffect(() => { loadHistory() }, [loadHistory])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const saveChat = useCallback(async (msgs, cid, title) => {
    const stored = msgs.map(m => ({ role: m.role, content: m.content }))
    try {
      const res = await fetch('/api/jarvis-history', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: historyKey, title, messages: stored, id: cid || undefined }),
      })
      const data = await res.json()
      if (data.id) { loadHistory(); return data.id }
    } catch {}
    return cid
  }, [historyKey, loadHistory])

  async function handleSend(text) {
    const q = (text ?? input).trim()
    if (!q || loading) return
    setInput('')
    setLoading(true)
    const history = messages.filter(m => !m.typing)
    const next = [...history, { role: 'user', content: q }]
    setMessages([...next, { role: 'assistant', typing: true, toolEvents: [], content: '' }])
    const title = chatId ? undefined : (q.length > 60 ? q.slice(0, 57) + '…' : q)

    let finalContent = ''
    try {
      const res = await fetch('/api/jarvis-team', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map(m => ({ role: m.role, content: m.content })), scope: apiScope }),
      })
      if (!res.ok) {
        let detail = ''
        try { detail = (await res.json()).error || '' } catch {}
        throw new Error(detail || `Request failed (${res.status})`)
      }
      const reader = res.body.getReader(), decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          let ev; try { ev = JSON.parse(line) } catch { continue }
          if (ev.type === 'tool_start') {
            setMessages(prev => { const c = [...prev]; const last = c[c.length - 1]; if (last?.typing) c[c.length - 1] = { ...last, toolEvents: [...last.toolEvents, ev.label] }; return c })
          } else if (ev.type === 'done' || ev.type === 'error') {
            finalContent = ev.type === 'done' ? (ev.content || '') : `Something went wrong: ${ev.message}`
            setMessages(prev => { const c = [...prev]; c[c.length - 1] = { role: 'assistant', content: finalContent }; return c })
          }
        }
      }
    } catch (err) {
      finalContent = `Couldn't reach Jarvis — ${err.message}`
      setMessages(prev => { const c = [...prev]; c[c.length - 1] = { role: 'assistant', content: finalContent }; return c })
    } finally {
      setLoading(false)
    }
    if (finalContent) {
      const id = await saveChat([...next, { role: 'assistant', content: finalContent }], chatId, title)
      if (!chatId && id) setChatId(id)
    }
  }

  async function selectChat(id) {
    try {
      const res = await fetch(`/api/jarvis-history?email=${encodeURIComponent(historyKey)}&id=${id}`)
      const data = await res.json()
      if (!data?.messages) return
      setChatId(id)
      setMessages(data.messages.map(m => ({ role: m.role, content: m.content })))
    } catch {}
  }
  async function deleteChat(id) {
    try {
      await fetch(`/api/jarvis-history?email=${encodeURIComponent(historyKey)}&id=${id}`, { method: 'DELETE' })
      setChatList(prev => prev.filter(c => c.id !== id))
      if (id === chatId) newChat()
    } catch {}
  }
  function newChat() { setChatId(null); setMessages([]); setInput(''); inputRef.current?.focus() }

  const inChat = messages.length > 0

  return (
    <div className="flex" style={{ minHeight: 'calc(100vh - 110px)' }}>
      {showHistory && (
        <div className="w-60 flex-shrink-0 border-r border-brand-border bg-white">
          <HistorySidebar chats={chatList} currentId={chatId} onSelect={selectChat} onDelete={deleteChat} onNewChat={newChat} />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5">

            {/* Top bar */}
            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => setShowHistory(v => !v)}
                className={`text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-all ${showHistory ? 'text-white border-transparent' : 'bg-white text-brand-muted border-brand-border hover:border-brand-green hover:text-brand-green'}`}
                style={showHistory ? { background: G } : {}}>
                History
              </button>
              {inChat && (
                <button onClick={newChat} className="text-[11px] font-medium px-3 py-1.5 rounded-lg border border-brand-border bg-white text-brand-muted hover:border-brand-green hover:text-brand-green transition-all">
                  + New conversation
                </button>
              )}
              {inChat && <div className="ml-auto"><ScopeBar scope={scope} setScope={setScope} employees={employees} compact /></div>}
            </div>

            {!inChat ? (
              <>
                <div className="flex items-start gap-4 mb-5">
                  <JarvisAvatar size={48} />
                  <div>
                    <h1 className="text-2xl font-extrabold text-brand-heading leading-tight">{greeting(userEmail)}</h1>
                    <p className="text-sm text-brand-muted mt-1 max-w-2xl">What would you like to know about your business? {INTRO}</p>
                  </div>
                </div>
                <div className="mb-5">
                  <p className="text-[10px] font-bold text-brand-muted uppercase tracking-wider mb-2">Scope for your questions</p>
                  <ScopeBar scope={scope} setScope={setScope} employees={employees} />
                </div>
                <p className="text-[10px] font-bold text-brand-muted uppercase tracking-wider mb-2">Prompt library — click a question to run it, or write your own below</p>
                <PromptLibrary onPick={p => handleSend(p)} />
              </>
            ) : (
              <>
                {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
                <div ref={bottomRef} />
              </>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-5 pt-2 w-full">
          <div className="flex gap-2 bg-white border border-brand-border rounded-2xl px-4 py-3" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Ask about meetings, customer calls, employee performance, training opportunities…"
              rows={1} disabled={loading}
              className="flex-1 resize-none text-sm text-brand-text placeholder-brand-muted/60 outline-none bg-transparent leading-relaxed" style={{ maxHeight: 140 }} />
            <button onClick={() => handleSend()} disabled={!input.trim() || loading}
              className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #8CC63F, #6aab2e)' }} aria-label="Send">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          <p className="text-center text-[10px] text-brand-muted/50 mt-1.5">
            Answers cite the calls they come from. Jarvis separates what was said from what it infers — a promise in a transcript is not proof it was done.
          </p>
        </div>
      </div>
    </div>
  )
}
