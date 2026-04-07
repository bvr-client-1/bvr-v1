import { env } from '../config/env.js';

let warnedKeys = new Set();

const warnFallback = (key) => {
  if (env.isProduction || warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(`[storage] Falling back to local file storage for ${key}. Run the Supabase migration before production deploy.`);
};

export const shouldUseLocalFallback = (error, key) => {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  const missingRelation =
    code === 'PGRST205' ||
    code === '42P01' ||
    /schema cache/i.test(message) ||
    /Could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message);

  if (missingRelation && !env.isProduction) {
    warnFallback(key);
    return true;
  }

  return false;
};
