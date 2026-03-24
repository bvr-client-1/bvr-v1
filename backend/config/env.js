import dotenv from 'dotenv';

dotenv.config();

const required = [
  'PORT',
  'FRONTEND_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'JWT_SECRET',
  'OWNER_EMAIL',
  'OWNER_PASSWORD_HASH',
  'KITCHEN_PASSWORD_HASH',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  port: Number(process.env.PORT || 4000),
  frontendUrl: process.env.FRONTEND_URL,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  jwtSecret: process.env.JWT_SECRET,
  ownerEmail: process.env.OWNER_EMAIL,
  ownerPasswordHash: process.env.OWNER_PASSWORD_HASH,
  kitchenPasswordHash: process.env.KITCHEN_PASSWORD_HASH,
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 100),
};
