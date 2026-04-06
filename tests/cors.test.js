import test from 'node:test';
import assert from 'node:assert/strict';
import { isOriginAllowed, parseAllowedOrigins } from '../backend/utils/cors.js';

test('parseAllowedOrigins trims, filters, and deduplicates origins', () => {
  assert.deepEqual(parseAllowedOrigins(' http://localhost:5173,https://app.example.com, http://localhost:5173 '), [
    'http://localhost:5173',
    'https://app.example.com',
  ]);
});

test('isOriginAllowed allows server-to-server requests without an Origin header', () => {
  assert.equal(isOriginAllowed(undefined, ['https://app.example.com']), true);
});

test('isOriginAllowed rejects unknown origins', () => {
  assert.equal(isOriginAllowed('https://evil.example.com', ['https://app.example.com']), false);
});
