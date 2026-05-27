import assert from 'node:assert/strict';
import test from 'node:test';

Object.assign(process.env, {
  PORT: '4000',
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'test-secret',
  JWT_SECRET: 'test-secret-with-more-than-thirty-two-characters',
  OWNER_EMAIL: 'owner@example.com',
  OWNER_PASSWORD_HASH: 'test-hash',
  KITCHEN_LOGIN_ID: 'kitchen',
  KITCHEN_PASSWORD_HASH: 'test-hash',
  FRONTEND_URL: 'http://localhost:3000',
  RESTAURANT_LAT: '17.385',
  RESTAURANT_LNG: '78.4867',
});

const { getDeliveryPrice } = await import('../backend/services/menuService.js');

test('getDeliveryPrice rounds delivery prices up to the next ten', () => {
  assert.equal(getDeliveryPrice({ price: 505 }), 610);
  assert.equal(getDeliveryPrice({ price: 430 }), 520);
  assert.equal(getDeliveryPrice({ price: 580 }), 700);
});

test('getDeliveryPrice rounds explicit delivery prices up to the next ten', () => {
  assert.equal(getDeliveryPrice({ price: 505, delivery_price: 606 }), 610);
  assert.equal(getDeliveryPrice({ price: 505, delivery_price: 610 }), 610);
});
