import dotenv from 'dotenv';
import { parseAllowedOrigins } from '../utils/cors.js';

dotenv.config();

const parseBoolean = (value, fallback = false) => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const required = [
  'PORT',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'JWT_SECRET',
  'OWNER_EMAIL',
  'OWNER_PASSWORD_HASH',
  'KITCHEN_LOGIN_ID',
  'KITCHEN_PASSWORD_HASH',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const frontendUrls = process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '';
if (!frontendUrls.trim()) {
  throw new Error('Missing required environment variable: FRONTEND_URL or FRONTEND_URLS');
}

const parsedPort = Number(process.env.PORT || 4000);
if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
  throw new Error('PORT must be a positive integer');
}

const jwtSecret = process.env.JWT_SECRET;
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long');
}

const ownerPasswordHash = process.env.OWNER_PASSWORD_HASH;
const kitchenPasswordHash = process.env.KITCHEN_PASSWORD_HASH;

const allowedOrigins = parseAllowedOrigins(frontendUrls);
if (!allowedOrigins.length) {
  throw new Error('At least one frontend origin must be configured');
}

const restaurantLatitude = Number(process.env.RESTAURANT_LAT);
const restaurantLongitude = Number(process.env.RESTAURANT_LNG);
const deliveryRadiusKm = Number(process.env.DELIVERY_RADIUS_KM || 4);
const keepaliveIntervalHours = Number(process.env.SUPABASE_KEEPALIVE_INTERVAL_HOURS || 48);
const reviewSyncHours = Number(process.env.REVIEW_SYNC_INTERVAL_HOURS || 24);
const authRateLimitWindowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const authRateLimitMax = Number(process.env.AUTH_RATE_LIMIT_MAX || 20);

if (!Number.isFinite(restaurantLatitude) || !Number.isFinite(restaurantLongitude)) {
  throw new Error('RESTAURANT_LAT and RESTAURANT_LNG must be valid numbers');
}

if (!Number.isFinite(deliveryRadiusKm) || deliveryRadiusKm <= 0) {
  throw new Error('DELIVERY_RADIUS_KM must be a positive number');
}

if (!Number.isFinite(keepaliveIntervalHours) || keepaliveIntervalHours <= 0) {
  throw new Error('SUPABASE_KEEPALIVE_INTERVAL_HOURS must be a positive number');
}

if (!Number.isFinite(reviewSyncHours) || reviewSyncHours <= 0) {
  throw new Error('REVIEW_SYNC_INTERVAL_HOURS must be a positive number');
}

if (!Number.isFinite(authRateLimitWindowMs) || authRateLimitWindowMs <= 0) {
  throw new Error('AUTH_RATE_LIMIT_WINDOW_MS must be a positive number');
}

if (!Number.isFinite(authRateLimitMax) || authRateLimitMax <= 0) {
  throw new Error('AUTH_RATE_LIMIT_MAX must be a positive number');
}

if ((process.env.NODE_ENV || 'development') === 'production') {
  if (!ownerPasswordHash.startsWith('$2') || !kitchenPasswordHash.startsWith('$2')) {
    throw new Error('Production credentials must use bcrypt hashes for owner and kitchen passwords');
  }
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    throw new Error('RAZORPAY_WEBHOOK_SECRET is required in production');
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
  port: parsedPort,
  frontendUrl: process.env.FRONTEND_URL || allowedOrigins[0] || '',
  frontendUrls,
  allowedOrigins,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  jwtSecret,
  ownerEmail: process.env.OWNER_EMAIL,
  ownerPasswordHash,
  kitchenLoginId: process.env.KITCHEN_LOGIN_ID,
  kitchenPasswordHash,
  restaurantLocation: {
    latitude: restaurantLatitude,
    longitude: restaurantLongitude,
  },
  deliveryRadiusKm,
  freeDeliveryEnabled: parseBoolean(process.env.FREE_DELIVERY_ENABLED, true),
  freeDeliveryCouponCode: process.env.FREE_DELIVERY_COUPON_CODE || 'FREEDEL',
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  supabaseKeepaliveIntervalMs: keepaliveIntervalHours * 60 * 60 * 1000,
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY || '',
  googlePlaceId: process.env.GOOGLE_PLACE_ID || '',
  reviewSyncIntervalMs: reviewSyncHours * 60 * 60 * 1000,
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 500),
  authRateLimitWindowMs,
  authRateLimitMax,
  jwtIssuer: process.env.JWT_ISSUER || 'bvr-api',
  jwtAudience: process.env.JWT_AUDIENCE || 'bvr-clients',
};
