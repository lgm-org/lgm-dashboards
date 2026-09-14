import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { subDays, format } from 'date-fns'
import { useMergedHealthData } from '../../hooks/useMergedHealthData'
import { useLogoChurn }        from '../../hooks/useLogoChurn'
import {
  scoreAccount, classify, isUpsellReady, suggestAddon, recommendAction,
} from '../../lib/healthEngine'

// ── Cookie helpers ────────────────────────────────────────────────────────────
function getUserEmail() {
  try {
    const raw = document.cookie.split(';').map(c => c.trim())
      .find(c => c.startsWith('lgm-health-auth='))?.slice('lgm-health-auth='.length) || ''
    if (raw.startsWith('g.')) {
      const decoded = atob(raw.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
      return decoded.split(':')[0] || null
    }
  } catch {}
  return null
}

// ── Simple markdown renderer ──────────────────────────────────────────────────
function parseInline(text) {
  const parts = []
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g
  let last = 0, key = 0, m
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[0].startsWith('**'))      parts.push(<strong key={key++}>{m[2]}</strong>)
    else if (m[0].startsWith('*'))  parts.push(<em key={key++}>{m[3]}</em>)
    else parts.push(<code key={key++} className="bg-brand-bg/80 px-1 rounded text-[0.85em] font-mono">{m[4]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function MarkdownText({ text }) {
  if (!text) return null
  const lines  = text.split('\n')
  const result = []
  let listItems = [], listType = null
  let key = 0

  const flushList = () => {
    if (!listItems.length) return
    const Tag = listType === 'ol' ? 'ol' : 'ul'
    result.push(
      <Tag key={key++} className={`my-1 pl-5 space-y-0.5 ${Tag === 'ol' ? 'list-decimal' : 'list-disc'}`}>
        {listItems.map((item, i) => <li key={i} className="leading-relaxed">{parseInline(item)}</li>)}
      </Tag>
    )
    listItems = []; listType = null
  }

  for (const raw of lines) {
    const stripped = raw.replace(/^#{1,4}\s+/, '')
    const wasHeader = raw !== stripped

    const bullet = stripped.match(/^[-•*]\s+(.+)/)
    const numbed = stripped.match(/^\d+\.\s+(.+)/)

    if (bullet) { if (listType !== 'ul') { flushList(); listType = 'ul' }; listItems.push(bullet[1]); continue }
    if (numbed) { if (listType !== 'ol') { flushList(); listType = 'ol' }; listItems.push(numbed[1]); continue }

    flushList()

    if (!stripped.trim()) { result.push(<br key={key++} />); continue }

    if (wasHeader) {
      result.push(<p key={key++} className="font-semibold mt-2 leading-relaxed">{parseInline(stripped)}</p>)
    } else {
      result.push(<p key={key++} className="leading-relaxed">{parseInline(stripped)}</p>)
    }
  }
  flushList()
  return <div className="space-y-0.5">{result}</div>
}

// ── Tool-use typing bubble ────────────────────────────────────────────────────
function TypingBubble({ toolEvents }) {
  return (
    <div className="flex justify-start mb-3">
      <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mr-2 mt-0.5"
        style={{ background: 'linear-gradient(135deg, #8CC63F, #6aab2e)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2zm0 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm0 5c-1.5 0-4 .75-4 2.25V15h8v-.75C16 12.75 13.5 12 12 12z" fill="white"/>
        </svg>
      </div>
      <div className="bg-white border border-brand-border rounded-2xl rounded-bl-sm px-4 py-3">
        {toolEvents.length > 0 ? (
          <div className="space-y-1.5 text-[11px]">
            {toolEvents.map((ev, i) => {
              const isDone    = i < toolEvents.length - 1
              const isCurrent = i === toolEvents.length - 1
              return (
                <div key={i} className={`flex items-center gap-2 ${isDone ? 'opacity-50' : ''}`}>
                  {isDone ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="#8CC63F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    <span className="w-3 h-3 rounded-full border-2 flex-shrink-0"
                      style={{ borderColor: '#8CC63F', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                  )}
                  <span className={`${isCurrent ? 'text-brand-heading font-medium' : 'text-brand-muted line-through'}`}>
                    {ev}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex items-center gap-1 py-0.5">
            {[0,1,2].map(i => (
              <span key={i} className="w-1.5 h-1.5 rounded-full bg-brand-muted/50"
                style={{ animation: `bounce 1.2s ease-in-out ${i*0.2}s infinite` }} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  if (msg.typing) return <TypingBubble toolEvents={msg.toolEvents || []} />
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mr-2 mt-0.5"
          style={{ background: 'linear-gradient(135deg, #8CC63F, #6aab2e)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2zm0 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm0 5c-1.5 0-4 .75-4 2.25V15h8v-.75C16 12.75 13.5 12 12 12z" fill="white"/>
          </svg>
        </div>
      )}
      <div
        className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm ${
          isUser
            ? 'text-white rounded-br-sm'
            : 'bg-white border border-brand-border text-brand-text rounded-bl-sm'
        }`}
        style={isUser ? { background: 'linear-gradient(135deg, #8CC63F, #6aab2e)' } : {}}
      >
        {isUser
          ? <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
          : <MarkdownText text={msg.content} />
        }
      </div>
    </div>
  )
}

// ── History sidebar ───────────────────────────────────────────────────────────
function groupByDate(chats) {
  const today    = format(new Date(), 'yyyy-MM-dd')
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')
  const weekAgo   = format(subDays(new Date(), 7), 'yyyy-MM-dd')
  const groups    = { Today: [], Yesterday: [], 'Last 7 days': [], Older: [] }
  for (const c of chats) {
    const d = (c.updated_at || '').slice(0, 10)
    if (d === today)        groups.Today.push(c)
    else if (d === yesterday) groups.Yesterday.push(c)
    else if (d >= weekAgo)  groups['Last 7 days'].push(c)
    else                    groups.Older.push(c)
  }
  return groups
}

function HistorySidebar({ chats, currentId, onSelect, onDelete, onNewChat }) {
  const groups = groupByDate(chats)
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-brand-border">
        <button onClick={onNewChat}
          className="w-full flex items-center justify-center gap-1.5 text-[12px] font-medium text-brand-heading
            bg-white border border-brand-border rounded-xl py-2 hover:border-brand-green hover:text-brand-green transition-colors">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          New chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {Object.entries(groups).map(([group, items]) => {
          if (!items.length) return null
          return (
            <div key={group}>
              <p className="text-[9px] uppercase tracking-wider text-brand-muted/60 px-2 py-1.5 font-semibold">{group}</p>
              {items.map(chat => (
                <div key={chat.id}
                  onClick={() => onSelect(chat.id)}
                  className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer text-[11px] hover:bg-brand-bg transition-colors ${
                    chat.id === currentId ? 'bg-brand-bg/80 font-medium text-brand-heading' : 'text-brand-text'
                  }`}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="flex-shrink-0 text-brand-muted">
                    <path d="M9 1.5H1a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h1.5l1.5 1.5 1.5-1.5H9a.5.5 0 0 0 .5-.5V2A.5.5 0 0 0 9 1.5z" stroke="currentColor" strokeWidth="0.75"/>
                  </svg>
                  <span className="flex-1 truncate">{chat.title}</span>
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(chat.id) }}
                    className="opacity-0 group-hover:opacity-100 text-brand-muted hover:text-red-500 flex-shrink-0 p-0.5 rounded transition-all"
                    title="Delete">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )
        })}
        {chats.length === 0 && (
          <p className="text-[11px] text-brand-muted/60 text-center py-8 px-3">
            Your conversations will appear here.
          </p>
        )}
      </div>
    </div>
  )
}

// ── Data sources ──────────────────────────────────────────────────────────────
const DATA_SOURCES = [
  { icon: '🔗', label: 'GHL',        desc: 'All sub-accounts',     key: 'ghl'       },
  { icon: '💳', label: 'Stripe',     desc: 'Billing & MRR',        key: 'stripe'    },
  { icon: '📊', label: 'Logo Churn', desc: 'Monthly churn model',  key: 'logoChurn' },
  { icon: '🎫', label: 'Freshdesk',  desc: 'Support tickets',      key: 'freshdesk' },
  { icon: '📞', label: 'Call Intel', desc: 'Call records',         key: 'calls'     },
]

const SAMPLE_QUESTIONS = [
  'Which accounts are most at risk right now?',
  'Show me all accounts scheduled to cancel.',
  'Top upsell opportunities — how much MRR could we add?',
  'Break down our MRR by health band.',
  'What does our churn look like across 30, 60, and 90-day cohorts?',
  'Are there any urgent open support tickets?',
  'Which states have the most at-risk accounts?',
  'Show me all DM accounts with a score below 50.',
]

// ── Main component ────────────────────────────────────────────────────────────
export default function JarvisChat() {
  const { accounts: rawAccounts, loading: ghlLoading } = useMergedHealthData()
  const logoChurn = useLogoChurn()

  const [fdTickets,  setFdTickets]  = useState(null)
  const [fdLoading,  setFdLoading]  = useState(true)

  const [messages,    setMessages]    = useState([{ role: 'assistant', intro: true, content: "Hi — I'm Jarvis, LGM's internal AI analyst.\n\nI'm connected to your GHL database, Stripe billing, monthly churn model, and Freshdesk tickets. Ask me anything about any account, churn, MRR, upsell, or support." }])
  const [input,       setInput]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [showSamples, setShowSamples] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [chatId,      setChatId]      = useState(null)
  const [chatList,    setChatList]    = useState([])
  const [userEmail]                   = useState(() => getUserEmail())

  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  // Fetch Freshdesk tickets
  useEffect(() => {
    fetch('/api/freshdesk-summary').then(r => r.json())
      .then(d => { if (!d.error) setFdTickets(d) })
      .catch(() => {}).finally(() => setFdLoading(false))
  }, [])

  // Load chat history
  const loadHistory = useCallback(async () => {
    if (!userEmail) return
    try {
      const res = await fetch(`/api/jarvis-history?email=${encodeURIComponent(userEmail)}`)
      const data = await res.json()
      if (Array.isArray(data)) setChatList(data)
    } catch {}
  }, [userEmail])

  useEffect(() => { loadHistory() }, [loadHistory])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Build compact account context ──────────────────────────────────────────
  const jarvisData = useMemo(() => {
    if (!rawAccounts?.length) return null
    const today  = new Date()

    const accounts = rawAccounts.map(a => {
      const { score } = scoreAccount(a)
      const band      = classify(score)
      const addon     = suggestAddon(a)
      const action    = recommendAction(a)
      return {
        id: a.ghlId, name: a.accountName, type: a.accountType || 'Unknown',
        band, score: Math.round(score),
        mrr: a.planPrice || 0, users: a.users || 0, txns: a.transactions || 0,
        start: a.stripeStartDate || a.ghlDateAdded || null,
        cancel: a.canceledAt || null,
        pending: !!(a.stripeCanceling && !a.canceledAt),
        state: a.ghlState || null, email: a.ghlEmail || null,
        lastActive: a.lastActivity ?? null,
        addon: addon?.label || null, estExtra: addon?.estExtra || 0, action,
        calls: a.callStats ? {
          total:        a.callStats.totalCalls,
          lastDate:     a.callStats.lastCallDate,
          lastEmployee: a.callStats.lastCallEmployee,
          lastCategory: a.callStats.lastCallCategory,
          avgScore:     a.callStats.avgScore,
          frustrated:   a.callStats.frustratedCount,
          riskLevel:    a.callStats.riskLevel || null,
          categories:   a.callStats.categories,
          recent:       a.callStats.recentCalls?.slice(0, 3).map(c => ({
            date: c.date, employee: c.employee, score: c.score,
            category: c.category, sentiment: c.sentiment,
            frustrated: c.frustrated, summary: c.summary,
          })),
        } : null,
      }
    })

    const active        = accounts.filter(a => !a.cancel)
    const stripeMatched = accounts.filter(a => (a.mrr || 0) > 0)
    const totalMRR      = active.reduce((s, a) => s + (a.mrr || 0), 0)

    function cohortChurn(days) {
      const cutoff = format(subDays(today, days), 'yyyy-MM-dd')
      const cohort = accounts.filter(a => (a.mrr > 0) && (a.start || '') >= cutoff)
      const ch     = cohort.filter(a => !!a.cancel)
      return cohort.length > 0 ? Math.round((ch.length / cohort.length) * 1000) / 10 : null
    }

    return {
      summary: {
        asOf:          format(today, 'yyyy-MM-dd'),
        totalAccounts: accounts.length,
        stripeMatched: stripeMatched.length,
        healthy:       accounts.filter(a => a.band === 'healthy').length,
        watch:         accounts.filter(a => a.band === 'watch').length,
        atRisk:        accounts.filter(a => a.band === 'at_risk').length,
        totalMRR,
        avgMRR:        stripeMatched.length ? Math.round(totalMRR / stripeMatched.length) : 0,
        dmCount:       active.filter(a => a.type === 'DM').length,
        agentCount:    active.filter(a => a.type === 'Agent').length,
        scheduledCancel: active.filter(a => a.pending).length,
        cohort30: cohortChurn(30), cohort60: cohortChurn(60), cohort90: cohortChurn(90),
        openTickets: fdTickets?.openCount ?? null,
      },
      accounts,
      tickets:   fdTickets?.tickets || [],
      logoChurn: logoChurn.data || null,
    }
  }, [rawAccounts, fdTickets, logoChurn.data])

  const connected = {
    ghl:       !ghlLoading && !!jarvisData,
    stripe:    !ghlLoading && !!(jarvisData?.accounts?.some(a => a.mrr > 0)),
    logoChurn: !logoChurn.loading && !!logoChurn.data,
    freshdesk: !fdLoading && !!fdTickets,
    calls: !ghlLoading && !!(jarvisData?.accounts?.some(a => a.calls !== null)),
  }
  const isReady = !ghlLoading && !!jarvisData

  // ── Save current chat to Supabase ──────────────────────────────────────────
  const saveChat = useCallback(async (msgs, cid, title) => {
    if (!userEmail) return cid
    const stored = msgs.filter(m => !m.intro).map(m => ({ role: m.role, content: m.content }))
    if (!stored.length) return cid
    try {
      const res  = await fetch('/api/jarvis-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, title, messages: stored, id: cid || undefined }),
      })
      const data = await res.json()
      if (data.id) { loadHistory(); return data.id }
    } catch {}
    return cid
  }, [userEmail, loadHistory])

  // ── Send message ───────────────────────────────────────────────────────────
  async function handleSend(text) {
    const q = (text || input).trim()
    if (!q || loading) return
    setInput('')
    setShowSamples(false)
    setLoading(true)

    const history    = messages.filter(m => !m.typing && !m.intro)
    const nextHistory = [...history, { role: 'user', content: q }]
    const typingMsg   = { role: 'assistant', typing: true, toolEvents: [], content: '' }

    setMessages(prev => [...prev.filter(m => !m.typing), { role: 'user', content: q }, typingMsg])

    const chatTitle = chatId
      ? undefined
      : (q.length > 50 ? q.slice(0, 47) + '…' : q)

    let finalContent = ''

    try {
      const res = await fetch('/api/jarvis-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextHistory.map(m => ({ role: m.role, content: m.content })),
          data:     jarvisData,
        }),
      })

      if (!res.body) throw new Error('No response body')

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)

            if (event.type === 'tool_start') {
              setMessages(prev => {
                const copy = [...prev]
                const last = copy[copy.length - 1]
                if (last?.typing) copy[copy.length - 1] = { ...last, toolEvents: [...(last.toolEvents || []), event.label] }
                return copy
              })
            } else if (event.type === 'done') {
              finalContent = event.content || ''
              setMessages(prev => {
                const copy = [...prev]
                copy[copy.length - 1] = { role: 'assistant', content: finalContent }
                return copy
              })
            } else if (event.type === 'error') {
              finalContent = 'Something went wrong: ' + event.message
              setMessages(prev => {
                const copy = [...prev]
                copy[copy.length - 1] = { role: 'assistant', content: finalContent }
                return copy
              })
            }
          } catch {}
        }
      }
    } catch (err) {
      finalContent = 'Connection error — please try again.'
      setMessages(prev => {
        const copy = [...prev]
        copy[copy.length - 1] = { role: 'assistant', content: finalContent }
        return copy
      })
    } finally {
      setLoading(false)
    }

    // Save to history after response
    if (finalContent && userEmail) {
      const fullMsgs = [...nextHistory, { role: 'assistant', content: finalContent }]
      const newId = await saveChat(fullMsgs, chatId, chatTitle)
      if (!chatId && newId) setChatId(newId)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // ── Load a past conversation ───────────────────────────────────────────────
  async function selectChat(id) {
    if (!userEmail) return
    try {
      const res  = await fetch(`/api/jarvis-history?email=${encodeURIComponent(userEmail)}&id=${id}`)
      const data = await res.json()
      if (!data?.messages) return
      setChatId(id)
      setMessages([
        { role: 'assistant', intro: true, content: "Hi — I'm Jarvis, LGM's internal AI analyst.\n\nI'm connected to your GHL database, Stripe billing, monthly churn model, and Freshdesk tickets. Ask me anything about any account, churn, MRR, upsell, or support." },
        ...data.messages.map(m => ({ role: m.role, content: m.content })),
      ])
      setShowSamples(false)
    } catch {}
  }

  async function deleteChat(id) {
    if (!userEmail) return
    try {
      await fetch(`/api/jarvis-history?email=${encodeURIComponent(userEmail)}&id=${id}`, { method: 'DELETE' })
      setChatList(prev => prev.filter(c => c.id !== id))
      if (id === chatId) newChat()
    } catch {}
  }

  function newChat() {
    setChatId(null)
    setMessages([{ role: 'assistant', intro: true, content: "Hi — I'm Jarvis, LGM's internal AI analyst.\n\nI'm connected to your GHL database, Stripe billing, monthly churn model, and Freshdesk tickets. Ask me anything about any account, churn, MRR, upsell, or support." }])
    setInput('')
    setShowSamples(true)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex" style={{ height: 'calc(100vh - 64px)' }}>

      {/* History sidebar */}
      {showHistory && (
        <div className="w-56 flex-shrink-0 border-r border-brand-border bg-white overflow-hidden flex flex-col">
          <HistorySidebar
            chats={chatList}
            currentId={chatId}
            onSelect={id => { selectChat(id); }}
            onDelete={deleteChat}
            onNewChat={newChat}
          />
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 pb-6">

            {/* Top bar */}
            <div className="flex items-center gap-3 pt-5 mb-5">
              <button
                onClick={() => setShowHistory(v => !v)}
                className={`flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-all ${
                  showHistory
                    ? 'bg-brand-green text-white border-brand-green'
                    : 'bg-white text-brand-muted border-brand-border hover:border-brand-green hover:text-brand-green'
                }`}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 3h10M1 6h10M1 9h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                History
              </button>
              {chatId && (
                <button onClick={newChat}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-lg border border-brand-border bg-white text-brand-muted hover:border-brand-green hover:text-brand-green transition-all">
                  + New chat
                </button>
              )}
              <div className="ml-auto flex items-center gap-1.5 text-[10px] text-brand-muted">
                <span className={`w-1.5 h-1.5 rounded-full ${isReady ? 'bg-brand-green' : 'bg-amber-400'}`} />
                {isReady ? 'Live data connected' : 'Loading…'}
              </div>
            </div>

            {/* Data sources grid (only on fresh chat) */}
            {showSamples && (
              <div className="mb-5 grid grid-cols-2 sm:grid-cols-5 gap-2">
                {DATA_SOURCES.map(({ icon, label, desc, key }) => {
                  const done = connected[key] ?? false
                  return (
                    <div key={label} className="bg-white border border-brand-border rounded-xl p-3 flex flex-col items-center text-center gap-1.5">
                      <span className="text-xl">{icon}</span>
                      <span className="text-[11px] font-semibold text-brand-heading">{label}</span>
                      <span className="text-[10px] text-brand-muted leading-tight">{desc}</span>
                      <div className={`w-1.5 h-1.5 rounded-full mt-0.5 ${done ? 'bg-[#8CC63F]' : 'bg-amber-400'}`} />
                      <span className={`text-[9px] font-medium ${done ? 'text-[#8CC63F]' : 'text-amber-600'}`}>
                        {done ? 'Connected' : 'Pending'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Messages */}
            {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Sample questions */}
        {showSamples && (
          <div className="max-w-3xl mx-auto px-4 pb-3 w-full">
            <p className="text-[11px] text-brand-muted font-medium mb-2 tracking-wide uppercase">Try asking:</p>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_QUESTIONS.map((q, i) => (
                <button key={i} onClick={() => handleSend(q)} disabled={!isReady}
                  className="text-[12px] bg-white border border-brand-border text-brand-text rounded-full px-3 py-1.5
                    hover:border-[#8CC63F] hover:text-[#8CC63F] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input bar */}
        <div className="max-w-3xl mx-auto px-4 pb-5 pt-2 w-full">
          <div className="flex gap-2 bg-white border border-brand-border rounded-2xl px-4 py-3"
            style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <textarea
              ref={inputRef} value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isReady ? 'Ask about any account, churn, MRR, tickets, upsell…' : 'Loading data…'}
              disabled={!isReady} rows={1}
              className="flex-1 resize-none text-sm text-brand-text placeholder-brand-muted/60 outline-none bg-transparent leading-relaxed disabled:cursor-not-allowed"
              style={{ maxHeight: '120px' }}
            />
            <button onClick={() => handleSend()} disabled={!input.trim() || loading || !isReady}
              className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #8CC63F, #6aab2e)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
          <p className="text-center text-[10px] text-brand-muted/40 mt-1.5">
            GHL · Stripe · Monthly Churn · Freshdesk · Call Intelligence coming soon
          </p>
        </div>
      </div>

      <style>{`
        @keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
        @keyframes spin { to{transform:rotate(360deg)} }
      `}</style>
    </div>
  )
}
