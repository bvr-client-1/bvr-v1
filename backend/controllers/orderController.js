import { env } from '../config/env.js';
import {
  assignDeliveryPartner,
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

export const createOrder = async (req, res) => {
  const { amount, receipt } = req.body;
  const order = await createRazorpayOrder({ amount, receipt });
  res.json({ orderId: order.id, amount: order.amount, currency: order.currency });
};

export const verifyPayment = async (req, res) => {
  const valid = verifyPaymentSignature({
    orderId: req.body.razorpayOrderId,
    paymentId: req.body.razorpayPaymentId,
    signature: req.body.razorpaySignature,
    secret: env.razorpayKeySecret,
  });

  if (!valid) {
    return res.status(400).json({ message: 'Payment verification failed' });
  }

  const order = await persistPaidOrder({
    orderCode: req.body.orderCode,
    orderType: req.body.orderType,
    customerName: req.body.customerName,
    customerPhone: req.body.customerPhone,
    tableNumber: req.body.tableNumber,
    deliveryAddress: req.body.deliveryAddress,
    subtotal: req.body.subtotal,
    deliveryCharge: req.body.deliveryCharge,
    total: req.body.total,
    paymentId: req.body.razorpayPaymentId,
    items: req.body.items,
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
  await updateOrderStatus(req.params.orderId, req.body.status, req.body.rejectionReason);
  res.json({ success: true });
};

export const patchDeliveryAssignment = async (req, res) => {
  await assignDeliveryPartner(req.params.orderId, req.body.deliveryPersonId);
  res.json({ success: true });
};

export const fetchKitchenQueue = async (_req, res) => {
  const [orders, readyCount] = await Promise.all([getKitchenOrders(), getReadyCount()]);
  res.json({ orders, readyCount });
};
