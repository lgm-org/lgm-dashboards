import { useState, useRef, useEffect, useMemo } from 'react'
import { subDays, format } from 'date-fns'
import { useMergedHealthData } from '../../hooks/useMergedHealthData'
import { useLogoChurn }        from '../../hooks/useLogoChurn'
import {
  scoreAccount, classify, isAtRisk, isUpsellReady, suggestAddon, recommendAction,
} from '../../lib/healthEngine'

const SAMPLE_QUESTIONS = [
  'Which accounts are most at risk right now?',
  'Show me all accounts scheduled to cancel.',
  'Who are my top upsell opportunities and how much MRR could we add?',
  'What is our current MRR breakdown by health band?',
  'Show me all DM accounts with a health score below 50.',
  'What does our churn look like across 30, 60, and 90-day cohorts?',
  'Which states have the most at-risk accounts?',
  'Are there any urgent open support tickets?',
]

const DATA_SOURCES_CONFIG = [
  { icon: '🔗', label: 'GHL',        desc: 'All sub-accounts',      key: 'ghl'       },
  { icon: '💳', label: 'Stripe',     desc: 'Billing & MRR',         key: 'stripe'    },
  { icon: '📊', label: 'Logo Churn', desc: "Cliff's monthly model",  key: 'logoChurn' },
  { icon: '🎫', label: 'Freshdesk',  desc: 'Support tickets',        key: 'freshdesk' },
  { icon: '📞', label: 'Call Intel', desc: 'Call records',           key: 'calls'     },
]

