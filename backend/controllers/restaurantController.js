import { getRestaurantStatus, updateRestaurantRuntimeState } from '../services/restaurantService.js';

export const fetchRestaurantStatus = async (_req, res) => {
  const status = await getRestaurantStatus();
  res.json(status);
};

export const patchKitchenPausedState = async (req, res) => {
  if (typeof req.body.maintenanceMode === 'boolean' && req.user?.role !== 'owner') {
    return res.status(403).json({ message: 'Only the owner can change maintenance mode' });
  }

  const status = await updateRestaurantRuntimeState({
    kitchenPaused: req.body.kitchenPaused,
    maintenanceMode: req.body.maintenanceMode,
    updatedByRole: req.user?.role || 'unknown',
  });
  res.json(status);
};
