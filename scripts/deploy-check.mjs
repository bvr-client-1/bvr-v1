import dotenv from 'dotenv';

dotenv.config();

const requiredFrontend = [
  'NEXT_PUBLIC_API_BASE_URL',
  'NEXT_PUBLIC_RAZORPAY_KEY_ID',
  'NEXT_PUBLIC_FRONTEND_URL',
  'NEXT_PUBLIC_RESTAURANT_LAT',
  'NEXT_PUBLIC_RESTAURANT_LNG',
  'NEXT_PUBLIC_DELIVERY_RADIUS_KM',
  'API_PROXY_TARGET',
];

const requiredBackend = [
  'PORT',
  'FRONTEND_URL',
  'FRONTEND_URLS',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'JWT_SECRET',
  'OWNER_EMAIL',
  'OWNER_PASSWORD_HASH',
  'KITCHEN_LOGIN_ID',
  'KITCHEN_PASSWORD_HASH',
  'RESTAURANT_LAT',
  'RESTAURANT_LNG',
  'DELIVERY_RADIUS_KM',
  'RAZORPAY_WEBHOOK_SECRET',
];

const looksPlaceholder = (value = '') => /replace_me|your-|change_this|localhost|127\.0\.0\.1/i.test(value);

const checkGroup = (label, keys) => {
  const missing = keys.filter((key) => !process.env[key]);
  const placeholders = keys.filter((key) => process.env[key] && looksPlaceholder(process.env[key]));

  return {
    label,
    missing,
    placeholders,
  };
};

const results = [checkGroup('frontend', requiredFrontend), checkGroup('backend', requiredBackend)];
const hasFailure = results.some((result) => result.missing.length || result.placeholders.length);

for (const result of results) {
  console.log(`\n${result.label.toUpperCase()} ENV CHECK`);
  console.log(`Missing: ${result.missing.length ? result.missing.join(', ') : 'none'}`);
  console.log(`Placeholders/local values: ${result.placeholders.length ? result.placeholders.join(', ') : 'none'}`);
}

if (hasFailure) {
  console.error('\nDeployment check failed. Replace missing, placeholder, or localhost values before production deploy.');
  process.exit(1);
}

console.log('\nDeployment check passed.');
