import { getRestaurantStatus, updateRestaurantRuntimeState } from '../services/restaurantService.js';

export const fetchRestaurantStatus = async (_req, res) => {
  const status = await getRestaurantStatus();
  res.json(status);
};

export const patchKitchenPausedState = async (req, res) => {
  const status = await updateRestaurantRuntimeState({
    kitchenPaused: req.body.kitchenPaused,
    maintenanceMode: req.body.maintenanceMode,
    updatedByRole: req.user?.role || 'unknown',
  });
  res.json(status);
};
