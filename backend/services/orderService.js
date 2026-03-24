import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { razorpay } from '../config/razorpay.js';

const raise = (error, fallback = 500) => {
  if (error) {
    const wrapped = new Error(error.message);
    wrapped.statusCode = fallback;
    throw wrapped;
  }
};

export const createRazorpayOrder = async ({ amount, receipt }) =>
  razorpay.orders.create({
    amount,
    currency: 'INR',
    receipt,
    payment_capture: 1,
  });

export const verifyPaymentSignature = ({ orderId, paymentId, signature, secret }) => {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return expected === signature;
};

export const persistPaidOrder = async ({
  orderCode,
  orderType,
  customerName,
  customerPhone,
  tableNumber,
  deliveryAddress,
  subtotal,
  deliveryCharge,
  total,
  paymentId,
  items,
}) => {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      order_code: orderCode,
      type: orderType,
      table_number: orderType === 'dine-in' ? tableNumber : null,
      customer_name: customerName,
      customer_phone: customerPhone,
      delivery_address: orderType === 'delivery' ? deliveryAddress : null,
      subtotal,
      delivery_charge: deliveryCharge,
      total,
      payment_id: paymentId,
      status: 'NEW',
      payment_status: 'PAID',
    })
    .select()
    .single();

  raise(orderError);

  const { error: itemsError } = await supabase.from('order_items').insert(
    items.map((item) => ({
      order_id: order.id,
      item_name: item.name,
      quantity: item.quantity,
      price: item.price,
    })),
  );

  raise(itemsError);
  return order;
};

export const getOrderById = async (orderId) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*), delivery_people(name, phone)')
    .eq('id', orderId)
    .single();

  raise(error, 404);
  return data;
};

export const findLatestOrderByPhone = async (phone) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_code')
    .eq('customer_phone', phone)
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
  return data || [];
};

export const getDeliveryPeople = async () => {
  const { data, error } = await supabase
    .from('delivery_people')
    .select('*')
    .eq('is_active', true);

  raise(error);
  return data || [];
};

export const updateOrderStatus = async (orderId, status, rejectionReason = null) => {
  const payload = { status };
  if (rejectionReason) {
    payload.rejection_reason = rejectionReason;
  }
  if (status === 'IN_KITCHEN') {
    payload.cook_started_at = new Date().toISOString();
  }

  const { error } = await supabase.from('orders').update(payload).eq('id', orderId);
  raise(error);
};

export const assignDeliveryPartner = async (orderId, deliveryPersonId) => {
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
  return data || [];
};

export const getReadyCount = async () => {
  const { count, error } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'READY');

  raise(error);
  return count || 0;
};
