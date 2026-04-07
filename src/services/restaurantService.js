'use client';

import { api, authApi } from './api.js';

export const fetchRestaurantStatus = async () => {
  const { data } = await api.get('/restaurant/status');
  return data;
};

export const updateRestaurantStatus = async (token, payload) => {
  const { data } = await authApi(token).patch('/restaurant/status', payload);
  return data;
};
