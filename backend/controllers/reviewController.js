import { getPublicReviews } from '../services/reviewService.js';

export const fetchPublicReviews = async (_req, res) => {
  const data = await getPublicReviews();
  res.json(data);
};
