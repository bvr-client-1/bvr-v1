const GEO_SEPARATOR = '||geo:';

export const serializeDeliveryAddress = ({ address, latitude, longitude }) => {
  if (!address) {
    return '';
  }

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `${address}${GEO_SEPARATOR}${latitude},${longitude}`;
  }

  return address;
};
