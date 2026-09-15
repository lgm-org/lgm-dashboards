import { useState } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { useMissedCalls } from '../hooks/useMissedCalls'
import { useMissedCallStatus } from '../hooks/useMissedCallStatus'

const G   = '#8CC63F'
const RED = '#EF4444'

function timeAgo(isoStr) {
  if (!isoStr) return '—'
  try { return formatDistanceToNow(parseISO(isoStr), { addSuffix: true }) } catch { return '—' }
}

function StatusBadge({ status }) {
  if (status === 'resolved') return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap"
      style={{ color: G, background: `${G}10`, borderColor: `${G}28` }}>✓ Called Back</span>
  )
  if (status === 'in_progress') return (
    <span className="inline-flex items-center gap-1 text-amber-700 text-[11px] font-semibold bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" /> Calling…
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-red-500 text-[11px] font-semibold bg-red-50 border border-red-200 px-2 py-0.5 rounded-full whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" /> Call Back
    </span>
  )
}

function ActionButtons({ id, status, setStatus }) {
  if (status === 'resolved') return (
    <button onClick={() => setStatus(id, null)}
      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-all"
      style={{ color: '#6B7280', borderColor: '#E5E7E5' }}>
      Undo
    </button>
  )
  if (status === 'in_progress') return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => setStatus(id, 'resolved')}
        className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-all text-white whitespace-nowrap"
        style={{ background: G, borderColor: G }}>
        ✓ Done
      </button>
      <button onClick={() => setStatus(id, null)}
        className="text-[11px] font-semibold px-2 py-1.5 rounded-lg border transition-all whitespace-nowrap"
        style={{ color: '#6B7280', borderColor: '#E5E7E5' }} title="Reset">↩</button>
    </div>
  )
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => setStatus(id, 'in_progress')}
        className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all whitespace-nowrap"
        style={{ color: '#D97706', background: '#FFFBEB', borderColor: '#FDE68A' }}>
        Calling…
      </button>
      <button onClick={() => setStatus(id, 'resolved')}
        className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all text-white whitespace-nowrap"
        style={{ background: G, borderColor: G }}>
        ✓ Done
      </button>
    </div>
  )
}

export default function MissedCallsTracker() {
  const calls                     = useMissedCalls()
  const { statuses, setStatus, getStatus } = useMissedCallStatus()
  const [showAll, setShowAll]     = useState(false)

  // Show today's missed calls by default, all if toggled
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayCalls = calls.filter(c => new Date(c.missed_at) >= todayStart)
  const displayed  = showAll ? calls : todayCalls

  if (displayed.length === 0 && !showAll) {
    // No missed calls today — render nothing unless there are older ones
    if (calls.length === 0) return null
    // There are older ones but not today — show a quiet "none today" state
    return (
      <div className="animate-fade-in-up rounded-2xl border border-brand-border bg-white"
        style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-brand-heading font-semibold text-sm flex items-center gap-2">
              <span className="text-base">📵</span> Missed Calls
            </h2>
            <p className="text-brand-muted text-[11px] mt-0.5">No missed calls today</p>
          </div>
          <button onClick={() => setShowAll(true)}
            className="text-[11px] text-brand-muted underline">
            View all ({calls.length})
          </button>
        </div>
      </div>
    )
  }

  const pending    = displayed.filter(c => getStatus(c.id) === 'action_required').length
  const inProgress = displayed.filter(c => getStatus(c.id) === 'in_progress').length
  const resolved   = displayed.filter(c => getStatus(c.id) === 'resolved').length

  return (
    <div className="animate-fade-in-up rounded-2xl border border-brand-border bg-white overflow-hidden"
      style={{
        boxShadow: '0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.04)',
        borderTop: `3px solid ${RED}`,
      }}>

      {/* Header */}
      <div className="px-5 sm:px-6 py-4 border-b border-brand-border flex items-start sm:items-center justify-between flex-wrap gap-3"
        style={{ background: 'linear-gradient(to right, rgba(239,68,68,0.05), transparent)' }}>
        <div>
          <h2 className="text-brand-heading font-semibold text-sm flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse-dot inline-block flex-shrink-0" />
            Missed Calls {!showAll && <span className="text-brand-muted font-normal">(Today)</span>}
          </h2>
          <p className="text-brand-muted text-[11px] mt-0.5">
            {pending > 0
              ? `${pending} need a callback · ${inProgress} in progress · ${resolved} done`
              : `All ${resolved} calls followed up ✓`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pending > 0 && (
            <span className="text-red-500 text-[11px] font-bold bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
              ⚠ {pending} pending
            </span>
          )}
          {!showAll && calls.length > todayCalls.length && (
            <button onClick={() => setShowAll(true)}
              className="text-[11px] text-brand-muted underline">
              +{calls.length - todayCalls.length} older
            </button>
          )}
          {showAll && (
            <button onClick={() => setShowAll(false)}
              className="text-[11px] text-brand-muted underline">
              Today only
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-brand-border bg-brand-bg">
              <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Time</th>
              <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Contact</th>
              <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Phone</th>
              <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Missed By</th>
              <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Status</th>
              <th className="text-right px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {displayed.map(call => {
              const status = getStatus(call.id)
              return (
                <tr key={call.id}
                  className="transition-colors hover:bg-brand-bg/60"
                  style={{
                    borderLeft: status === 'action_required'
                      ? `3px solid ${RED}`
                      : status === 'in_progress'
                        ? '3px solid #F59E0B'
                        : `3px solid ${G}`,
                  }}>
                  <td className="px-5 py-3 text-brand-muted whitespace-nowrap">
                    {timeAgo(call.missed_at)}
                  </td>
                  <td className="px-5 py-3 font-medium text-brand-heading whitespace-nowrap">
                    {call.contact_name || <span className="text-brand-muted italic">Unknown</span>}
                  </td>
                  <td className="px-5 py-3 font-mono text-brand-text whitespace-nowrap">
                    {call.contact_phone
                      ? <a href={`tel:${call.contact_phone}`}
                          className="hover:underline"
                          style={{ color: G }}
                          onClick={e => e.stopPropagation()}>
                          {call.contact_phone}
                        </a>
                      : <span className="text-brand-muted">—</span>
                    }
                  </td>
                  <td className="px-5 py-3 text-brand-muted whitespace-nowrap">
                    {call.agent_name || '—'}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={status} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <ActionButtons id={call.id} status={status} setStatus={setStatus} />
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
