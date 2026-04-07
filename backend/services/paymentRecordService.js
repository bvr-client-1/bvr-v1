import fs from 'fs/promises';
import path from 'path';
import { supabase } from '../config/supabase.js';
import { shouldUseLocalFallback } from './storageMode.js';

const paymentRecordsPath = path.resolve(process.cwd(), 'backend/data/payment-records.json');
const TABLE = 'payment_records';

const ensureStore = async () => {
  try {
    await fs.access(paymentRecordsPath);
  } catch {
    await fs.mkdir(path.dirname(paymentRecordsPath), { recursive: true });
    await fs.writeFile(paymentRecordsPath, JSON.stringify({ records: [] }, null, 2));
  }
};

const readStore = async () => {
  await ensureStore();
  const raw = await fs.readFile(paymentRecordsPath, 'utf8');
  const parsed = raw.trim() ? JSON.parse(raw) : { records: [] };
  if (Array.isArray(parsed)) {
    return { records: parsed };
  }
  return {
    records: Array.isArray(parsed.records) ? parsed.records : [],
  };
};

const writeStore = async (store) => {
  await fs.writeFile(paymentRecordsPath, `${JSON.stringify(store, null, 2)}\n`);
};

const sortByUpdatedAt = (records) =>
  [...records].sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());

const toDbRecord = (payload) => ({
  order_id: payload.orderId ?? null,
  order_code: payload.orderCode ?? null,
  razorpay_order_id: payload.razorpayOrderId ?? null,
  razorpay_payment_id: payload.razorpayPaymentId ?? null,
  amount: payload.amount ?? null,
  payment_status: payload.paymentStatus ?? null,
  refund_id: payload.refundId ?? null,
  refund_amount: payload.refundAmount ?? null,
  refund_status: payload.refundStatus ?? null,
  refund_failure_reason: payload.refundFailureReason ?? null,
  refund_initiated_at: payload.refundInitiatedAt ?? null,
  refund_processed_at: payload.refundProcessedAt ?? null,
});

const fromDbRecord = (record) =>
  record
    ? {
        orderId: record.order_id,
        orderCode: record.order_code,
        razorpayOrderId: record.razorpay_order_id,
        razorpayPaymentId: record.razorpay_payment_id,
        amount: record.amount,
        paymentStatus: record.payment_status,
        refundId: record.refund_id,
        refundAmount: record.refund_amount,
        refundStatus: record.refund_status,
        refundFailureReason: record.refund_failure_reason,
        refundInitiatedAt: record.refund_initiated_at,
        refundProcessedAt: record.refund_processed_at,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
      }
    : null;

const findLocalRecord = async (matcher) => {
  const store = await readStore();
  return sortByUpdatedAt(store.records).find(matcher) || null;
};

const upsertLocalRecord = async (payload) => {
  const store = await readStore();
  const now = new Date().toISOString();
  const recordIndex = store.records.findIndex(
    (record) =>
      (payload.orderId && record.orderId === payload.orderId) ||
      (payload.orderCode && record.orderCode === payload.orderCode) ||
      (payload.razorpayOrderId && record.razorpayOrderId === payload.razorpayOrderId) ||
      (payload.razorpayPaymentId && record.razorpayPaymentId === payload.razorpayPaymentId),
  );

  const previous = recordIndex >= 0 ? store.records[recordIndex] : {};
  const nextRecord = {
    ...previous,
    ...payload,
    createdAt: previous.createdAt || now,
    updatedAt: now,
  };

  if (recordIndex >= 0) {
    store.records[recordIndex] = nextRecord;
  } else {
    store.records.push(nextRecord);
  }

  await writeStore(store);
  return nextRecord;
};

const findDbRecord = async (column, value) => {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq(column, value)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return fromDbRecord(data);
  } catch (error) {
    if (shouldUseLocalFallback(error, TABLE)) {
      return null;
    }
    throw error;
  }
};

export const findPaymentRecordByOrderId = async (orderId) => {
  const dbRecord = await findDbRecord('order_id', orderId);
  if (dbRecord) return dbRecord;
  return findLocalRecord((record) => record.orderId === orderId);
};

export const findPaymentRecordByOrderCode = async (orderCode) => {
  const dbRecord = await findDbRecord('order_code', orderCode);
  if (dbRecord) return dbRecord;
  return findLocalRecord((record) => record.orderCode === orderCode);
};

export const findPaymentRecordByPaymentId = async (paymentId) => {
  const dbRecord = await findDbRecord('razorpay_payment_id', paymentId);
  if (dbRecord) return dbRecord;
  return findLocalRecord((record) => record.razorpayPaymentId === paymentId);
};

export const upsertPaymentRecord = async (payload) => {
  try {
    const dbPayload = toDbRecord(payload);
    let existing = null;

    if (payload.orderId) existing = await findDbRecord('order_id', payload.orderId);
    if (!existing && payload.orderCode) existing = await findDbRecord('order_code', payload.orderCode);
    if (!existing && payload.razorpayOrderId) existing = await findDbRecord('razorpay_order_id', payload.razorpayOrderId);
    if (!existing && payload.razorpayPaymentId) existing = await findDbRecord('razorpay_payment_id', payload.razorpayPaymentId);

    const query = existing
      ? supabase.from(TABLE).update(dbPayload).eq('order_id', existing.orderId).select('*').single()
      : supabase.from(TABLE).insert(dbPayload).select('*').single();

    const { data, error } = await query;
    if (error) throw error;
    return fromDbRecord(data);
  } catch (error) {
    if (shouldUseLocalFallback(error, TABLE)) {
      return upsertLocalRecord(payload);
    }
    throw error;
  }
};

export const attachPaymentMetadata = async (order) => {
  if (!order) return order;

  const record = await findPaymentRecordByOrderId(order.id);
  return {
    ...order,
    payment_record: record,
    razorpay_order_id: record?.razorpayOrderId || null,
    razorpay_payment_id: record?.razorpayPaymentId || null,
    refund_id: record?.refundId || null,
    refund_amount: record?.refundAmount ?? null,
    refund_status: record?.refundStatus || null,
    refund_failure_reason: record?.refundFailureReason || null,
    refund_initiated_at: record?.refundInitiatedAt || null,
    refund_processed_at: record?.refundProcessedAt || null,
  };
};

export const attachPaymentMetadataToList = async (orders) => Promise.all((orders || []).map((order) => attachPaymentMetadata(order)));
