import express from 'express';
import Joi from 'joi';
import {
  createAdminMenuItem,
  fetchMenuManagementItems,
  fetchPublicMenu,
  patchMenuItemAvailability,
} from '../controllers/menuController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();

router.get('/public', fetchPublicMenu);
router.get('/admin/items', requireAuth('owner'), fetchMenuManagementItems);
router.post(
  '/admin/items',
  requireAuth('owner'),
  validate(
    Joi.object({
      name: Joi.string().trim().min(2).max(120).required(),
      categoryName: Joi.string().trim().min(2).max(80).default('Daily Specials'),
      foodType: Joi.string().valid('veg', 'non-veg').default('veg'),
      price: Joi.number().min(1).required(),
      deliveryPrice: Joi.number().min(0).allow(null),
    }),
  ),
  createAdminMenuItem,
);
router.patch(
  '/admin/items/:itemId',
  requireAuth('owner'),
  validate(
    Joi.object({
      isAvailable: Joi.boolean(),
      price: Joi.number().min(0),
      deliveryPrice: Joi.number().min(0),
    }).or('isAvailable', 'price', 'deliveryPrice'),
  ),
  patchMenuItemAvailability,
);

export default router;
