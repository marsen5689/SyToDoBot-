import { useEffect, useState } from 'react';
import { api } from './api';

export function useReminderCapabilities() {
  const [state, setState] = useState<'loading' | 'enabled' | 'disabled' | 'error'>('loading');
  useEffect(() => {
    let alive = true;
    void api.reminderCapabilities().then(result => { if (alive) setState(result.enabled ? 'enabled' : 'disabled'); })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, []);
  return state;
}
