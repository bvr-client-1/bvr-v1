import test from 'node:test';
import assert from 'node:assert/strict';
import { assertWithinDeliveryZone, calculateDistanceKm } from '../backend/utils/deliveryZone.js';

test('calculateDistanceKm returns near-zero for the same point', () => {
  const point = { latitude: 17.065, longitude: 79.269167 };
  assert.ok(calculateDistanceKm(point, point) < 0.001);
});

test('assertWithinDeliveryZone accepts locations inside the radius', () => {
  assert.doesNotThrow(() =>
    assertWithinDeliveryZone({
      customerLocation: { latitude: 17.072, longitude: 79.272 },
      restaurantLocation: { latitude: 17.065, longitude: 79.269167 },
      radiusKm: 4,
    }),
  );
});

test('assertWithinDeliveryZone rejects locations outside the radius', () => {
  assert.throws(() =>
    assertWithinDeliveryZone({
      customerLocation: { latitude: 17.12, longitude: 79.33 },
      restaurantLocation: { latitude: 17.065, longitude: 79.269167 },
      radiusKm: 4,
    }),
  );
});
