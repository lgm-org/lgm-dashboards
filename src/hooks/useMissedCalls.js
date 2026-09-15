import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function useMissedCalls() {
  const [calls, setCalls] = useState([]);

  useEffect(() => {
    supabase
      .from('missed_calls')
      .select('*')
      .order('missed_at', { ascending: false })
      .then(({ data }) => setCalls(data ?? []));

    const channel = supabase
      .channel('missed_calls_rt')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'missed_calls' },
        (payload) => setCalls(prev => [payload.new, ...prev])
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  return calls;
}