// ── Sub-components ────────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map(i => (
        <span key={i} className="w-1.5 h-1.5 rounded-full bg-brand-muted/50"
          style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
    </div>
  )
}

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mr-2 mt-0.5"
          style={{ background: 'linear-gradient(135deg, #8CC63F, #6aab2e)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2zm0 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm0 5c-1.5 0-4 .75-4 2.25V15h8v-.75C16 12.75 13.5 12 12 12z"
              fill="white"/>
          </svg>
        </div>
      )}
      <div
        className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'text-white rounded-br-sm'
            : 'bg-white border border-brand-border text-brand-text rounded-bl-sm'
        }`}
        style={isUser ? { background: 'linear-gradient(135deg, #8CC63F, #6aab2e)' } : {}}
      >
        {msg.typing ? <TypingDots /> : msg.content}
      </div>
    </div>
  )
}

function DataSourceGrid({ connected, show }) {
  if (!show) return null
  return (
    <div className="mb-6 grid grid-cols-2 sm:grid-cols-5 gap-2">
      {DATA_SOURCES_CONFIG.map(({ icon, label, desc, key }) => {
        const done = connected[key] ?? false
        return (
          <div key={label}
            className="bg-white border border-brand-border rounded-xl p-3 flex flex-col items-center text-center gap-1.5">
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
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function JarvisChat() {
  const { accounts: rawAccounts, loading: ghlLoading } = useMergedHealthData()
  const logoChurn = useLogoChurn()

  const [fdTickets, setFdTickets] = useState(null)
  const [fdLoading, setFdLoading] = useState(true)

  useEffect(() => {
    fetch('/api/freshdesk-summary')
      .then(r => r.json())
      .then(d => { if (!d.error) setFdTickets(d) })
      .catch(() => {})
      .finally(() => setFdLoading(false))
  }, [])

  const [messages, setMessages] = useState([{
    role: 'assistant',
    intro: true,
    content: "Hi — I'm Jarvis, LGM's internal AI analyst.\n\nI'm connected to your GHL sub-account database, Stripe billing, logo churn model, and Freshdesk support tickets. Ask me anything about any account, churn trends, MRR, upsell opportunities, or support issues.",
  }])
  const [input,       setInput]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [showSamples, setShowSamples] = useState(true)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Build compact account list for API ──────────────────────────────────────
  const jarvisData = useMemo(() => {
    if (!rawAccounts || rawAccounts.length === 0) return null

    const today  = new Date()

    const accounts = rawAccounts.map(a => {
      const { score } = scoreAccount(a)
      const band      = classify(score)
      const addon     = suggestAddon(a)
      const action    = recommendAction(a)
      return {
        id:         a.ghlId,
        name:       a.accountName,
        type:       a.accountType || 'Unknown',
        band,
        score:      Math.round(score),
        mrr:        a.planPrice     || 0,
        users:      a.users         || 0,
        txns:       a.transactions  || 0,
        start:      a.stripeStartDate || a.ghlDateAdded || null,
        cancel:     a.canceledAt    || null,
        pending:    !!(a.stripeCanceling && !a.canceledAt),
        state:      a.ghlState      || null,
        email:      a.ghlEmail      || null,
        lastActive: a.lastActivity  ?? null,
        addon:      addon?.label    || null,
        estExtra:   addon?.estExtra || 0,
        action,
      }
    })

    const active        = accounts.filter(a => !a.cancel)
    const stripeMatched = accounts.filter(a => (a.mrr || 0) > 0)
    const totalMRR      = active.reduce((s, a) => s + (a.mrr || 0), 0)
    const healthy       = accounts.filter(a => a.band === 'healthy').length
    const watch         = accounts.filter(a => a.band === 'watch').length
    const atRisk        = accounts.filter(a => a.band === 'at_risk').length
    const dmCount       = active.filter(a => a.type === 'DM').length
    const agentCount    = active.filter(a => a.type === 'Agent').length
    const scheduled     = active.filter(a => a.pending).length

    function cohortChurn(days) {
      const cutoff = format(subDays(today, days), 'yyyy-MM-dd')
      const cohort = accounts.filter(a => {
        const start = a.start || ''
        return (a.mrr > 0) && start >= cutoff
      })
      const churned = cohort.filter(a => !!a.cancel)
      return cohort.length > 0 ? Math.round((churned.length / cohort.length) * 1000) / 10 : null
    }

    const summary = {
      asOf:          format(today, 'yyyy-MM-dd'),
      totalAccounts: accounts.length,
      stripeMatched: stripeMatched.length,
      healthy, watch, atRisk,
      totalMRR,
      avgMRR:        stripeMatched.length > 0 ? Math.round(totalMRR / stripeMatched.length) : 0,
      dmCount, agentCount,
      scheduledCancel: scheduled,
      cohort30: cohortChurn(30),
      cohort60: cohortChurn(60),
      cohort90: cohortChurn(90),
      openTickets: fdTickets?.openCount ?? null,
    }

    const tickets = fdTickets?.tickets || []

    return {
      summary,
      accounts,
      tickets,
      logoChurn: logoChurn.data || null,
    }
  }, [rawAccounts, fdTickets, logoChurn.data])

  const connected = {
    ghl:        !ghlLoading && !!jarvisData,
    stripe:     !ghlLoading && !!(jarvisData?.accounts?.some(a => a.mrr > 0)),
    logoChurn:  !logoChurn.loading && !!logoChurn.data,
    freshdesk:  !fdLoading && !!fdTickets,
    calls:      false,
  }

  const isReady = !ghlLoading && !!jarvisData

  // ── Send message ───────────────────────────────────────────────────────────
  async function handleSend(text) {
    const q = (text || input).trim()
    if (!q || loading) return
    setInput('')
    setShowSamples(false)
    setLoading(true)

    // Exclude the intro greeting from API messages (API requires user-first alternation)
    const history    = messages.filter(m => !m.typing && !m.intro)
    const nextHistory = [...history, { role: 'user', content: q }]

    setMessages([...messages.filter(m => !m.typing), { role: 'user', content: q }, { role: 'assistant', typing: true, content: '' }])

    try {
      const res = await fetch('/api/jarvis-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextHistory.map(m => ({ role: m.role, content: m.content })),
          data:     jarvisData,
        }),
      })

      const body  = await res.json()
      const reply = res.ok
        ? (body.content || 'No response received.')
        : (body.error   || `Error ${res.status}`)

      setMessages(prev => {
        const copy = [...prev]
        copy[copy.length - 1] = { role: 'assistant', content: reply }
        return copy
      })
    } catch {
      setMessages(prev => {
        const copy = [...prev]
        copy[copy.length - 1] = { role: 'assistant', content: 'Connection error — please try again.' }
        return copy
      })
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-8 flex flex-col" style={{ minHeight: 'calc(100vh - 160px)' }}>

      {/* Loading indicator while GHL data initialises */}
      {ghlLoading && (
        <div className="mt-6 mb-4 flex items-center gap-2 text-xs text-brand-muted">
          <span className="w-3 h-3 rounded-full border-2 border-brand-green border-t-transparent animate-spin" />
          Loading account data…
        </div>
      )}

      {/* Data sources grid */}
      <DataSourceGrid connected={connected} show={showSamples} />

      {/* Chat area */}
      <div className="flex-1 min-h-0 overflow-y-auto mb-4">
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Sample questions */}
      {showSamples && (
        <div className="mb-4">
          <p className="text-[11px] text-brand-muted font-medium mb-2 tracking-wide uppercase">Try asking:</p>
          <div className="flex flex-wrap gap-2">
            {SAMPLE_QUESTIONS.map((q, i) => (
              <button key={i} onClick={() => handleSend(q)} disabled={!isReady}
                className="text-[12px] bg-white border border-brand-border text-brand-text rounded-full px-3 py-1.5
                  hover:border-[#8CC63F] hover:text-[#8CC63F] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed">
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="flex gap-2 bg-white border border-brand-border rounded-2xl px-4 py-3"
        style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isReady ? 'Ask about any account, churn, MRR, tickets, upsell…' : 'Loading data…'}
          disabled={!isReady}
          rows={1}
          className="flex-1 resize-none text-sm text-brand-text placeholder-brand-muted/60 outline-none bg-transparent leading-relaxed disabled:cursor-not-allowed"
          style={{ maxHeight: '120px' }}
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || loading || !isReady}
          className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #8CC63F, #6aab2e)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="white" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      <p className="text-center text-[10px] text-brand-muted/50 mt-2">
        GHL · Stripe · Logo Churn · Freshdesk · Call Intelligence coming soon
      </p>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-5px); }
        }
      `}</style>
    </div>
  )
}
