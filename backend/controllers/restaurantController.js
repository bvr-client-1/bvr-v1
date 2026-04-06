import { getRestaurantStatus, updateKitchenPausedState } from '../services/restaurantService.js';

export const fetchRestaurantStatus = async (_req, res) => {
  const status = await getRestaurantStatus();
  res.json(status);
};

export const patchKitchenPausedState = async (req, res) => {
  const status = await updateKitchenPausedState({
    kitchenPaused: req.body.kitchenPaused,
    updatedByRole: req.user?.role || 'unknown',
  });
  res.json(status);
};
