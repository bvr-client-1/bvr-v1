'use client';

export const isRestaurantOpen = (restaurantStatus) => restaurantStatus?.isAcceptingOrders ?? true;

export const getOpenMessage = (restaurantStatus) => {
  if (restaurantStatus?.maintenanceMode) {
    return 'Back soon.';
  }

  if (restaurantStatus?.kitchenPaused) {
    return 'Back soon.';
  }

  return restaurantStatus?.nextMessage || 'Back soon.';
};

export const loadRazorpayScript = () =>
  new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
