import express from 'express';
import Joi from 'joi';
import {
  createOrder,
  fetchAdminOrders,
  fetchKitchenQueue,
  fetchOrderById,
  lookupOrderByPhone,
  patchDeliveryAssignment,
  patchOrderStatus,
  verifyPayment,
} from '../controllers/orderController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const itemSchema = Joi.object({
  id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  name: Joi.string().required(),
  price: Joi.number().required(),
  quantity: Joi.number().integer().min(1).required(),
});

const router = express.Router();

router.post(
  '/create-order',
  validate(
    Joi.object({
      amount: Joi.number().integer().min(100).required(),
      receipt: Joi.string().required(),
    }),
  ),
  createOrder,
);

router.post(
  '/verify-payment',
  validate(
    Joi.object({
      razorpayOrderId: Joi.string().required(),
      razorpayPaymentId: Joi.string().required(),
      razorpaySignature: Joi.string().required(),
      orderCode: Joi.string().required(),
      orderType: Joi.string().valid('dine-in', 'delivery').required(),
      customerName: Joi.string().required(),
      customerPhone: Joi.string().pattern(/^\d{10}$/).required(),
      tableNumber: Joi.alternatives().try(Joi.string(), Joi.number()).allow('', null),
      deliveryAddress: Joi.string().allow('', null),
      subtotal: Joi.number().required(),
      deliveryCharge: Joi.number().required(),
      total: Joi.number().required(),
      items: Joi.array().items(itemSchema).min(1).required(),
    }),
  ),
  verifyPayment,
);

router.get(
  '/lookup',
  validate(Joi.object({ phone: Joi.string().pattern(/^\d{10}$/).required() }), 'query'),
  lookupOrderByPhone,
);
router.get('/admin/all', requireAuth('owner'), fetchAdminOrders);
router.patch(
  '/admin/:orderId/status',
  requireAuth('owner'),
  validate(
    Joi.object({
      status: Joi.string()
        .valid('NEW', 'CONFIRMED', 'IN_KITCHEN', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED', 'SERVED')
        .required(),
      rejectionReason: Joi.string().allow('', null),
    }),
  ),
  patchOrderStatus,
);
router.patch(
  '/admin/:orderId/assign-delivery',
  requireAuth('owner'),
  validate(
    Joi.object({
      deliveryPersonId: Joi.string().required(),
    }),
  ),
  patchDeliveryAssignment,
);
router.get('/kitchen/queue/list', requireAuth('kitchen'), fetchKitchenQueue);
router.patch(
  '/kitchen/:orderId/status',
  requireAuth('kitchen'),
  validate(
    Joi.object({
      status: Joi.string().valid('IN_KITCHEN', 'READY').required(),
    }),
  ),
  patchOrderStatus,
);
router.get('/:orderId', fetchOrderById);

export default router;
