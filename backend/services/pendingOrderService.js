import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../config/supabase.js';
import { shouldUseLocalFallback } from './storageMode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pendingOrdersPath = path.join(__dirname, '../data/pending-orders.json');
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TABLE = 'pending_order_drafts';

const readPendingOrders = async () => {
  try {
    const file = await fs.readFile(pendingOrdersPath, 'utf8');
    const parsed = JSON.parse(file);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

const writePendingOrders = async (records) => {
  await fs.writeFile(pendingOrdersPath, JSON.stringify(records, null, 2));
};

const pruneExpired = (records) => {
  const now = Date.now();
  return records.filter((record) => now - new Date(record.createdAt).getTime() < MAX_AGE_MS);
};

const fromDbRecord = (record) =>
  record
    ? {
        razorpayOrderId: record.razorpay_order_id,
        amount: record.amount,
        receipt: record.receipt,
        draft: record.draft,
        createdAt: record.created_at,
      }
    : null;

const fetchPendingDraftFromDb = async (razorpayOrderId) => {
  try {
    const minCreatedAt = new Date(Date.now() - MAX_AGE_MS).toISOString();
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('razorpay_order_id', razorpayOrderId)
      .gte('created_at', minCreatedAt)
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

export const savePendingOrderDraft = async ({ razorpayOrderId, amount, receipt, draft }) => {
  const nextRecord = {
    razorpayOrderId,
    amount,
    receipt,
    draft,
    createdAt: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(
        {
          razorpay_order_id: razorpayOrderId,
          amount,
          receipt,
          draft,
        },
        { onConflict: 'razorpay_order_id' },
      )
      .select('*')
      .single();

    if (error) throw error;
    return fromDbRecord(data);
  } catch (error) {
    if (!shouldUseLocalFallback(error, TABLE)) {
      throw error;
    }
  }

  const records = pruneExpired(await readPendingOrders());
  const nextRecords = records.filter((record) => record.razorpayOrderId !== razorpayOrderId);
  nextRecords.push(nextRecord);
  await writePendingOrders(nextRecords);
  return nextRecord;
};

export const findPendingOrderDraft = async (razorpayOrderId) => {
  const dbRecord = await fetchPendingDraftFromDb(razorpayOrderId);
  if (dbRecord) return dbRecord;

  const records = pruneExpired(await readPendingOrders());
  const match = records.find((record) => record.razorpayOrderId === razorpayOrderId) || null;
  await writePendingOrders(records);
  return match;
};
