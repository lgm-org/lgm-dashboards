import { useState, useEffect } from 'react';
import { Phone, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import { useActiveCalls } from '../hooks/useActiveCalls';

function elapsed(startedAt) {
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (secs < 0) return '0s';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s < 10 ? '0' : ''}${s}s` : `${s}s`;
}

const MAX_CALL_MS = 3 * 60 * 60 * 1000;

export function ActiveCallsBar() {
  const [, tick] = useState(0);
  // Rows whose end event never reached Supabase would otherwise count up forever
  const calls = useActiveCalls().filter(c => Date.now() - new Date(c.started_at).getTime() < MAX_CALL_MS);

  // Tick every second while calls are active so the duration display updates live
  useEffect(() => {
    if (calls.length === 0) return;
    const id = setInterval(() => tick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [calls.length]);

  if (calls.length === 0) return null;

  return (
    <div className="bg-white border-b border-brand-border">
      <div className="max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 py-2.5 flex-wrap min-h-[40px]">

          {/* Live indicator + count */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ backgroundColor: '#8CC63F' }} />
              <span className="relative inline-flex rounded-full h-2 w-2"
                style={{ backgroundColor: '#8CC63F' }} />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: '#8CC63F' }}>
              {calls.length} Active {calls.length === 1 ? 'Call' : 'Calls'}
            </span>
          </div>

          <div className="h-4 w-px bg-brand-border shrink-0" />

          {/* Call chips */}
          <div className="flex flex-wrap gap-2">
            {calls.map(call => {
              const DirectionIcon = call.direction === 'inbound' ? PhoneIncoming : PhoneOutgoing;
              return (
                <div key={call.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-brand-border bg-brand-bg text-xs text-brand-text">
                  <DirectionIcon className="w-3 h-3 shrink-0" style={{ color: '#8CC63F' }} />
                  <span className="font-medium">{call.agent_name}</span>
                  {(call.contact_name || call.contact_phone) && (
                    <>
                      <span className="text-brand-muted">→</span>
                      <span className="text-brand-muted">
                        {call.contact_name || call.contact_phone}
                      </span>
                    </>
                  )}
                  <span className="text-brand-muted ml-0.5 tabular-nums">
                    {elapsed(call.started_at)}
                  </span>
                </div>
              );
            })}
          </div>

        </div>
      </div>
    </div>
  );
}
