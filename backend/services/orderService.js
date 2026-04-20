import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { razorpay } from '../config/razorpay.js';
import {
  attachPaymentMetadata,
  attachPaymentMetadataToList,
  findPaymentRecordByOrderId,
  findPaymentRecordByPaymentId,
  upsertPaymentRecord,
} from './paymentRecordService.js';
import { getMenuItemsByIds } from './menuService.js';
import { serializeDeliveryAddress } from '../utils/deliveryAddress.js';
import { assertValidStatusTransition } from '../utils/orderStatus.js';

const TAKEAWAY_PREFIX = 'TAKEAWAY::';
const SETTLEMENT_PREFIX = 'SETTLEMENT_META::';

const raise = (error, fallback = 500) => {
  if (error) {
    const wrapped = new Error(error.message);
    wrapped.statusCode = fallback;
    throw wrapped;
  }
};

const stripMissingOptionalOrderColumn = (payload, error) => {
  const message = String(error?.message || '');
  const nextPayload = { ...payload };
  let changed = false;

  for (const column of ['rejection_reason', 'cook_started_at', 'payment_status']) {
    const missingColumn =
      message.includes(`orders.${column}`) ||
      message.includes(`'${column}' column of 'orders'`) ||
      message.includes(`column "${column}"`) ||
      message.includes(`column '${column}'`) ||
      message.includes(`"${column}"`) ||
      message.includes(`'${column}'`) ||
      (column === 'payment_status' &&
        (message.toLowerCase().includes('payment_status') ||
          message.toLowerCase().includes('check constraint') ||
          message.toLowerCase().includes('violates check constraint') ||
          message.toLowerCase().includes('invalid input value')));

    if (Object.prototype.hasOwnProperty.call(nextPayload, column) && missingColumn) {
      delete nextPayload[column];
      changed = true;
    }
  }

  return changed ? nextPayload : null;
};

const insertOrderRecord = async (payload) => {
  let nextPayload = { ...payload };

  while (true) {
    const { data, error } = await supabase.from('orders').insert(nextPayload).select().single();
    if (!error) {
      return data;
    }

    const fallbackPayload = stripMissingOptionalOrderColumn(nextPayload, error);
    if (fallbackPayload) {
      nextPayload = fallbackPayload;
      continue;
    }

    raise(error);
  }
};

const updateOrderRecord = async (orderId, payload) => {
  let nextPayload = { ...payload };

  while (true) {
    const { error } = await supabase.from('orders').update(nextPayload).eq('id', orderId);
    if (!error) {
      return nextPayload;
    }

    const fallbackPayload = stripMissingOptionalOrderColumn(nextPayload, error);
    if (fallbackPayload) {
      nextPayload = fallbackPayload;
      continue;
    }

    raise(error);
  }
};

export const createRazorpayOrder = async ({ amount, receipt }) =>
  razorpay.orders.create({
    amount,
    currency: 'INR',
    receipt,
    payment_capture: 1,
  });

export const fetchRazorpayPayment = async (paymentId) => razorpay.payments.fetch(paymentId);

