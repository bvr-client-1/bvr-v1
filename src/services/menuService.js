'use client';

import { api, authApi } from './api.js';

export const fetchPublicMenu = async (mode = 'delivery') => {
  const { data } = await api.get('/menu/public', { params: { mode } });
  return data;
};

export const fetchAdminMenuItems = async (token) => {
  const { data } = await authApi(token).get('/menu/admin/items');
  return data.items;
};

export const updateMenuAvailability = async (token, itemId, isAvailable) => {
  await authApi(token).patch(`/menu/admin/items/${itemId}`, { isAvailable });
};

export const updateMenuItemPrice = async (token, itemId, price, priceType = 'restaurant') => {
  await authApi(token).patch(`/menu/admin/items/${itemId}`, priceType === 'delivery' ? { deliveryPrice: price } : { price });
};

export const createAdminMenuItem = async (token, payload) => {
  const { data } = await authApi(token).post('/menu/admin/items', payload);
  return data.item;
};
