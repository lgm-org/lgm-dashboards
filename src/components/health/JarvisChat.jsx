import { useState, useRef, useEffect, useMemo } from 'react'
import { subDays, format } from 'date-fns'
import { useMergedHealthData } from '../../hooks/useMergedHealthData'
import { scoreAccount, classify, isAtRisk, isUpsellReady, suggestAddon } from '../../lib/healthEngine'

const SAMPLE_QUESTIONS = [
  'Which accounts are most at risk of churning this month?',
  'Who are my top upsell opportunities right now?',
  'What is our current MRR and how many accounts are Stripe-matched?',
  'Show me all accounts that cancelled in the last 90 days.',
  'How does our churn rate compare across 30, 60, and 90-day cohorts?',
  'Which DM accounts have the lowest health scores?',
]

const DATA_SOURCES = [
  { icon: '🔗', label: 'GHL', desc: '280+ sub-accounts', done: true },
  { icon: '💳', label: 'Stripe', desc: 'Billing & subscriptions', done: true },
  { icon: '📞', label: 'Call Intel', desc: 'Call records & outcomes', done: false },
  { icon: '🎫', label: 'Freshdesk', desc: 'Support tickets', done: false },
  { icon: '📊', label: 'LC Wallet', desc: "Cliff's LC data", done: false },
]

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-brand-muted/50"
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

