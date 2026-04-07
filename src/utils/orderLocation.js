'use client';

const GEO_SEPARATOR = '||geo:';

export const parseDeliveryAddress = (value = '') => {
  const [address, coordinatesPart] = value.split(GEO_SEPARATOR);

  if (!coordinatesPart) {
    return {
      address,
      latitude: null,
      longitude: null,
    };
  }

  const [latitudeText, longitudeText] = coordinatesPart.split(',');
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);

  return {
    address,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
};

export const getDirectionsUrl = ({ latitude, longitude, address }) => {
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  }

  if (address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }

  return '';
};
