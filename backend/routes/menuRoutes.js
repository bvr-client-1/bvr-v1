import express from 'express';
import Joi from 'joi';
import {
  fetchMenuManagementItems,
  fetchPublicMenu,
  patchMenuItemAvailability,
} from '../controllers/menuController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();

router.get('/public', fetchPublicMenu);
router.get('/admin/items', requireAuth('owner'), fetchMenuManagementItems);
router.patch(
  '/admin/items/:itemId',
  requireAuth('owner'),
  validate(
    Joi.object({
      isAvailable: Joi.boolean().required(),
    }),
  ),
  patchMenuItemAvailability,
);

export default router;
