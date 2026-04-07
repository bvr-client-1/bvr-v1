'use client';

const toRadians = (value) => (value * Math.PI) / 180;

export const RESTAURANT_LOCATION = {
  latitude: Number(process.env.NEXT_PUBLIC_RESTAURANT_LAT),
  longitude: Number(process.env.NEXT_PUBLIC_RESTAURANT_LNG),
};

export const DELIVERY_RADIUS_KM = Number(process.env.NEXT_PUBLIC_DELIVERY_RADIUS_KM || 4);

export const hasDeliveryZoneConfig = () =>
  Number.isFinite(RESTAURANT_LOCATION.latitude) && Number.isFinite(RESTAURANT_LOCATION.longitude);

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

export const getCurrentPosition = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported on this device'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      () => reject(new Error('Location access is required for delivery orders')),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  });
