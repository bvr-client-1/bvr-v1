import crypto from 'crypto';
import { env } from '../config/env.js';
import { razorpay } from '../config/razorpay.js';
import { findPendingOrderDraft } from '../services/pendingOrderService.js';
import { persistPaidOrder, syncRefundStatusFromWebhook } from '../services/orderService.js';

const verifyWebhookSignature = (rawBody, signature) => {
  if (!env.razorpayWebhookSecret || !signature) {
    return false;
  }

  const expected = crypto.createHmac('sha256', env.razorpayWebhookSecret).update(rawBody).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const signatureBuffer = Buffer.from(String(signature || ''), 'hex');
  return expectedBuffer.length === signatureBuffer.length && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
};

export const handleRazorpayWebhook = async (req, res) => {
  if (!env.razorpayWebhookSecret) {
    return res.status(503).json({ message: 'Webhook secret is not configured' });
  }

  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.body;

  if (!verifyWebhookSignature(rawBody, signature)) {
    return res.status(400).json({ message: 'Invalid webhook signature' });
  }

  const event = JSON.parse(rawBody.toString('utf8'));
  if (event.event === 'refund.created' || event.event === 'refund.processed' || event.event === 'refund.failed') {
    const refund = event.payload?.refund?.entity;
    if (!refund?.payment_id) {
      return res.status(400).json({ message: 'Missing refund payment reference' });
    }

    await syncRefundStatusFromWebhook({
      paymentId: refund.payment_id,
      refundId: refund.id,
      refundAmount: refund.amount,
      refundStatus: refund.status,
      refundFailureReason: refund.error_description || null,
    });

    return res.json({ received: true, refundId: refund.id, status: refund.status });
  }

  if (event.event !== 'payment.captured') {
    return res.json({ received: true, ignored: true, event: event.event });
  }

  const payment = event.payload?.payment?.entity;
  if (!payment?.order_id) {
    return res.status(400).json({ message: 'Missing payment order reference' });
  }

  const draftRecord = await findPendingOrderDraft(payment.order_id);
  if (!draftRecord?.draft) {
    const remoteOrder = await razorpay.orders.fetch(payment.order_id);
    if (!remoteOrder?.receipt) {
      return res.json({ received: true, ignored: true });
    }

    return res.json({ received: true, ignored: true, receipt: remoteOrder.receipt });
  }

  const draft = draftRecord.draft;
  if (Number(payment.amount) !== Math.round(Number(draft.total || 0) * 100)) {
    return res.status(400).json({ message: 'Webhook payment amount mismatch' });
  }

  if (payment.status !== 'captured') {
    return res.status(400).json({ message: 'Webhook payment is not captured' });
  }

  await persistPaidOrder({
    orderCode: draft.orderCode,
    orderType: draft.orderType,
    customerName: draft.customerName,
    customerPhone: draft.customerPhone,
    tableNumber: draft.tableNumber,
    deliveryAddress: draft.deliveryAddress,
    deliveryLatitude: draft.deliveryLatitude,
    deliveryLongitude: draft.deliveryLongitude,
    subtotal: draft.subtotal,
    deliveryCharge: draft.deliveryCharge,
    total: draft.total,
    items: draft.items,
    razorpayOrderId: payment.order_id,
    razorpayPaymentId: payment.id,
  });

  return res.json({ received: true, orderCode: draft.orderCode });
};
