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
  await authApi(token).patch(`/orders/admin/${orderId}/status`, { status, rejectionReason });
};

export const assignDeliveryPartner = async (token, orderId, deliveryPersonId) => {
  await authApi(token).patch(`/orders/admin/${orderId}/assign-delivery`, { deliveryPersonId });
};

export const fetchKitchenQueue = async (token) => {
  const { data } = await authApi(token).get('/orders/kitchen/queue/list');
  return data;
};

export const updateKitchenOrderStatus = async (token, orderId, status) => {
  await authApi(token).patch(`/orders/kitchen/${orderId}/status`, { status });
};
