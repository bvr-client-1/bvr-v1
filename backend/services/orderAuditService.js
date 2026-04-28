import fs from 'fs/promises';
import path from 'path';
import { supabase } from '../config/supabase.js';

const TABLE = 'order_audit_events';
const auditStorePath = path.resolve(process.cwd(), 'backend/data/order-audit-events.json');

const ensureStore = async () => {
  try {
    await fs.access(auditStorePath);
  } catch {
    await fs.mkdir(path.dirname(auditStorePath), { recursive: true });
    await fs.writeFile(auditStorePath, JSON.stringify({ records: [] }, null, 2));
  }
};

const readStore = async () => {
  await ensureStore();
  const raw = await fs.readFile(auditStorePath, 'utf8');
  const parsed = raw.trim() ? JSON.parse(raw) : { records: [] };
  return {
    records: Array.isArray(parsed.records) ? parsed.records : [],
  };
};

const writeStore = async (store) => {
  await fs.writeFile(auditStorePath, `${JSON.stringify(store, null, 2)}\n`);
};

const shouldFallbackToLocal = (error) => {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    /schema cache/i.test(message) ||
    /Could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message)
  );
};

const sortNewestFirst = (records) =>
  [...records].sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());

const toDbRecord = (payload) => ({
  order_id: payload.orderId,
  order_item_id: payload.orderItemId || null,
  event_type: payload.eventType,
  actor_role: payload.actorRole || null,
  actor_id: payload.actorId || null,
  item_name: payload.itemName || null,
  quantity_removed: payload.quantityRemoved ?? null,
  unit_price: payload.unitPrice ?? null,
  line_total: payload.lineTotal ?? null,
  consent_status: payload.consentStatus || 'UNKNOWN',
  note: payload.note || null,
  metadata: payload.metadata || {},
});

const fromDbRecord = (record) =>
  record
    ? {
        id: record.id,
        orderId: record.order_id,
        orderItemId: record.order_item_id,
        eventType: record.event_type,
        actorRole: record.actor_role,
        actorId: record.actor_id,
        itemName: record.item_name,
        quantityRemoved: record.quantity_removed,
        unitPrice: record.unit_price,
        lineTotal: record.line_total,
        consentStatus: record.consent_status,
        note: record.note,
        metadata: record.metadata || {},
        createdAt: record.created_at,
      }
    : null;

const appendLocalEvent = async (payload) => {
  const store = await readStore();
  const now = new Date().toISOString();
  const record = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...payload,
    createdAt: now,
  };
  store.records.push(record);
  await writeStore(store);
  return record;
};

export const logOrderAuditEvent = async (payload) => {
  try {
    const { data, error } = await supabase.from(TABLE).insert(toDbRecord(payload)).select('*').single();
    if (error) throw error;
    return fromDbRecord(data);
  } catch (error) {
    if (shouldFallbackToLocal(error)) {
      return appendLocalEvent(payload);
    }
    throw error;
  }
};

export const getOrderAuditEventsByOrderIds = async (orderIds) => {
  const normalizedIds = [...new Set((orderIds || []).filter(Boolean))];
  if (!normalizedIds.length) {
    return new Map();
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .in('order_id', normalizedIds)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const grouped = new Map();
    for (const record of data || []) {
      const mapped = fromDbRecord(record);
      if (!grouped.has(mapped.orderId)) {
        grouped.set(mapped.orderId, []);
      }
      grouped.get(mapped.orderId).push(mapped);
    }
    return grouped;
  } catch (error) {
    if (!shouldFallbackToLocal(error)) {
      throw error;
    }

    const store = await readStore();
    const grouped = new Map();
    for (const record of sortNewestFirst(store.records)) {
      if (!normalizedIds.includes(record.orderId)) continue;
      if (!grouped.has(record.orderId)) {
        grouped.set(record.orderId, []);
      }
      grouped.get(record.orderId).push(record);
    }
    return grouped;
  }
};
