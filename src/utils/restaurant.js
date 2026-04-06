export const isRestaurantOpen = (restaurantStatus) => restaurantStatus?.isAcceptingOrders ?? true;

export const getOpenMessage = (restaurantStatus) => {
  if (restaurantStatus?.kitchenPaused) {
    return 'Kitchen is paused manually. Ordering will resume when staff turns it back on.';
  }

  return restaurantStatus?.nextMessage || 'Opens today at 11:00 AM';
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
