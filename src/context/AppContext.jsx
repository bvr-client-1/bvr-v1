import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { fetchRestaurantStatus, updateRestaurantStatus } from '../services/restaurantService.js';
import { useLocalStorage } from '../hooks/useLocalStorage.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [cart, setCart] = useLocalStorage('bvr_cart', []);
  const [ownerToken, setOwnerToken] = useLocalStorage('bvr_staff_token', '');
  const [kitchenToken, setKitchenToken] = useLocalStorage('bvr_kitchen_token', '');
  const [orderId, setOrderId] = useLocalStorage('bvr_order_id', '');
  const [orderCode, setOrderCode] = useLocalStorage('bvr_order_code', '');
  const [searchState, setSearchState] = useState('');
  const [restaurantStatus, setRestaurantStatus] = useState({
    kitchenPaused: false,
    isWithinSchedule: true,
    isAcceptingOrders: true,
    opensAt: '11:00 AM',
    closesAt: '11:00 PM',
    nextMessage: 'Opens today at 11:00 AM',
    updatedAt: null,
    updatedByRole: null,
  });

  const refreshRestaurantStatus = async () => {
    try {
      const data = await fetchRestaurantStatus();
      setRestaurantStatus(data);
    } catch {
      // Keep last known status to avoid flicker when the API is briefly unavailable.
    }
  };

  const setKitchenPaused = async (kitchenPaused) => {
    const token = ownerToken || kitchenToken;
    if (!token) {
      throw new Error('Authentication required');
    }

    const data = await updateRestaurantStatus(token, kitchenPaused);
    setRestaurantStatus(data);
    return data;
  };

  useEffect(() => {
    refreshRestaurantStatus();
    const timer = window.setInterval(() => {
      refreshRestaurantStatus();
    }, 30000);

    return () => window.clearInterval(timer);
  }, []);

  const value = useMemo(
    () => ({
      cart,
      setCart,
      ownerToken,
      setOwnerToken,
      kitchenToken,
      setKitchenToken,
      orderId,
      setOrderId,
      orderCode,
      setOrderCode,
      searchState,
      setSearchState,
      restaurantStatus,
      refreshRestaurantStatus,
      setKitchenPaused,
    }),
    [cart, kitchenToken, orderCode, orderId, ownerToken, restaurantStatus, searchState, setCart],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
};
