import { api } from './api.js';

export const ownerLogin = async (email, password) => {
  const { data } = await api.post('/auth/owner/login', { email, password });
  return data;
};

export const kitchenLogin = async (loginId, password) => {
  const { data } = await api.post('/auth/kitchen/login', { loginId, password });
  return data;
};
