import { createContext, useContext, useMemo, useState } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [cart, setCart] = useLocalStorage('bvr_cart', []);
  const [ownerToken, setOwnerToken] = useLocalStorage('bvr_staff_token', '');
  const [kitchenToken, setKitchenToken] = useLocalStorage('bvr_kitchen_token', '');
  const [orderId, setOrderId] = useLocalStorage('bvr_order_id', '');
  const [orderCode, setOrderCode] = useLocalStorage('bvr_order_code', '');
  const [searchState, setSearchState] = useState('');

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
    }),
    [cart, kitchenToken, orderCode, orderId, ownerToken, searchState, setCart],
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
