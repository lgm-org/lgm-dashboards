// Jarvis — Team Intelligence assistant over every analyzed call and meeting.
// Home = prompt library by category + scope filters; chat = streaming answers with sources.
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { format, subDays } from 'date-fns'
import { PROMPT_LIBRARY } from './promptLibrary'
import { MessageBubble, HistorySidebar, JarvisAvatar } from './JarvisUI'

const G = '#8CC63F'
const HISTORY_NS = 'team:' // keeps Team Intelligence chats apart from the Customer Health Jarvis in the same table
// Header (60) + view switcher (41); the active-calls bar, when present, adds a little and is tolerated
const CHROME_PX = 101

const RANGES = [
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d',  label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
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

function scopeSummary(scope) {
  const parts = [RANGES.find(r => r.id === scope.range)?.label || 'All time']
  if (scope.range === 'custom' && (scope.custom.from || scope.custom.to)) parts[0] = `${scope.custom.from || '…'} → ${scope.custom.to || '…'}`
  if (scope.callType !== 'all') parts.push(scope.callType === 'Meeting' ? 'meetings' : 'phone calls')
  if (scope.employees.length) parts.push(scope.employees.length === 1 ? scope.employees[0] : `${scope.employees.length} employees`)
  if (scope.customer.trim()) parts.push(`“${scope.customer.trim()}”`)
  return parts.join(' · ')
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

// ── Small controls ────────────────────────────────────────────────────────────
function useClickOutside(ref, onClose) {
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [ref, onClose])
}

function EmployeePicker({ employees, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef(null)
  useClickOutside(ref, useCallback(() => setOpen(false), []))
  const shown = employees.filter(e => e.toLowerCase().includes(q.toLowerCase()))
  const toggle = name => onChange(selected.includes(name) ? selected.filter(e => e !== name) : [...selected, name])
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)}
        className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all ${selected.length ? 'text-white border-transparent' : 'bg-brand-bg text-brand-text border-brand-border hover:border-brand-green'}`}
        style={selected.length ? { background: G } : {}}>
        {selected.length ? `${selected.length} employee${selected.length > 1 ? 's' : ''}` : 'All employees'} ▾
      </button>
      {open && (
        <div className="absolute z-40 mt-1 left-0 w-64 max-w-[calc(100vw-2rem)] bg-white border border-brand-border rounded-xl shadow-lg p-2">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
            className="w-full text-[11px] border border-brand-border rounded-lg px-2 py-1.5 mb-2 focus:outline-none focus:border-brand-green" />
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {shown.map(name => (
              <label key={name} className="flex items-center gap-2 text-[12px] text-brand-text px-2 py-1 rounded-lg hover:bg-brand-bg cursor-pointer">
                <input type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)} className="accent-[#8CC63F]" />
                <span className="truncate">{name}</span>
              </label>
            ))}
            {!shown.length && <p className="text-[11px] text-brand-muted px-2 py-2">No matches</p>}
          </div>
          {selected.length > 0 && (
            <button onClick={() => onChange([])} className="mt-2 w-full text-[11px] text-brand-muted hover:text-brand-heading py-1">Clear selection</button>
          )}
        </div>
      )}
    </div>
  )
}

function ScopeBar({ scope, setScope, employees }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-0.5 bg-brand-bg border border-brand-border rounded-lg p-0.5 overflow-x-auto max-w-full">
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
      <EmployeePicker employees={employees} selected={scope.employees} onChange={v => setScope(s => ({ ...s, employees: v }))} />
      <input value={scope.customer} onChange={e => setScope(s => ({ ...s, customer: e.target.value }))} placeholder="Customer / account…"
        className="text-[11px] border border-brand-border rounded-lg px-2.5 py-1.5 bg-brand-bg text-brand-text w-40 focus:outline-none focus:border-brand-green" />
    </div>
  )
}

// ── Prompt library ────────────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [done, setDone] = useState(false)
  return (
    <button title="Copy prompt" aria-label="Copy prompt"
      onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200) }}
      className="text-[10px] text-brand-muted hover:text-brand-heading px-1.5 py-0.5 rounded border border-brand-border/60 hover:border-brand-border bg-white flex-shrink-0 transition-all">
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

function PromptLibrary({ onPick, disabled }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-3">
      {PROMPT_LIBRARY.map(cat => (
        <section key={cat.id} className="bg-white border border-brand-border rounded-2xl flex flex-col overflow-hidden"
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.05)', borderTop: `3px solid ${cat.color}` }}>
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-lg leading-none">{cat.icon}</span>
              <h3 className="text-[13px] font-bold text-brand-heading">{cat.title}</h3>
            </div>
            <p className="text-[11px] text-brand-muted mt-1 leading-snug">{cat.goal}</p>
          </div>
          {/* Every prompt in full, scrollable when the card runs out of room */}
          <ul className="px-3 pb-3 space-y-1.5 overflow-y-auto" style={{ maxHeight: 300 }}>
            {cat.prompts.map((p, i) => (
              <li key={i}>
                <div role="button" tabIndex={0} aria-disabled={disabled}
                  onClick={() => !disabled && onPick(p)}
                  onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPick(p) } }}
                  className={`flex items-start gap-2 rounded-xl border border-brand-border bg-brand-bg/40 px-3 py-2 transition-colors ${disabled ? 'opacity-60 cursor-not-allowed' : 'hover:border-brand-green hover:bg-white cursor-pointer'}`}>
                  <span className="text-[12px] text-brand-text leading-snug flex-1 whitespace-normal break-words">{p}</span>
                  <CopyButton text={p} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
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
  const [showScope, setShowScope] = useState(false)
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
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages])

  // Textarea grows with its content up to a cap
  const autosize = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }
  useEffect(autosize, [input])

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
      if (!finalContent) {
        finalContent = 'The connection dropped before Jarvis finished. Please ask again.'
        setMessages(prev => { const c = [...prev]; c[c.length - 1] = { role: 'assistant', content: finalContent }; return c })
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
      setShowHistory(false)
    } catch {}
  }
  async function deleteChat(id) {
    try {
      await fetch(`/api/jarvis-history?email=${encodeURIComponent(historyKey)}&id=${id}`, { method: 'DELETE' })
      setChatList(prev => prev.filter(c => c.id !== id))
      if (id === chatId) newChat()
    } catch {}
  }
  function newChat() { setChatId(null); setMessages([]); setInput(''); setShowHistory(false); setTimeout(() => inputRef.current?.focus(), 0) }

  const inChat = messages.length > 0

  return (
    <div className="relative flex bg-brand-bg" style={{ height: `calc(100vh - ${CHROME_PX}px)` }}>

      {/* History — drawer on small screens, column on large */}
      {showHistory && (
        <>
          <div className="fixed inset-0 bg-black/30 z-30 lg:hidden" onClick={() => setShowHistory(false)} />
          <aside className="fixed inset-y-0 left-0 z-40 w-72 bg-white border-r border-brand-border lg:static lg:z-auto lg:w-64 lg:flex-shrink-0">
            <HistorySidebar chats={chatList} currentId={chatId} onSelect={selectChat} onDelete={deleteChat} onNewChat={newChat} />
          </aside>
        </>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <div className="flex-shrink-0 border-b border-brand-border bg-white/80 backdrop-blur">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center gap-2">
            <button onClick={() => setShowHistory(v => !v)}
              className={`text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-all ${showHistory ? 'text-white border-transparent' : 'bg-white text-brand-muted border-brand-border hover:border-brand-green hover:text-brand-green'}`}
              style={showHistory ? { background: G } : {}}>
              History{chatList.length ? ` (${chatList.length})` : ''}
            </button>
            {inChat && (
              <button onClick={newChat} className="text-[11px] font-medium px-3 py-1.5 rounded-lg border border-brand-border bg-white text-brand-muted hover:border-brand-green hover:text-brand-green transition-all">
                + New conversation
              </button>
            )}
            <div className="ml-auto flex items-center gap-2 min-w-0">
              <span className="hidden sm:block text-[11px] text-brand-muted truncate max-w-[40vw]">Scope: <span className="text-brand-heading font-medium">{scopeSummary(scope)}</span></span>
              <button onClick={() => setShowScope(v => !v)}
                className={`text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-all ${showScope ? 'text-white border-transparent' : 'bg-white text-brand-muted border-brand-border hover:border-brand-green hover:text-brand-green'}`}
                style={showScope ? { background: G } : {}}>
                {showScope ? 'Done' : 'Change scope'}
              </button>
            </div>
          </div>
          {(showScope || !inChat) && (
            <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-3">
              <ScopeBar scope={scope} setScope={setScope} employees={employees} />
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5">
            {!inChat ? (
              <>
                <div className="flex items-start gap-4 mb-5">
                  <JarvisAvatar size={48} />
                  <div className="min-w-0">
                    <h1 className="text-2xl font-extrabold text-brand-heading leading-tight">{greeting(userEmail)}</h1>
                    <p className="text-sm text-brand-muted mt-1 max-w-2xl">
                      What would you like to know about your business? I've read every recorded customer call and meeting — ask about coaching, training needs, customer risk, revenue signals, commitments, or what happened this week. Every answer cites the conversations it comes from.
                    </p>
                  </div>
                </div>
                <p className="text-[10px] font-bold text-brand-muted uppercase tracking-wider mb-2">Prompt library — click a question to run it, or write your own below</p>
                <PromptLibrary onPick={p => handleSend(p)} disabled={loading} />
              </>
            ) : (
              <>
                {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
                <div ref={bottomRef} />
              </>
            )}
          </div>
        </div>

        {/* Input — always visible at the bottom */}
        <div className="flex-shrink-0 border-t border-brand-border bg-brand-bg">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 w-full">
            <div className="flex items-end gap-2 bg-white border border-brand-border rounded-2xl px-4 py-2.5" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder={loading ? 'Jarvis is working…' : 'Ask about meetings, customer calls, employee performance, training opportunities…'}
                rows={1} disabled={loading}
                className="flex-1 resize-none text-sm text-brand-text placeholder-brand-muted/60 outline-none bg-transparent leading-relaxed py-1 disabled:cursor-not-allowed" />
              <button onClick={() => handleSend()} disabled={!input.trim() || loading}
                className="flex-shrink-0 w-8 h-8 mb-0.5 rounded-xl flex items-center justify-center transition-all disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #8CC63F, #6aab2e)' }} aria-label="Send">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
            <p className="text-center text-[10px] text-brand-muted/50 mt-1.5">
              Answers take about a minute and cite the calls they come from. Jarvis separates what was said from what it infers — a promise in a transcript is not proof it was done.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
