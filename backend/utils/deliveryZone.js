const toRadians = (value) => (value * Math.PI) / 180;

export const calculateDistanceKm = (from, to) => {
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLng = toRadians(to.longitude - from.longitude);
  const fromLat = toRadians(from.latitude);
  const toLat = toRadians(to.latitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const assertWithinDeliveryZone = ({ customerLocation, restaurantLocation, radiusKm }) => {
  const distanceKm = calculateDistanceKm(customerLocation, restaurantLocation);

  if (distanceKm > radiusKm) {
    const error = new Error(`Delivery is available only within ${radiusKm} km of the restaurant`);
    error.statusCode = 400;
    throw error;
  }

  return distanceKm;
};
