'use client';

import { api, authApi } from './api.js';

export const fetchOrderById = async (orderId) => {
  const { data } = await api.get(`/orders/${orderId}`);
  return data.order;
};

export const lookupOrderByPhone = async (phone) => {
  const { data } = await api.get('/orders/lookup', { params: { phone } });
  return data;
};

export const fetchAdminOrders = async (token) => {
  const { data } = await authApi(token).get('/orders/admin/all');
  return data;
};

export const updateAdminOrderStatus = async (token, orderId, status, rejectionReason = null) => {
  const { data } = await authApi(token).patch(`/orders/admin/${orderId}/status`, { status, rejectionReason });
  return data;
};

export const assignDeliveryPartner = async (token, orderId, deliveryPersonId) => {
  await authApi(token).patch(`/orders/admin/${orderId}/assign-delivery`, { deliveryPersonId });
};

export const addDeliveryPerson = async (token, { name, phone }) => {
  const { data } = await authApi(token).post('/orders/admin/delivery-people', { name, phone });
  return data.person;
};

export const removeDeliveryPerson = async (token, deliveryPersonId) => {
  const { data } = await authApi(token).delete(`/orders/admin/delivery-people/${deliveryPersonId}`);
  return data.person;
};

export const fetchKitchenQueue = async (token) => {
  const { data } = await authApi(token).get('/orders/kitchen/queue/list');
  return data;
};

export const updateKitchenOrderStatus = async (token, orderId, status) => {
  await authApi(token).patch(`/orders/kitchen/${orderId}/status`, { status });
};
