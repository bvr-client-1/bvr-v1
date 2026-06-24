'use client';

const getPrintBridgeUrl = () => {
  if (typeof window === 'undefined') return 'http://127.0.0.1:9123';
  return window.localStorage.getItem('bvr_print_bridge_url') || process.env.NEXT_PUBLIC_LOCAL_PRINT_BRIDGE_URL || 'http://127.0.0.1:9123';
};

export const testPrinterConnection = async (host, port) => {
  const printBridgeUrl = getPrintBridgeUrl();
  try {
    const response = await fetch(`${printBridgeUrl}/print/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port }),
    });
    const data = await response.json();
    return { ok: response.ok && data.ok === true, message: data.message || 'Verification complete' };
  } catch (error) {
    return { ok: false, message: error.message || 'Print bridge is not running' };
  }
};

export const getPrintQueue = () => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem('bvr_pending_prints');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('[printQueue] Failed to parse print queue:', e.message);
    return [];
  }
};

const savePrintQueue = (queue) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('bvr_pending_prints', JSON.stringify(queue));
  } catch (e) {
    console.error('[printQueue] Failed to save print queue:', e.message);
  }
};

export const clearPrintQueue = () => {
  savePrintQueue([]);
};

export const printOrderCopiesLocally = async (order) => {
  if (typeof window === 'undefined' || !order) {
    return { ok: false, message: 'No order to print' };
  }

  const printBridgeUrl = getPrintBridgeUrl();
  const payload = {
    order,
    kitchenPrinterIp: window.localStorage.getItem('bvr_kitchen_printer_ip') || '192.168.1.110',
    kitchenPrinterPort: Number(window.localStorage.getItem('bvr_kitchen_printer_port') || '9100'),
    counterPrinterIp: window.localStorage.getItem('bvr_counter_printer_ip') || '192.168.1.110',
    counterPrinterPort: Number(window.localStorage.getItem('bvr_counter_printer_port') || '9100'),
  };

  try {
    const response = await fetch(`${printBridgeUrl}/print/order-copies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.ok === false) {
      throw new Error(data.message || 'Printer rejected print job');
    }

    return { ok: true };
  } catch (error) {
    console.warn('[printService] Immediate print failed, queueing order:', order.order_code, error.message);
    const queue = getPrintQueue();
    // Prevent duplicate entries for the same order in queue
    if (!queue.some(job => job.id === order.id)) {
      queue.push({
        id: order.id,
        order,
        timestamp: Date.now(),
        retries: 0,
        payload,
      });
      savePrintQueue(queue);
    }
    return { ok: false, queued: true, message: error.message || 'Printer unreachable. Queued.' };
  }
};

export const flushPrintQueue = async () => {
  if (typeof window === 'undefined') return { processed: 0, failed: 0 };
  const queue = getPrintQueue();
  if (!queue.length) return { processed: 0, failed: 0 };

  const printBridgeUrl = getPrintBridgeUrl();
  const remaining = [];
  let processed = 0;
  let failed = 0;

  for (const job of queue) {
    try {
      const response = await fetch(`${printBridgeUrl}/print/order-copies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job.payload),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok !== false) {
        processed++;
      } else {
        throw new Error(data.message || 'Printer rejected job');
      }
    } catch (err) {
      failed++;
      job.retries = (job.retries || 0) + 1;
      remaining.push(job);
      console.warn(`[printQueue] Retry failed for order ${job.order?.order_code}:`, err.message);
    }
  }

  savePrintQueue(remaining);
  return { processed, failed };
};

export const printDaySalesReportLocally = async (dateLabel, report) => {
  if (typeof window === 'undefined') {
    return { ok: false, message: 'Not in browser context' };
  }

  const printBridgeUrl = getPrintBridgeUrl();
  const payload = {
    dateLabel,
    report,
    counterPrinterIp: window.localStorage.getItem('bvr_counter_printer_ip') || '192.168.1.110',
    counterPrinterPort: Number(window.localStorage.getItem('bvr_counter_printer_port') || '9100'),
  };

  try {
    const response = await fetch(`${printBridgeUrl}/print/day-sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.ok === false) {
      throw new Error(data.message || 'Printer rejected print job');
    }

    return { ok: true };
  } catch (error) {
    console.error('[printService] Day sales report print failed:', error.message);
    return { ok: false, message: error.message || 'Printer unreachable' };
  }
};
