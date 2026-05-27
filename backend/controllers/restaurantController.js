import { getRestaurantStatus, updateRestaurantRuntimeState } from '../services/restaurantService.js';

export const fetchRestaurantStatus = async (_req, res) => {
  const status = await getRestaurantStatus();
  res.json(status);
};

export const patchKitchenPausedState = async (req, res) => {
  const ownerOnlyFields = ['maintenanceMode', 'tableCount', 'deliveryRadiusKm'];
  if (ownerOnlyFields.some((field) => Object.prototype.hasOwnProperty.call(req.body, field)) && req.user?.role !== 'owner') {
    return res.status(403).json({ message: 'Only the owner can change restaurant settings' });
  }

  const status = await updateRestaurantRuntimeState({
    kitchenPaused: req.body.kitchenPaused,
    maintenanceMode: req.body.maintenanceMode,
    tableCount: req.body.tableCount,
    deliveryRadiusKm: req.body.deliveryRadiusKm,
    updatedByRole: req.user?.role || 'unknown',
  });
  res.json(status);
};