const getIstDayUtcRange = () => {
  const now = new Date();
  const shifted = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const date = shifted.getUTCDate();

  const startUtc = new Date(Date.UTC(year, month, date, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);

  return {
    startUtc: startUtc.toISOString(),
    endUtc: endUtc.toISOString(),
  };
};

export const generateDailyOrderCode = async (offset = 0) => {
  const { startUtc, endUtc } = getIstDayUtcRange();
  const { data, error } = await supabase
    .from('orders')
    .select('order_code')
    .gte('created_at', startUtc)
    .lt('created_at', endUtc);

  raise(error);

  const latestSequence = (data || []).reduce((max, row) => {
    const match = String(row.order_code || '').match(/^BVR(\d{4})$/i);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);

  return `BVR${String(latestSequence + 1 + Number(offset || 0)).padStart(4, '0')}`;
};

const isDuplicateOrderCodeError = (error) => {
  const message = String(error?.message || '');
  return error?.code === '23505' || message.includes('orders_order_code_key') || message.includes('duplicate key value');
};

export const verifyPaymentSignature = ({ orderId, paymentId, signature, secret }) => {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');
  const signatureBuffer = Buffer.from(String(signature || ''), 'hex');

  return expectedBuffer.length === signatureBuffer.length && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
};

export const persistPaidOrder = async ({
  orderCode,
  orderType,
  customerName,
  customerPhone,
  tableNumber,
  deliveryAddress,
  deliveryLatitude,
  deliveryLongitude,
  subtotal,
  deliveryCharge,
  total,
  items,
  razorpayOrderId,
  razorpayPaymentId,
}) => {
  if (razorpayPaymentId) {
    const existingPaymentRecord = await findPaymentRecordByPaymentId(razorpayPaymentId);
    if (existingPaymentRecord?.orderId) {
      return getOrderById(existingPaymentRecord.orderId);
    }
  }

  let order = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const nextOrderCode = attempt === 0 ? orderCode : await generateDailyOrderCode(attempt);

    try {
      order = await insertOrderRecord({
        order_code: nextOrderCode,
        type: orderType,
        table_number: orderType === 'dine-in' ? tableNumber : null,
        customer_name: customerName,
        customer_phone: customerPhone,
        delivery_address:
          orderType === 'delivery'
            ? serializeDeliveryAddress({
                address: deliveryAddress,
                latitude: deliveryLatitude,
                longitude: deliveryLongitude,
              })
            : null,
        subtotal,
        delivery_charge: deliveryCharge,
        total,
        // Freshly paid customer orders should still enter the owner queue
        // for explicit acceptance, KOT printing, or cancellation.
        status: 'NEW',
        payment_status: 'PAID',
      });
      break;
    } catch (orderError) {
      if (!isDuplicateOrderCodeError(orderError)) {
        throw orderError;
      }
    }
  }

  if (!order) {
    const error = new Error('Could not allocate a unique order code. Please contact the restaurant.');
    error.statusCode = 409;
    throw error;
  }

  const { error: itemsError } = await supabase.from('order_items').insert(
    items.map((item) => ({
      order_id: order.id,
      item_name: item.name,
      quantity: item.quantity,
      price: item.price,
    })),
  );

  raise(itemsError);

  await upsertPaymentRecord({
    orderId: order.id,
    orderCode: order.order_code,
    razorpayOrderId,
    razorpayPaymentId,
    amount: Math.round(Number(total || 0) * 100),
    paymentStatus: 'PAID',
  });

  return attachPaymentMetadata(order);
};

export const createCounterTableOrder = async ({
  serviceMode = 'TABLE',
  customerName,
  customerPhone,
  tableNumber,
  takeawayToken,
  subtotal,
  total,
  items,
}) => {
  const normalizedServiceMode = String(serviceMode || 'TABLE').toUpperCase();
  const normalizedTableNumber = Number(tableNumber);
  const normalizedTakeawayToken = String(takeawayToken || '').trim();
  const fallbackName =
    String(customerName || '').trim() ||
    (normalizedServiceMode === 'TAKEAWAY'
      ? `Takeaway Token ${normalizedTakeawayToken || 'Walk-In'}`
      : `Walk-in Table ${tableNumber}`);
  const fallbackPhone = String(customerPhone || '').trim() || '0000000000';
  const itemIds = [...new Set((items || []).map((item) => item.id))];
  const menuItems = await getMenuItemsByIds(itemIds);
  const menuItemMap = new Map(menuItems.map((item) => [String(item.id), item]));
  const normalizedItems = (items || []).map((item) => {
    const menuItem = menuItemMap.get(String(item.id));
    if (!menuItem) {
      const error = new Error(`Menu item not found: ${item.id}`);
      error.statusCode = 400;
      throw error;
    }

    if (!menuItem.is_available) {
      const error = new Error(`${menuItem.name} is currently unavailable`);
      error.statusCode = 409;
      throw error;
    }

    return {
      id: String(menuItem.id),
      name: menuItem.name,
      price: Number(menuItem.price),
      quantity: Number(item.quantity),
    };
  });
  const canonicalSubtotal = normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  let order = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const orderCode = await generateDailyOrderCode(attempt);
    try {
      order = await insertOrderRecord({
        order_code: orderCode,
        type: 'dine-in',
        table_number: normalizedServiceMode === 'TABLE' ? normalizedTableNumber : null,
        customer_name: fallbackName,
        customer_phone: fallbackPhone,
        delivery_address: normalizedServiceMode === 'TAKEAWAY' ? `${TAKEAWAY_PREFIX}${normalizedTakeawayToken || 'Walk-In'}` : null,
        subtotal: canonicalSubtotal,
        delivery_charge: 0,
        total: canonicalSubtotal,
        status: 'IN_KITCHEN',
        payment_status: 'PENDING',
      });
      break;
    } catch (orderError) {
      if (!isDuplicateOrderCodeError(orderError)) {
        throw orderError;
      }
    }
  }

  if (!order) {
    const error = new Error('Could not allocate a unique order code. Please try again.');
    error.statusCode = 409;
    throw error;
  }

  const { error: itemsError } = await supabase.from('order_items').insert(
    normalizedItems.map((item) => ({
      order_id: order.id,
      item_name: item.name,
      quantity: item.quantity,
      price: item.price,
    })),
  );

  raise(itemsError);

  return {
    ...order,
    order_items: normalizedItems.map((item) => ({
      order_id: order.id,
      item_name: item.name,
      quantity: item.quantity,
      price: item.price,
    })),
    delivery_people: null,
    payment_record: null,
    razorpay_order_id: null,
    razorpay_payment_id: null,
    refund_id: null,
    refund_amount: null,
    refund_status: null,
    refund_failure_reason: null,
    refund_initiated_at: null,
    refund_processed_at: null,
  };
};

