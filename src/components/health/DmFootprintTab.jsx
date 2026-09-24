import { useState, useMemo, useEffect, useRef } from 'react'
import { useRole } from '../../contexts/RoleContext'

const G   = '#8CC63F'
const AMB = '#EAB308'
const RED = '#EF4444'

const RANK_BADGE = ['🥇', '🥈', '🥉']

function fmt$(n) { return n > 0 ? '$' + Math.round(n).toLocaleString() : '$0' }

function bandColor(band) {
  if (band === 'healthy') return G
  if (band === 'watch')   return AMB
  if (band === 'no_data') return '#9CA3AF'
  return RED
}

function HealthPill({ score, band }) {
  const c = bandColor(band ?? 'no_data')
  return (
    <span className="num inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border"
      style={{ color: c, background: `${c}12`, borderColor: `${c}28` }}>
      {score ?? '—'}
    </span>
  )
}

function KpiTile({ label, value, sub, color, onClick }) {
  return (
    <div
      className={`rounded-2xl border border-brand-border bg-white px-4 py-3.5 flex flex-col gap-1 ${onClick ? 'cursor-pointer hover:border-brand-green/50 transition-colors' : ''}`}
      style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
      onClick={onClick}
    >
      <span className="text-[9px] font-bold uppercase tracking-widest text-brand-muted">{label}</span>
      <span className="text-[24px] font-bold leading-none num" style={{ color: color || '#1A1A1A' }}>{value}</span>
      {sub && <span className="text-[10px] text-brand-muted">{sub}</span>}
    </div>
  )
}

