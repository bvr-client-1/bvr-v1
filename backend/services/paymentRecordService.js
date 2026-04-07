import fs from 'fs/promises';
import path from 'path';

const paymentRecordsPath = path.resolve(process.cwd(), 'backend/data/payment-records.json');

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

export const findPaymentRecordByOrderId = async (orderId) => {
  const store = await readStore();
  return sortByUpdatedAt(store.records).find((record) => record.orderId === orderId) || null;
};

export const findPaymentRecordByOrderCode = async (orderCode) => {
  const store = await readStore();
  return sortByUpdatedAt(store.records).find((record) => record.orderCode === orderCode) || null;
};

export const findPaymentRecordByPaymentId = async (paymentId) => {
  const store = await readStore();
  return sortByUpdatedAt(store.records).find((record) => record.razorpayPaymentId === paymentId) || null;
};

export const upsertPaymentRecord = async (payload) => {
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
