import { api } from './api.js';

export const createPaymentOrder = async ({ amount, receipt }) => {
  const { data } = await api.post('/orders/create-order', { amount, receipt });
  return data;
};

export const verifyPayment = async (payload) => {
  const { data } = await api.post('/orders/verify-payment', payload);
  return data;
};
