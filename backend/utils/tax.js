const RESTAURANT_GST_RATE = 0.05;

export const getRestaurantSettlementTotal = (amount) => {
  const subtotal = Number(amount || 0);
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return 0;
  }

  return Math.ceil(subtotal * (1 + RESTAURANT_GST_RATE));
};