export const removeCounterOrderItem = async ({ orderId, orderItemId, quantityToRemove = 1 }) => {
  const { data: orderItems, error: itemsFetchError } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  raise(itemsFetchError, 404);

  const targetItem = (orderItems || []).find((item) => item.id === orderItemId);
  if (!targetItem) {
    const error = new Error('Could not find this item in the KOT.');
    error.statusCode = 404;
    throw error;
  }

  const removeCount = Math.max(1, Number(quantityToRemove || 1));
  const nextQuantity = Number(targetItem.quantity || 0) - removeCount;

  if (nextQuantity > 0) {
    const { error: updateItemError } = await supabase
      .from('order_items')
      .update({ quantity: nextQuantity })
      .eq('id', orderItemId);

    raise(updateItemError);
  } else {
    const { error: deleteItemError } = await supabase.from('order_items').delete().eq('id', orderItemId);
    raise(deleteItemError);
  }

  const { data: remainingItems, error: remainingItemsError } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId);

  raise(remainingItemsError);

  const nextSubtotal = (remainingItems || []).reduce(
    (sum, item) => sum + Number(item.price_at_purchase ?? item.price ?? 0) * Number(item.quantity || 0),
    0,
  );

  if (!remainingItems?.length) {
    await updateOrderRecord(orderId, {
      subtotal: 0,
      total: 0,
      status: 'CANCELLED',
      rejection_reason: 'Removed from final bill because the item was unavailable.',
    });
  } else {
    await updateOrderRecord(orderId, {
      subtotal: nextSubtotal,
      total: nextSubtotal,
    });
  }

  return getOrderById(orderId);
};

const buildSettlementReason = (payload) => `${SETTLEMENT_PREFIX}${JSON.stringify(payload)}`;

export const parseSettlementReason = (reason) => {
  if (!String(reason || '').startsWith(SETTLEMENT_PREFIX)) {
    return null;
  }

  try {
    return JSON.parse(String(reason).slice(SETTLEMENT_PREFIX.length));
  } catch {
    return null;
  }
};

export const getOrderByCode = async (orderCode) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*), delivery_people(name, phone)')
    .eq('order_code', orderCode)
    .maybeSingle();

  raise(error);
  return attachPaymentMetadata(data);
};

export const getOrderById = async (orderId) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*), delivery_people(name, phone)')
    .eq('id', orderId)
    .single();

  raise(error, 404);
  return attachPaymentMetadata(data);
};

export const findLatestOrderByPhone = async (phone) => {
  const minCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_code')
    .eq('customer_phone', phone)
    .gte('created_at', minCreatedAt)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  raise(error);
  return data;
};

export const getAllOrders = async () => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*), delivery_people(name, phone)')
    .order('created_at', { ascending: false });

  raise(error);
  return attachPaymentMetadataToList(data || []);
};

