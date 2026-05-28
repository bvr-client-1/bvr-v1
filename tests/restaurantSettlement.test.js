import test from 'node:test';
import assert from 'node:assert/strict';
import { getRestaurantSettlementTotal } from '../backend/utils/tax.js';

test('restaurant settlement adds 5% GST and stores whole rupees', () => {
  assert.equal(getRestaurantSettlementTotal(100), 105);
  assert.equal(getRestaurantSettlementTotal(1470), 1544);
});

test('restaurant settlement handles empty or invalid amounts safely', () => {
  assert.equal(getRestaurantSettlementTotal(0), 0);
  assert.equal(getRestaurantSettlementTotal('not-a-number'), 0);
});
