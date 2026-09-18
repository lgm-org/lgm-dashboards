import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function useActiveCalls() {
  const [calls, setCalls] = useState([]);

  useEffect(() => {
    // Initial load
    supabase
      .from('active_calls')
      .select('*')
      .order('started_at', { ascending: true })
      .then(({ data }) => setCalls(data ?? []));

    // Real-time: insert / update / delete → update state in place
    const channel = supabase
      .channel(`active_calls_rt_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'active_calls' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setCalls(prev => [...prev, payload.new]);
          } else if (payload.eventType === 'UPDATE') {
            setCalls(prev => prev.map(c => c.id === payload.new.id ? payload.new : c));
          } else if (payload.eventType === 'DELETE') {
            setCalls(prev => prev.filter(c => c.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  return calls;
}
