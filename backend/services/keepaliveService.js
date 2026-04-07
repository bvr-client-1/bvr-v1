import { env } from '../config/env.js';
import { supabase } from '../config/supabase.js';

const pingSupabase = async () => {
  try {
    await supabase.from('orders').select('id', { head: true, count: 'exact' });
    console.log(`[keepalive] Supabase ping ok at ${new Date().toISOString()}`);
  } catch (error) {
    console.error('[keepalive] Supabase ping failed', error.message);
  }
};

export const startSupabaseKeepalive = () => {
  pingSupabase();
  const timer = setInterval(pingSupabase, env.supabaseKeepaliveIntervalMs);
  timer.unref?.();
  return timer;
};
