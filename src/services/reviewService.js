'use client';

import { api } from './api.js';

export const fetchPublicReviews = async () => {
  const { data } = await api.get('/reviews/public');
  return data;
};