export const closeActiveTableOrders = async ({
  serviceMode = 'TABLE',
  tableNumber = null,
  takeawayToken = '',
  paymentMethod = 'CASH',
  tipAmount = 0,
}) => {
  const normalizedTable = String(tableNumber || '');
  const normalizedTakeawayToken = String(takeawayToken || '').trim();
  let ordersQuery = supabase
    .from('orders')
    .select('id, status, payment_status, type, table_number')
    .eq('type', 'dine-in')
    .neq('status', 'CANCELLED')
    .neq('payment_status', 'PAID');

  if (String(serviceMode).toUpperCase() === 'TAKEAWAY') {
    ordersQuery = ordersQuery.is('table_number', null).eq('delivery_address', `${TAKEAWAY_PREFIX}${normalizedTakeawayToken}`);
  } else {
    ordersQuery = ordersQuery.eq('table_number', normalizedTable);
  }

  const { data: tableOrders, error: ordersError } = await ordersQuery.order('created_at', { ascending: true });

  raise(ordersError);

  const settlementGroupId = `${String(serviceMode).toUpperCase()}-${normalizedTable || normalizedTakeawayToken || 'GROUP'}-${Date.now()}`;
  const primaryOrderId = tableOrders?.[tableOrders.length - 1]?.id || null;

  for (const order of tableOrders || []) {
    const settlementReason = buildSettlementReason({
      groupId: settlementGroupId,
      paymentMethod,
      tipAmount: order.id === primaryOrderId ? Number(tipAmount || 0) : 0,
      serviceMode: String(serviceMode).toUpperCase(),
      tableNumber: normalizedTable || null,
      takeawayToken: normalizedTakeawayToken || null,
      primary: order.id === primaryOrderId,
      settledAt: new Date().toISOString(),
    });

    await updateOrderRecord(order.id, {
      status: 'COMPLETED',
      payment_status: 'PAID',
      rejection_reason: settlementReason,
    });
  }

  return {
    closedCount: (tableOrders || []).length,
    tipAmount: Number(tipAmount || 0),
    settlementGroupId,
  };
};

export const getOrderSummary = async (orderId) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_code, status, type, payment_status, total')
    .eq('id', orderId)
    .single();
  raise(error, 404);
  return data;
};

export const getDeliveryPeople = async () => {
  const { data, error } = await supabase
    .from('delivery_people')
    .select('*')
    .eq('is_active', true);

  raise(error);
  return data || [];
};

export const createDeliveryPerson = async ({ name, phone }) => {
  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  const normalizedName = String(name || '').trim();

  const { data: existingPerson, error: existingError } = await supabase
    .from('delivery_people')
    .select('*')
    .eq('phone', normalizedPhone)
    .maybeSingle();

  raise(existingError);

  if (existingPerson) {
    if (existingPerson.is_active) {
      const error = new Error('A delivery person with this phone number already exists.');
      error.statusCode = 409;
      throw error;
    }

    const { data, error } = await supabase
      .from('delivery_people')
      .update({ name: normalizedName, is_active: true })
      .eq('id', existingPerson.id)
      .select()
      .single();

    raise(error);
    return data;
  }

  const { data, error } = await supabase
    .from('delivery_people')
    .insert({ name: normalizedName, phone: normalizedPhone, is_active: true })
    .select()
    .single();

  raise(error);
  return data;
};

export const deactivateDeliveryPerson = async (deliveryPersonId) => {
  const { data: activeOrder, error: activeOrderError } = await supabase
    .from('orders')
    .select('id, order_code')
    .eq('delivery_person_id', deliveryPersonId)
    .eq('status', 'OUT_FOR_DELIVERY')
    .limit(1)
    .maybeSingle();

  raise(activeOrderError);

  if (activeOrder) {
    const error = new Error(`Cannot remove this delivery person while order #${activeOrder.order_code} is out for delivery.`);
    error.statusCode = 409;
    throw error;
  }

  const { data, error } = await supabase
    .from('delivery_people')
    .update({ is_active: false })
    .eq('id', deliveryPersonId)
    .select()
    .single();

  raise(error, 404);
  return data;
};

