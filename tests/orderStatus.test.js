import test from 'node:test';
import assert from 'node:assert/strict';
import { assertValidStatusTransition, canTransitionStatus } from '../backend/utils/orderStatus.js';

test('delivery orders can move from confirmed to kitchen flow', () => {
  assert.equal(
    canTransitionStatus({
      currentStatus: 'CONFIRMED',
      nextStatus: 'IN_KITCHEN',
      orderType: 'delivery',
    }),
    true,
  );
});

test('delivery orders cannot jump from confirmed straight to ready', () => {
  assert.equal(
    canTransitionStatus({
      currentStatus: 'CONFIRMED',
      nextStatus: 'READY',
      orderType: 'delivery',
    }),
    false,
  );
});

test('dine-in orders cannot go out for delivery', () => {
  assert.throws(() =>
    assertValidStatusTransition({
      currentStatus: 'READY',
      nextStatus: 'OUT_FOR_DELIVERY',
      orderType: 'dine-in',
    }),
  );
});

test('completed orders are terminal', () => {
  assert.equal(
    canTransitionStatus({
      currentStatus: 'COMPLETED',
      nextStatus: 'READY',
      orderType: 'delivery',
    }),
    false,
  );
});