function DmCard({ group, rank, selected, onClick, isAdmin }) {
  const hasRank = rank < 3
  const borderStyle = selected
    ? { borderColor: G, boxShadow: `0 0 0 2px ${G}35, 0 4px 16px rgba(0,0,0,0.08)` }
    : { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }

  return (
    <div
      onClick={onClick}
      className="rounded-2xl border bg-white cursor-pointer transition-all duration-150 overflow-hidden select-none"
      style={borderStyle}
    >
      {/* Header strip */}
      <div className="px-3.5 pt-3 pb-2.5 border-b border-brand-border/60"
        style={{ background: selected ? `${G}08` : undefined }}>
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            {hasRank && <span className="text-[11px] leading-none">{RANK_BADGE[rank]}</span>}
            <p className="text-[12px] font-semibold text-brand-heading leading-tight mt-0.5 truncate" title={group.name}>
              {group.name}
            </p>
          </div>
          {group.atRiskCount > 0 && (
            <span className="flex-shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded border bg-red-50 border-red-200 text-red-600">
              {group.atRiskCount} at-risk
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="px-3.5 py-2.5 space-y-1.5">
        {isAdmin && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-brand-muted">District MRR</span>
            <span className="num font-bold text-[12px]" style={{ color: G }}>{fmt$(group.totalMRR)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-brand-muted">Agents</span>
          <span className="num font-semibold text-brand-text">{group.agentCount} <span className="text-brand-muted font-normal">({group.billedCount} billed)</span></span>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-brand-muted">Avg Health</span>
          {group.avgHealth !== null
            ? <span className="num font-bold text-[11px]" style={{ color: bandColor(group.avgHealth >= 70 ? 'healthy' : group.avgHealth >= 40 ? 'watch' : 'at_risk') }}>{group.avgHealth}</span>
            : <span className="text-brand-border">—</span>}
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-brand-muted">Active 30d</span>
          <span className="num font-semibold text-brand-text">{group.activityPct}%</span>
        </div>
        {group.newCount > 0 && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-brand-muted">New this mo.</span>
            <span className="num font-semibold" style={{ color: G }}>+{group.newCount}</span>
          </div>
        )}
      </div>

      {/* Footer tap hint */}
      <div className="px-3.5 pb-2.5">
        <span className="text-[9px] text-brand-muted/60">{selected ? '▲ collapse agents' : '▼ view agents'}</span>
      </div>
    </div>
  )
}

function AgentTable({ group, onAccountClick, isAdmin }) {
  return (
    <div className="rounded-2xl border border-brand-border bg-white overflow-hidden animate-fade-in-up"
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.04)' }}>

      <div className="px-5 py-3.5 border-b border-brand-border flex items-center justify-between">
        <div>
          <h3 className="text-brand-heading font-semibold text-sm">
            {group.name} — Agent Portfolio
          </h3>
          <p className="text-brand-muted text-[10px] mt-0.5">
            {group.agentCount} agents{isAdmin ? ` · ${fmt$(group.totalMRR)} district MRR` : ''} · click a row to open details
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && <span className="num text-[13px] font-bold" style={{ color: G }}>{fmt$(group.totalMRR)}</span>}
          {group.avgHealth !== null && (
            <span className="num text-[11px] font-bold px-2 py-0.5 rounded-full border"
              style={{ color: bandColor(group.avgHealth >= 70 ? 'healthy' : group.avgHealth >= 40 ? 'watch' : 'at_risk'), borderColor: `${bandColor(group.avgHealth >= 70 ? 'healthy' : group.avgHealth >= 40 ? 'watch' : 'at_risk')}28`, background: `${bandColor(group.avgHealth >= 70 ? 'healthy' : group.avgHealth >= 40 ? 'watch' : 'at_risk')}12` }}>
              avg {group.avgHealth}
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-brand-border bg-brand-bg/50">
              {['Agent', 'Joined', ...(isAdmin ? ['Status', 'MRR', 'Plan'] : []), 'Activity', 'Health'].map(h => (
                <th key={h} className={`px-3 py-2 first:pl-5 last:pr-4 text-[9px] font-bold uppercase tracking-widest text-brand-muted ${h === 'MRR' || h === 'Plan' ? 'text-right' : h === 'Status' || h === 'Activity' || h === 'Health' ? 'text-center' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.agents.map(a => {
              const bound   = a._stripeBound
              const churned = a.stripeStatus === 'canceled'
              const days    = a.lastActivity
              const dNum    = days !== null && days !== undefined ? Number(days) : null
              const actColor = dNum === null ? null : dNum <= 7 ? G : dNum <= 30 ? AMB : RED
              const actLabel = dNum === null ? '—' : dNum === 0 ? 'Today' : `${dNum}d`

              return (
                <tr
                  key={a.id}
                  onClick={() => onAccountClick?.(a)}
                  className="border-b border-brand-border/40 hover:bg-brand-bg/60 cursor-pointer transition-colors duration-100"
                  style={churned ? { background: '#FEF2F210' } : {}}
                >
                  {/* Agent name */}
                  <td className="pl-5 pr-2 py-2">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-medium text-brand-text truncate max-w-[160px]">{a.accountName}</span>
                      {churned && <span className="text-[8px] font-bold px-1 py-0.5 rounded border border-red-200 bg-red-50 text-red-600 flex-shrink-0">CHR</span>}
                      {!bound && <span className="text-[8px] font-bold px-1 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700 flex-shrink-0">UNMATCHED</span>}
                    </div>
                    {a._dm?.agentName && (
                      <div className="text-[9px] text-brand-muted mt-0.5 truncate max-w-[160px]">{a._dm.agentName}</div>
                    )}
                  </td>

                  {/* Joined */}
                  <td className="px-2 py-2 text-[10px] text-brand-muted whitespace-nowrap">
                    {a.ghlDateAdded
                      ? new Date(a.ghlDateAdded + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                      : '—'}
                  </td>

                  {/* Billing columns — admin only */}
                  {isAdmin && (
                    <td className="px-2 py-2 text-center">
                      {bound ? (
                        <span className="inline-flex flex-col items-center gap-0.5">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                            a.stripeCanceling                 ? 'bg-amber-50 border-amber-300 text-amber-700' :
                            a.stripeStatus === 'active'       ? 'bg-green-50 border-green-200 text-green-700' :
                            a.stripeStatus === 'trialing'     ? 'bg-blue-50 border-blue-200 text-blue-700' :
                            a.stripeStatus === 'past_due'     ? 'bg-orange-50 border-orange-200 text-orange-700' :
                            a.stripeStatus === 'open_invoice' ? 'bg-amber-50 border-amber-300 text-amber-700' :
                            a.stripeStatus === 'paused'       ? 'bg-yellow-50 border-yellow-300 text-yellow-700' :
                            'bg-red-50 border-red-200 text-red-600'
                          }`}>
                            {a.stripeCanceling ? 'canceling' : a.stripeStatus === 'open_invoice' ? 'open invoice' : (a.stripeStatus ?? '—')}
                          </span>
                          {a.ghlDisabled && (
                            <span className="text-[8px] font-bold px-1 py-0.5 rounded border bg-purple-50 border-purple-200 text-purple-700 whitespace-nowrap">GHL paused</span>
                          )}
                        </span>
                      ) : a.ghlDisabled ? (
                        <span className="text-[8px] font-bold px-1 py-0.5 rounded border bg-purple-50 border-purple-200 text-purple-700 whitespace-nowrap">GHL paused</span>
                      ) : <span className="text-brand-border text-[10px]">—</span>}
                    </td>
                  )}
                  {isAdmin && (
                    <td className="px-2 py-2 text-right">
                      {bound && a.totalRev > 0
                        ? <span className="num text-[11px] font-semibold text-brand-text">${Math.round(a.totalRev).toLocaleString()}</span>
                        : <span className="text-brand-border text-[10px]">—</span>}
                    </td>
                  )}
                  {isAdmin && (
                    <td className="px-2 py-2 text-right">
                      {bound && a.planPrice > 0
                        ? <span className="num text-[10px] text-brand-text">${Math.round(a.planPrice).toLocaleString()}</span>
                        : <span className="text-brand-border text-[10px]">—</span>}
                    </td>
                  )}

                  {/* Activity */}
                  <td className="px-2 py-2 text-center">
                    {dNum !== null
                      ? <span className="num inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border"
                          style={{ color: actColor, background: `${actColor}12`, borderColor: `${actColor}28` }}>
                          {actLabel}
                        </span>
                      : <span className="text-brand-muted text-[10px]">—</span>}
                  </td>

                  {/* Health */}
                  <td className="px-2 pr-4 py-2 text-center">
                    <HealthPill score={a._health?.score ?? null} band={a._health?.band} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function DmFootprintTab({ accounts, dmMap, onAccountClick }) {
  const { isAdmin }                 = useRole()
  const [selectedDm, setSelectedDm] = useState(null)
  const [sortBy, setSortBy]         = useState(isAdmin ? 'mrr' : 'agents')
  const [search, setSearch]         = useState('')
  const agentTableRef               = useRef(null)

  const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Auto-scroll to agent table when a DM card is expanded
  useEffect(() => {
    if (!selectedDm) return
    const id = setTimeout(() => {
      agentTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
    return () => clearTimeout(id)
  }, [selectedDm])

  // Build per-DM groups from the accounts list (accounts already enriched with _dm)
  const dmGroups = useMemo(() => {
    const groups = {}
    accounts.forEach(a => {
      const entry = a._dm
      if (!entry?.dmName) return
      const name = entry.dmName
      if (!groups[name]) groups[name] = { name, agents: [] }
      groups[name].agents.push(a)
    })

    return Object.values(groups).map(g => {
      const billed  = g.agents.filter(a => a._stripeBound && a.totalRev > 0)
      const scores  = g.agents.filter(a => a._health?.score != null).map(a => a._health.score)
      const active  = g.agents.filter(a => { const d = Number(a.lastActivity ?? 9999); return d <= 30 })
      const newA    = g.agents.filter(a => (a.ghlDateAdded || '') >= cutoff30)
      const atRisk  = g.agents.filter(a => a._health?.band === 'at_risk')

      return {
        name:        g.name,
        agents:      [...g.agents].sort((a, b) => (b.totalRev || 0) - (a.totalRev || 0)),
        agentCount:  g.agents.length,
        billedCount: billed.length,
        totalMRR:    billed.reduce((s, a) => s + a.totalRev, 0),
        avgHealth:   scores.length
          ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length)
          : null,
        activityPct: g.agents.length ? Math.round(active.length / g.agents.length * 100) : 0,
        newCount:    newA.length,
        atRiskCount: atRisk.length,
      }
    })
  }, [accounts, cutoff30])

  const sorted = useMemo(() => {
    let list = [...dmGroups]
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(g => g.name.toLowerCase().includes(s))
    }
    if (sortBy === 'mrr')    list.sort((a, b) => b.totalMRR    - a.totalMRR)
    if (sortBy === 'agents') list.sort((a, b) => b.agentCount  - a.agentCount)
    if (sortBy === 'health') list.sort((a, b) => (b.avgHealth ?? 0) - (a.avgHealth ?? 0))
    return list
  }, [dmGroups, sortBy, search])

  // KPIs
  const totalMRR       = dmGroups.reduce((s, g) => s + g.totalMRR, 0)
  const totalAgents    = dmGroups.reduce((s, g) => s + g.agentCount, 0)
  const totalAtRisk    = dmGroups.reduce((s, g) => s + g.atRiskCount, 0)
  const unmatchedCount = accounts.filter(a => !a._dm?.dmName).length

  const selectedGroup = sorted.find(g => g.name === selectedDm) || null

  const SORT_OPTS = [
    ...(isAdmin ? [{ key: 'mrr', label: 'MRR' }] : []),
    { key: 'agents', label: 'Agents' },
    { key: 'health', label: 'Health' },
  ]

  return (
    <div className="space-y-5">

      {/* KPI strip */}
      <div className={`grid gap-3 ${isAdmin ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3'}`}>
        <KpiTile label="DMs Tracked"     value={dmGroups.length} color={G} />
        {isAdmin && (
          <KpiTile label="Referred MRR"  value={fmt$(totalMRR)}  color={G} sub="from DM-referred agents" />
        )}
        <KpiTile label="Referred Agents" value={totalAgents}     color="#1A1A1A" sub="across all DMs" />
        <KpiTile
          label="At-Risk Agents"
          value={totalAtRisk}
          color={totalAtRisk > 0 ? RED : G}
          sub={`${unmatchedCount} accounts with no DM data`}
        />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input
            type="text"
            placeholder="Search DMs…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-[11px] rounded-lg border border-brand-border bg-white text-brand-text placeholder-brand-muted focus:outline-none focus:ring-1"
            style={{ focusRingColor: G }}
          />
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-brand-border bg-white p-0.5">
          {SORT_OPTS.map(o => (
            <button
              key={o.key}
              onClick={() => setSortBy(o.key)}
              className="px-3 py-1 rounded-lg text-[10px] font-semibold transition-all duration-100"
              style={sortBy === o.key
                ? { background: G, color: '#fff', boxShadow: `0 1px 4px ${G}40` }
                : { color: '#6B7280' }}
            >
              {o.label}
            </button>
          ))}
        </div>

        <span className="text-[10px] text-brand-muted ml-auto">
          {sorted.length} DM{sorted.length !== 1 ? 's' : ''}
          {sorted.length !== dmGroups.length ? ` of ${dmGroups.length}` : ''}
        </span>
      </div>

      {/* Empty state */}
      {sorted.length === 0 && (
        <div className="rounded-2xl border border-brand-border bg-white py-16 text-center">
          {dmGroups.length === 0 ? (
            <>
              <p className="text-3xl mb-3">🔗</p>
              <p className="text-brand-heading font-semibold text-sm">No DM data loaded yet</p>
              <p className="text-brand-muted text-[11px] mt-1">
                The n8n hourly sync populates <code className="bg-brand-bg px-1 rounded">dm_agent_map</code> in Supabase.
                Check that the schedule workflow is active in n8n.
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl mb-3">🔍</p>
              <p className="text-brand-heading font-semibold text-sm">No DMs match "{search}"</p>
              <button onClick={() => setSearch('')} className="mt-3 text-[11px] font-semibold" style={{ color: G }}>Clear search</button>
            </>
          )}
        </div>
      )}

      {/* DM card grid */}
      {sorted.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {sorted.map((g, i) => (
            <DmCard
              key={g.name}
              group={g}
              rank={i}
              selected={selectedDm === g.name}
              onClick={() => setSelectedDm(selectedDm === g.name ? null : g.name)}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}

      {/* Expanded agent table for selected DM */}
      <div ref={agentTableRef}>
        {selectedGroup && (
          <AgentTable group={selectedGroup} onAccountClick={onAccountClick} isAdmin={isAdmin} />
        )}
      </div>

      {/* No DM data note */}
      {unmatchedCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-100 bg-amber-50/60 text-[11px] text-amber-700">
          <span>⚠</span>
          <span>
            <strong>{unmatchedCount}</strong> accounts have no DM in Supabase — they show UNMATCHED in the All Accounts tab.
            These are either direct sign-ups or the GHL contact is missing the DM Name field.
          </span>
        </div>
      )}
    </div>
  )
}