function DataSourceGrid({ sources, show }) {
  if (!show) return null
  return (
    <div className="mb-6 grid grid-cols-2 sm:grid-cols-5 gap-2">
      {sources.map(({ icon, label, desc, done }) => (
        <div key={label}
          className="bg-white border border-brand-border rounded-xl p-3 flex flex-col items-center text-center gap-1.5 relative overflow-hidden">
          <span className="text-xl">{icon}</span>
          <span className="text-[11px] font-semibold text-brand-heading">{label}</span>
          <span className="text-[10px] text-brand-muted leading-tight">{desc}</span>
          <div className={`w-1.5 h-1.5 rounded-full mt-0.5 ${done ? 'bg-[#8CC63F]' : 'bg-amber-400'}`} />
          <span className={`text-[9px] font-medium ${done ? 'text-[#8CC63F]' : 'text-amber-600'}`}>
            {done ? 'Connected' : 'Pending'}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function JarvisChat() {
  const { accounts: rawAccounts, loading: dataLoading } = useMergedHealthData()

  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Hi — I'm Jarvis, LGM's internal AI analyst.\n\nI'm connected to your GHL sub-account database and Stripe billing. Ask me anything about account health, churn risk, MRR, upsell opportunities, or recent cancellations across all accounts.",
    },
  ])
  const [input, setInput]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [showSamples, setShowSamples] = useState(true)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Build compact context from live account data ─────────────────────────────
  const jarvisContext = useMemo(() => {
    if (!rawAccounts || rawAccounts.length === 0) return null

    const maxRev = Math.max(...rawAccounts.map(a => a.totalRev || 0), 1)

    const accounts = rawAccounts.map(a => {
      const score = scoreAccount(a, { maxRev })
      return {
        ...a,
        _score: score,
        _band:  classify(score),
        _atRisk:  isAtRisk(a),
        _upsell:  isUpsellReady(a),
        _addon:   suggestAddon(a),
      }
    })

    const stripeMatched = accounts.filter(a => a._stripeBound)
    const totalMRR      = stripeMatched.reduce((s, a) => s + (a.planPrice || 0), 0)

    const healthy  = accounts.filter(a => a._band === 'healthy').length
    const watch    = accounts.filter(a => a._band === 'watch').length
    const atRisk   = accounts.filter(a => a._band === 'at_risk').length
    const dmCount  = accounts.filter(a => a.accountType === 'DM').length
    const agentCount = accounts.filter(a => a.accountType === 'Agent').length

    const today = new Date()

    function cohortChurn(days) {
      const cutoff = format(subDays(today, days), 'yyyy-MM-dd')
      const cohort = accounts.filter(a => {
        const start = a.stripeStartDate || a.ghlDateAdded || ''
        return a._stripeBound && start >= cutoff
      })
      const churned = cohort.filter(a => !!a.canceledAt)
      return cohort.length > 0 ? Math.round((churned.length / cohort.length) * 1000) / 10 : null
    }

    const topAtRisk = accounts
      .filter(a => a._atRisk && !a.canceledAt)
      .sort((a, b) => a._score - b._score)
      .slice(0, 15)
      .map(a => ({
        name: a.accountName,
        score: Math.round(a._score),
        mrr: a.planPrice || 0,
        type: a.accountType || '—',
        issue: a.transactions < 3500 ? 'Low transactions (<3500/mo)' : 'Low health score',
      }))

    const topUpsell = accounts
      .filter(a => a._upsell && !a.canceledAt)
      .sort((a, b) => (b._addon?.estExtra || 0) - (a._addon?.estExtra || 0))
      .slice(0, 10)
      .map(a => ({
        name: a.accountName,
        score: Math.round(a._score),
        mrr: a.planPrice || 0,
        estExtra: a._addon?.estExtra || 0,
        addon: a._addon?.addon || 'N/A',
      }))

    const cutoff90 = format(subDays(today, 90), 'yyyy-MM-dd')
    const recentCancellations = accounts
      .filter(a => a.canceledAt && a.canceledAt >= cutoff90)
      .sort((a, b) => (b.canceledAt || '').localeCompare(a.canceledAt || ''))
      .slice(0, 15)
      .map(a => ({
        name: a.accountName,
        mrr: a.planPrice || 0,
        canceledAt: a.canceledAt,
        type: a.accountType || '—',
      }))

    return {
      asOf: format(today, 'yyyy-MM-dd'),
      totalAccounts: accounts.length,
      stripeMatched: stripeMatched.length,
      healthy, watch, atRisk,
      totalMRR,
      dmCount, agentCount,
      cohort30: cohortChurn(30),
      cohort60: cohortChurn(60),
      cohort90: cohortChurn(90),
      logoChurnLastMonth: null,
      logoChurnAvg6m:     null,
      topAtRisk, topUpsell, recentCancellations,
    }
  }, [rawAccounts])

  // ── Send message ─────────────────────────────────────────────────────────────
  async function handleSend(text) {
    const q = (text || input).trim()
    if (!q || loading) return
    setInput('')
    setShowSamples(false)
    setLoading(true)

    const history = messages.filter(m => !m.typing)
    const nextHistory = [...history, { role: 'user', content: q }]

    setMessages([...nextHistory, { role: 'assistant', typing: true, content: '' }])

    try {
      const res = await fetch('/api/jarvis-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextHistory.map(m => ({ role: m.role, content: m.content })),
          context:  jarvisContext,
        }),
      })

      const data  = await res.json()
      const reply = res.ok
        ? (data.content || 'No response received.')
        : (data.error   || `Error ${res.status} — please try again.`)

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

  const isReady = !dataLoading && !!jarvisContext

  return (
    <div className="max-w-3xl mx-auto px-4 pb-8 flex flex-col" style={{ minHeight: 'calc(100vh - 160px)' }}>

      {/* Status banner — shown only while data is loading */}
      {dataLoading && (
        <div className="mt-6 mb-6 flex items-center gap-2.5 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-800">
          <span className="text-base flex-shrink-0">⏳</span>
          <span>Loading account data…</span>
        </div>
      )}

      {/* Data sources grid */}
      <DataSourceGrid sources={DATA_SOURCES} show={showSamples} />

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
              <button
                key={i}
                onClick={() => handleSend(q)}
                disabled={!isReady}
                className="text-[12px] bg-white border border-brand-border text-brand-text rounded-full px-3 py-1.5
                  hover:border-[#8CC63F] hover:text-[#8CC63F] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
              >
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
          placeholder={isReady ? 'Ask about your accounts, churn, MRR, upsell…' : 'Loading data…'}
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
        GHL + Stripe connected · Call Intelligence and Freshdesk coming soon
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
