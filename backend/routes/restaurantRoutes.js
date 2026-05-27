import express from 'express';
import Joi from 'joi';
import { fetchRestaurantStatus, patchKitchenPausedState } from '../controllers/restaurantController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();

router.get('/status', fetchRestaurantStatus);
router.patch(
  '/status',
  requireAuth(),
  validate(
    Joi.object({
      kitchenPaused: Joi.boolean(),
      maintenanceMode: Joi.boolean(),
      tableCount: Joi.number().integer().min(1).max(100),
      deliveryRadiusKm: Joi.number().min(0.5).max(50),
    }).or('kitchenPaused', 'maintenanceMode', 'tableCount', 'deliveryRadiusKm'),
  ),
  patchKitchenPausedState,
);

export default router;
