import { env } from '../config/env.js';
import { getRuntimeState } from '../services/restaurantService.js';
import { findPendingOrderDraft, savePendingOrderDraft } from '../services/pendingOrderService.js';
import { assertWithinDeliveryZone } from '../utils/deliveryZone.js';
import { assertRestaurantAcceptingOrders } from '../utils/restaurantStatus.js';
import {
  cancelOrderWithRefund,
  assignDeliveryPartner,
  createDeliveryPerson,
  deactivateDeliveryPerson,
  createRazorpayOrder,
  findLatestOrderByPhone,
  getAllOrders,
  getDeliveryPeople,
  getKitchenOrders,
  getOrderById,
  getReadyCount,
  persistPaidOrder,
  updateOrderStatus,
  verifyPaymentSignature,
} from '../services/orderService.js';

const normalizeOrderAmounts = (payload) => {
  const subtotal = Number(payload.subtotal || 0);
  const deliveryCharge = payload.orderType === 'delivery' && !env.freeDeliveryEnabled ? Number(payload.deliveryCharge || 0) : 0;
  const total = subtotal + deliveryCharge;

  return {
    ...payload,
    subtotal,
    deliveryCharge,
    total,
  };
};

const assertDeliveryEligibility = (payload) => {
  if (payload.orderType !== 'delivery') return;

  assertWithinDeliveryZone({
    customerLocation: {
      latitude: payload.deliveryLatitude,
      longitude: payload.deliveryLongitude,
    },
    restaurantLocation: env.restaurantLocation,
    radiusKm: env.deliveryRadiusKm,
  });
};

export const createOrder = async (req, res) => {
  assertRestaurantAcceptingOrders(await getRuntimeState());
  const normalizedDraft = normalizeOrderAmounts(req.body);
  assertDeliveryEligibility(normalizedDraft);

  const order = await createRazorpayOrder({
    amount: normalizedDraft.total * 100,
    receipt: normalizedDraft.receipt,
  });

  await savePendingOrderDraft({
    razorpayOrderId: order.id,
    amount: order.amount,
    receipt: normalizedDraft.receipt,
    draft: normalizedDraft,
  });

  res.json({
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: env.razorpayKeyId,
  });
};

export const verifyPayment = async (req, res) => {
  assertRestaurantAcceptingOrders(await getRuntimeState());
  const valid = verifyPaymentSignature({
    orderId: req.body.razorpayOrderId,
    paymentId: req.body.razorpayPaymentId,
    signature: req.body.razorpaySignature,
    secret: env.razorpayKeySecret,
  });

  if (!valid) {
    return res.status(400).json({ message: 'Payment verification failed' });
  }

  const draftRecord = await findPendingOrderDraft(req.body.razorpayOrderId);
  const normalizedOrder = normalizeOrderAmounts({
    ...(draftRecord?.draft || {}),
    ...req.body,
  });
  assertDeliveryEligibility(normalizedOrder);

  const order = await persistPaidOrder({
    orderCode: normalizedOrder.orderCode,
    orderType: normalizedOrder.orderType,
    customerName: normalizedOrder.customerName,
    customerPhone: normalizedOrder.customerPhone,
    tableNumber: normalizedOrder.tableNumber,
    deliveryAddress: normalizedOrder.deliveryAddress,
    deliveryLatitude: normalizedOrder.deliveryLatitude,
    deliveryLongitude: normalizedOrder.deliveryLongitude,
    subtotal: normalizedOrder.subtotal,
    deliveryCharge: normalizedOrder.deliveryCharge,
    total: normalizedOrder.total,
    items: normalizedOrder.items,
    razorpayOrderId: normalizedOrder.razorpayOrderId,
    razorpayPaymentId: normalizedOrder.razorpayPaymentId,
  });

  return res.json({ orderId: order.id, orderCode: order.order_code });
};

export const fetchOrderById = async (req, res) => {
  const order = await getOrderById(req.params.orderId);
  res.json({ order });
};

export const lookupOrderByPhone = async (req, res) => {
  const data = await findLatestOrderByPhone(req.query.phone);
  if (!data) {
    return res.status(404).json({ message: 'No order found for this number' });
  }
  return res.json(data);
};

export const fetchAdminOrders = async (_req, res) => {
  const [orders, deliveryPeople] = await Promise.all([getAllOrders(), getDeliveryPeople()]);
  res.json({ orders, deliveryPeople });
};

export const patchOrderStatus = async (req, res) => {
  if (req.body.status === 'CANCELLED') {
    const order = await cancelOrderWithRefund(req.params.orderId, req.body.rejectionReason);
    return res.json({
      success: true,
      order,
      refund: {
        status: order.refund_status,
        refundId: order.refund_id,
      },
    });
  }

  await updateOrderStatus(req.params.orderId, req.body.status, req.body.rejectionReason);
  return res.json({ success: true });
};

export const patchDeliveryAssignment = async (req, res) => {
  await assignDeliveryPartner(req.params.orderId, req.body.deliveryPersonId);
  res.json({ success: true });
};

export const createAdminDeliveryPerson = async (req, res) => {
  const person = await createDeliveryPerson({
    name: req.body.name,
    phone: req.body.phone,
  });

  res.status(201).json({ person });
};

export const deleteAdminDeliveryPerson = async (req, res) => {
  const person = await deactivateDeliveryPerson(req.params.deliveryPersonId);
  res.json({ success: true, person });
};

export const fetchKitchenQueue = async (_req, res) => {
  const [orders, readyCount] = await Promise.all([getKitchenOrders(), getReadyCount()]);
  res.json({ orders, readyCount });
};
