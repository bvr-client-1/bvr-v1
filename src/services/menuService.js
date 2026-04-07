'use client';

import { api, authApi } from './api.js';

export const fetchPublicMenu = async () => {
  const { data } = await api.get('/menu/public');
  return data;
};

export const fetchAdminMenuItems = async (token) => {
  const { data } = await authApi(token).get('/menu/admin/items');
  return data.items;
};

export const updateMenuAvailability = async (token, itemId, isAvailable) => {
  await authApi(token).patch(`/menu/admin/items/${itemId}`, { isAvailable });
};
