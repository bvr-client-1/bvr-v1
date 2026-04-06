import { api, authApi } from './api.js';

export const fetchRestaurantStatus = async () => {
  const { data } = await api.get('/restaurant/status');
  return data;
};

export const updateRestaurantStatus = async (token, kitchenPaused) => {
  const { data } = await authApi(token).patch('/restaurant/status', { kitchenPaused });
  return data;
};