export const updateOrderStatus = async (orderId, status, rejectionReason = null) => {
  const currentOrder = await getOrderSummary(orderId);
  assertValidStatusTransition({
    currentStatus: currentOrder.status,
    nextStatus: status,
    orderType: currentOrder.type,
  });

  const payload = { status };
  if (rejectionReason) {
    payload.rejection_reason = rejectionReason;
  }
  if (status === 'IN_KITCHEN') {
    payload.cook_started_at = new Date().toISOString();
  }

  await updateOrderRecord(orderId, payload);
};

export const cancelOrderWithRefund = async (orderId, rejectionReason = null) => {
  const currentOrder = await getOrderSummary(orderId);
  if (currentOrder.status === 'CANCELLED') {
    return getOrderById(orderId);
  }

  assertValidStatusTransition({
    currentStatus: currentOrder.status,
    nextStatus: 'CANCELLED',
    orderType: currentOrder.type,
  });

  const refundReason = rejectionReason || 'Cancelled by restaurant';
  const payload = {
    status: 'CANCELLED',
    rejection_reason: refundReason,
  };

  if (currentOrder.payment_status === 'PAID') {
    const paymentRecord = await findPaymentRecordByOrderId(orderId);
    if (!paymentRecord?.razorpayPaymentId) {
      const error = new Error('Refund-safe cancellation is blocked because payment metadata is missing for this order.');
      error.statusCode = 409;
      throw error;
    }

    if (!(paymentRecord.refundId && ['created', 'pending', 'processed', 'failed'].includes(paymentRecord.refundStatus || ''))) {
      const refundAmount = Math.round(Number(currentOrder.total || 0) * 100);
      const refund = await razorpay.payments.refund(paymentRecord.razorpayPaymentId, {
        amount: refundAmount,
        speed: 'normal',
        notes: {
          order_code: currentOrder.order_code,
          reason: refundReason,
        },
      });

      await upsertPaymentRecord({
        ...paymentRecord,
        orderId,
        orderCode: currentOrder.order_code,
        refundId: refund.id,
        refundAmount: refund.amount,
        refundStatus: refund.status,
        refundFailureReason: refund.error_description || null,
        refundInitiatedAt: new Date().toISOString(),
        refundProcessedAt: refund.status === 'processed' ? new Date().toISOString() : null,
        paymentStatus: currentOrder.payment_status,
      });
    }
  }

  await updateOrderRecord(orderId, payload);

  return getOrderById(orderId);
};

export const assignDeliveryPartner = async (orderId, deliveryPersonId) => {
  const currentOrder = await getOrderSummary(orderId);
  assertValidStatusTransition({
    currentStatus: currentOrder.status,
    nextStatus: 'OUT_FOR_DELIVERY',
    orderType: currentOrder.type,
  });

  if (currentOrder.type !== 'delivery') {
    const error = new Error('Only delivery orders can be assigned to a delivery partner');
    error.statusCode = 400;
    throw error;
  }

  const { error } = await supabase
    .from('orders')
    .update({ delivery_person_id: deliveryPersonId, status: 'OUT_FOR_DELIVERY' })
    .eq('id', orderId);

  raise(error);
};

export const getKitchenOrders = async () => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .in('status', ['CONFIRMED', 'IN_KITCHEN'])
    .order('created_at', { ascending: true });

  raise(error);
  return attachPaymentMetadataToList(data || []);
};

export const getReadyCount = async () => {
  const { count, error } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'READY');

  raise(error);
  return count || 0;
};

export const syncRefundStatusFromWebhook = async ({ paymentId, refundId, refundAmount, refundStatus, refundFailureReason = null }) => {
  const paymentRecord = await findPaymentRecordByPaymentId(paymentId);
  if (!paymentRecord?.orderId) {
    return null;
  }

  await upsertPaymentRecord({
    ...paymentRecord,
    refundId,
    refundAmount,
    refundStatus,
    refundFailureReason,
    refundInitiatedAt: paymentRecord.refundInitiatedAt || new Date().toISOString(),
    refundProcessedAt: refundStatus === 'processed' ? new Date().toISOString() : paymentRecord.refundProcessedAt || null,
    paymentStatus: paymentRecord.paymentStatus || 'PAID',
  });

  return paymentRecord.orderId;
};
