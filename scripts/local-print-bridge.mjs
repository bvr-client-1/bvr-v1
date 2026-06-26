import http from 'node:http';
import net from 'node:net';

process.on('uncaughtException', (error) => {
  console.error('[CRITICAL] Uncaught Exception:', error);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = Number(process.env.PRINT_BRIDGE_PORT || 9123);
const COUNTER_PRINTER_HOST = process.env.COUNTER_PRINTER_HOST || '192.168.1.110';
const KITCHEN_PRINTER_HOST = process.env.KITCHEN_PRINTER_HOST || '192.168.1.100';
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const command = (...bytes) => Buffer.from(bytes);
const text = (value = '') => Buffer.from(String(value), 'ascii');
const line = (value = '') => Buffer.concat([text(value), command(LF)]);
const money = (value) => `Rs.${Number(value || 0).toFixed(2)}`;
const shouldApplyRestaurantGst = (order) => order?.type !== 'delivery';
const getRestaurantTaxBreakup = (amount) => {
  const subtotal = Number(amount || 0);
  const cgst = Math.round(subtotal * 0.025 * 100) / 100;
  const sgst = Math.round(subtotal * 0.025 * 100) / 100;
  const exactTotal = Math.round((subtotal + cgst + sgst) * 100) / 100;
  return { cgst, sgst, grandTotal: Math.ceil(exactTotal), roundOff: Math.ceil(exactTotal) - exactTotal };
};
const clean = (value = '') =>
  String(value ?? '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const width = 42;
const divider = '-'.repeat(width);
const center = (value) => {
  const cleaned = clean(value).slice(0, width);
  const pad = Math.max(0, Math.floor((width - cleaned.length) / 2));
  return `${' '.repeat(pad)}${cleaned}`;
};
const pair = (left, right) => {
  const cleanedLeft = clean(left);
  const cleanedRight = clean(right);
  const available = Math.max(1, width - cleanedRight.length - 1);
  return `${cleanedLeft.slice(0, available).padEnd(available, ' ')} ${cleanedRight}`;
};
const wrap = (value, max = width) => {
  const words = clean(value).split(' ').filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word.slice(0, max);
      continue;
    }
    if (`${current} ${word}`.length <= max) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word.slice(0, max);
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [''];
};
const itemRows = (items = []) =>
  items.flatMap((item) => {
    const quantity = Number(item.quantity || 0);
    const rate = Number(item.price_at_purchase ?? item.price ?? 0);
    const total = rate * quantity;
    const rows = wrap(item.item_name || item.name || 'Item', 26);
    return [
      pair(`${rows[0]} x${quantity}`, money(total)),
      ...rows.slice(1).map((row) => `  ${row}`),
    ];
  });
const getModeLabel = (order) => {
  if (order.type === 'delivery') return 'DELIVERY';
  const marker = String(order.delivery_address || '');
  if (marker.startsWith('TAKEAWAY::')) return `TAKEAWAY ${marker.slice('TAKEAWAY::'.length) || 'Walk-In'}`;
  return `TABLE ${order.table_number || '-'}`;
};
const getOrderMeta = (order) => {
  if (order.type === 'delivery') return order.delivery_address || 'Delivery order';
  const marker = String(order.delivery_address || '');
  if (marker.startsWith('TAKEAWAY::')) return order.customer_name || marker.replace('TAKEAWAY::', 'Takeaway ');
  return order.customer_name || `Walk-in Table ${order.table_number || '-'}`;
};
const header = () =>
  Buffer.concat([
    command(ESC, 0x40),
    command(ESC, 0x61, 0x01),
    command(ESC, 0x21, 0x20),
    line('BANGARU VAKILI'),
    command(ESC, 0x21, 0x00),
    line('FAMILY RESTAURANT'),
    line('SHIVAJI NAGAR, NALGONDA'),
    command(ESC, 0x61, 0x00),
    line(divider),
  ]);
const finish = () => Buffer.concat([line(divider), line(''), line(''), line(''), command(GS, 0x56, 0x41, 0x10)]);

const buildKotBytes = (order) => {
  const isCancelled = order.status === 'CANCELLED';
  const heading = isCancelled ? 'CANCEL KOT' : 'KOT';
  return Buffer.concat([
    header(),
    command(ESC, 0x61, 0x01),
    command(ESC, 0x21, 0x30),
    line(heading),
    command(ESC, 0x21, 0x00),
    command(ESC, 0x61, 0x00),
    command(ESC, 0x21, 0x08),
    line(pair('Order', `#${order.order_code || '-'}`)),
    line(pair('Type', getModeLabel(order))),
    command(ESC, 0x21, 0x00),
    line(pair('Time', new Date(order.created_at || Date.now()).toLocaleTimeString('en-IN'))),
    ...wrap(getOrderMeta(order)).map(line),
    line(divider),
    command(ESC, 0x21, 0x08),
    ...itemRows(order.order_items || []).map(line),
    command(ESC, 0x21, 0x00),
    finish(),
  ]);
};

const buildQrCodeBytes = (dataText) => {
  const storeLen = dataText.length + 3;
  const pL = storeLen % 256;
  const pH = Math.floor(storeLen / 256);

  return Buffer.concat([
    // 1. Select model: Model 2 (Hex: 1D 28 6B 04 00 31 41 32 00)
    Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
    // 2. Set module size: Size 4 (Hex: 1D 28 6B 03 00 31 43 04)
    Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x04]),
    // 3. Set error correction: Level L (Hex: 1D 28 6B 03 00 31 45 31)
    Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
    // 4. Store data: 1D 28 6B pL pH 31 50 30 + data
    Buffer.from([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
    Buffer.from(dataText, 'ascii'),
    // 5. Print: 1D 28 6B 03 00 31 51 30
    Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
  ]);
};

const buildBillBytes = (order, variant = 'customer', copyLabel = '') => {
  const items = order.order_items || [];
  const total = Number(order.total || items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price_at_purchase ?? item.price ?? 0), 0));
  const restaurantSubtotal = Number(order.subtotal || total);
  const tax = getRestaurantTaxBreakup(restaurantSubtotal);
  const payableTotal = shouldApplyRestaurantGst(order) ? tax.grandTotal : total;

  let heading = 'CASH / BILL';
  if (variant === 'demo') heading = 'DEMO CHECK BILL';
  else if (variant === 'counter') heading = 'COUNTER BILL';

  let subHeadingBytes = Buffer.alloc(0);
  if (copyLabel) {
    subHeadingBytes = Buffer.concat([
      command(ESC, 0x61, 0x01), // Center
      command(ESC, 0x21, 0x08), // Bold
      line(copyLabel.toUpperCase()),
      command(ESC, 0x21, 0x00), // Normal
      command(ESC, 0x61, 0x00), // Left
    ]);
  }

  let qrCodeBytes = Buffer.alloc(0);
  // Show QR code on final customer bill only (not counter record copy and not demo bill)
  if (variant === 'customer') {
    qrCodeBytes = Buffer.concat([
      line(''),
      command(ESC, 0x61, 0x01), // Center
      line('Scan to view menu & order online:'),
      line('bangaruvakili.com'),
      line(''),
      buildQrCodeBytes('https://bangaruvakili.com'),
      line(''),
    ]);
  }

  return Buffer.concat([
    header(),
    command(ESC, 0x61, 0x01), // Center
    command(ESC, 0x21, 0x30), // Double height + double width
    line(heading),
    command(ESC, 0x21, 0x00), // Normal
    command(ESC, 0x61, 0x00), // Left
    subHeadingBytes,
    line(divider),
    command(ESC, 0x21, 0x08),
    line(pair(getModeLabel(order), `#${order.order_code || '-'}`)),
    command(ESC, 0x21, 0x00),
    line(pair('Date', new Date(order.created_at || Date.now()).toLocaleString('en-IN'))),
    ...wrap(getOrderMeta(order)).map(line),
    line(divider),
    ...itemRows(items).map(line),
    line(divider),
    line(pair('SUBTOTAL', money(shouldApplyRestaurantGst(order) ? restaurantSubtotal : total))),
    ...(shouldApplyRestaurantGst(order)
      ? [
          line(pair('CGST 2.5%', money(tax.cgst))),
          line(pair('SGST 2.5%', money(tax.sgst))),
          ...(tax.roundOff ? [line(pair('ROUNDED UP', money(tax.roundOff)))] : []),
        ]
      : []),
    command(ESC, 0x21, 0x20),
    line(pair('TOTAL', money(payableTotal))),
    command(ESC, 0x21, 0x00),
    qrCodeBytes,
    finish(),
  ]);
};

const buildDaySalesReportBytes = (dateLabel, report) => {
  const items = report.items || [];
  const reportRows = items.flatMap((item) => {
    const qty = Number(item.quantity || 0);
    const rate = Number(item.rate || 0);
    const amount = Number(item.amount || 0);
    const rows = wrap(item.name || 'Item', 26);
    return [
      pair(`${rows[0]} x${qty}`, money(amount)),
      ...rows.slice(1).map((row) => `  ${row}`),
    ];
  });

  return Buffer.concat([
    header(),
    command(ESC, 0x61, 0x01),
    command(ESC, 0x21, 0x30),
    line('DAY SALE REPORT'),
    command(ESC, 0x21, 0x00),
    command(ESC, 0x61, 0x00),
    command(ESC, 0x21, 0x08),
    line(pair('Date', dateLabel)),
    line(divider),
    ...reportRows.map(line),
    line(divider),
    line(pair('Orders', String(report.orderCount))),
    line(pair('Items', String(report.itemCount))),
    line(pair('Cancelled', String(report.cancelledCount))),
    line(pair('Food Sale', money(report.foodRevenue))),
    line(pair('Tips', money(report.tipTotal))),
    line(divider),
    command(ESC, 0x21, 0x20),
    line(pair('TOTAL', money(report.totalRevenue))),
    command(ESC, 0x21, 0x00),
    finish(),
  ]);
};

const sendToPrinter = ({ host, port, payload }) =>
  new Promise((resolve, reject) => {
    let resolved = false;
    const socket = net.createConnection({ host, port, timeout: 5000 });

    socket.on('connect', () => {
      socket.write(payload, () => socket.end());
    });

    socket.on('close', (hadError) => {
      if (!resolved) {
        resolved = true;
        if (hadError) {
          reject(new Error(`Printer socket closed with transmission error: ${host}:${port}`));
        } else {
          resolve();
        }
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      if (!resolved) {
        resolved = true;
        reject(new Error(`Printer timed out: ${host}:${port}`));
      }
    });

    socket.on('error', (err) => {
      socket.destroy();
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
  });

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(payload));
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, {
      ok: true,
      counterPrinter: `${COUNTER_PRINTER_HOST}:${PRINTER_PORT}`,
      kitchenPrinter: `${KITCHEN_PRINTER_HOST}:${PRINTER_PORT}`,
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/print/test-connection') {
    try {
      const body = await readJsonBody(req);
      const host = body.host;
      const port = Number(body.port || 9100);
      if (!host) {
        sendJson(res, 400, { ok: false, message: 'Missing host' });
        return;
      }

      await new Promise((resolve, reject) => {
        let resolved = false;
        const socket = net.createConnection({ host, port, timeout: 2500 });
        
        socket.on('connect', () => {
          socket.end();
          if (!resolved) {
            resolved = true;
            resolve();
          }
        });
        
        socket.on('error', (err) => {
          socket.destroy();
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        });
        
        socket.on('timeout', () => {
          socket.destroy();
          if (!resolved) {
            resolved = true;
            reject(new Error('Timeout connecting to printer'));
          }
        });

        socket.on('close', () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        });
      });

      sendJson(res, 200, { ok: true, message: 'Printer is online' });
    } catch (error) {
      sendJson(res, 500, { ok: false, message: error.message || 'Connection failed' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/print/day-sales') {
    try {
      const body = await readJsonBody(req);
      if (!body.report || !body.dateLabel) {
        sendJson(res, 400, { ok: false, message: 'Missing report or dateLabel' });
        return;
      }

      const counterHost = body.counterPrinterIp || COUNTER_PRINTER_HOST;
      const counterPort = Number(body.counterPrinterPort || PRINTER_PORT);

      const payload = buildDaySalesReportBytes(body.dateLabel, body.report);
      await sendToPrinter({ host: counterHost, port: counterPort, payload });

      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { ok: false, message: error.message || 'Print failed' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/print/order-copies') {
    try {
      const body = await readJsonBody(req);
      if (!body.order) {
        sendJson(res, 400, { ok: false, message: 'Missing order' });
        return;
      }

      const kitchenHost = body.kitchenPrinterIp || KITCHEN_PRINTER_HOST;
      const kitchenPort = Number(body.kitchenPrinterPort || PRINTER_PORT);
      const counterHost = body.counterPrinterIp || COUNTER_PRINTER_HOST;
      const counterPort = Number(body.counterPrinterPort || PRINTER_PORT);
      
      const variant = body.variant || 'customer';
      const copyLabel = body.copyLabel || '';

      const printType = body.printType || 'both';
      const copies = Number(body.copies || 1);

      for (let i = 0; i < copies; i++) {
        if (printType === 'kot' || printType === 'both') {
          await sendToPrinter({ host: kitchenHost, port: kitchenPort, payload: buildKotBytes(body.order) });
        }
        
        if (printType === 'bill' || printType === 'both') {
          await sendToPrinter({ host: counterHost, port: counterPort, payload: buildBillBytes(body.order, variant, copyLabel) });
        }
      }

      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { ok: false, message: error.message || 'Print failed' });
    }
    return;
  }

  sendJson(res, 404, { ok: false, message: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`BVR local print bridge running at http://0.0.0.0:${PORT}`);
  console.log(`Counter bill printer: ${COUNTER_PRINTER_HOST}:${PRINTER_PORT}`);
  console.log(`Kitchen KOT printer: ${KITCHEN_PRINTER_HOST}:${PRINTER_PORT}`);
});

// ─── Supabase Polling for Cloud Auto-Printing ────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://feglxiibeuzsahoevzuu.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlZ2x4aWliZXV6c2Fob2V2enV1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzIxODczMywiZXhwIjoyMDg4Nzk0NzMzfQ.e3xVmckMyEij5GXTw52B1QzpAKvtosJqiggmOfn8sFg';
const AUTO_PRINT_POLL_INTERVAL_MS = 3000;

const printedKotOrderIds = new Set();
const printedBillOrderIds = new Set();
const printedCancelKotOrderIds = new Set();
let isFirstPrintPoll = true;

const fetchActiveOrdersForPrinting = async () => {
  const url = `${SUPABASE_URL}/rest/v1/orders?status=in.(NEW,IN_KITCHEN,COMPLETED,CANCELLED)&order=created_at.desc&limit=30`;
  const response = await fetch(`${url}&select=*,order_items(*)`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Supabase API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
};

const pollForAutoPrint = async () => {
  try {
    const orders = await fetchActiveOrdersForPrinting();

    if (isFirstPrintPoll) {
      for (const o of orders) {
        printedKotOrderIds.add(o.id);
        printedBillOrderIds.add(o.id);
        printedCancelKotOrderIds.add(o.id);
      }
      isFirstPrintPoll = false;
      console.log(`[AUTO-PRINT] Initialized. Watching for KOTs, Bills, and Cancel KOTs...`);
      return;
    }

    for (const order of orders) {
      const isInKitchen = order.status === 'IN_KITCHEN';
      const isCompleted = order.status === 'COMPLETED' && order.payment_status === 'PAID';
      const isCancelled = order.status === 'CANCELLED';

      // 1. KOT Printing (Dine-in / Counter / Delivery / Takeaway)
      // Print KOT automatically only when order is accepted/sent to the kitchen (status becomes IN_KITCHEN)
      if (isInKitchen && !printedKotOrderIds.has(order.id)) {
        printedKotOrderIds.add(order.id);
        console.log(`[AUTO-PRINT] Printing KOT for #${order.order_code || order.id}...`);
        try {
          const kotBytes = buildKotBytes(order);
          await sendToPrinter({ host: KITCHEN_PRINTER_HOST, port: PRINTER_PORT, payload: kotBytes });
          console.log(`[AUTO-PRINT] KOT printed for #${order.order_code}`);
        } catch (err) {
          console.error(`[AUTO-PRINT] KOT Print failed for #${order.order_code || order.id}:`, err.message);
          printedKotOrderIds.delete(order.id); // Retry on next poll
        }
      }

      // 2. Cancel KOT Printing (Kitchen Printer only)
      if (isCancelled && !printedCancelKotOrderIds.has(order.id)) {
        printedCancelKotOrderIds.add(order.id);
        console.log(`[AUTO-PRINT] Printing Cancel KOT for #${order.order_code || order.id}...`);
        try {
          const kotBytes = buildKotBytes(order);
          await sendToPrinter({ host: KITCHEN_PRINTER_HOST, port: PRINTER_PORT, payload: kotBytes });
          console.log(`[AUTO-PRINT] Cancel KOT printed for #${order.order_code}`);
        } catch (err) {
          console.error(`[AUTO-PRINT] Cancel KOT Print failed for #${order.order_code || order.id}:`, err.message);
          printedCancelKotOrderIds.delete(order.id); // Retry on next poll
        }
      }

      // 3. Bill Printing:
      // For online/delivery/takeaway: print bill when status is IN_KITCHEN (i.e. accepted).
      // For dine-in: print bill when status is COMPLETED (settled).
      const isDineIn = order.type === 'dine-in';
      const shouldPrintBill = isDineIn ? isCompleted : isInKitchen;

      if (shouldPrintBill && !printedBillOrderIds.has(order.id)) {
        printedBillOrderIds.add(order.id);
        console.log(`[AUTO-PRINT] Printing Bill for #${order.order_code || order.id}...`);
        try {
          const variant = isDineIn ? 'counter' : 'customer';
          const copyLabel = isDineIn ? 'COUNTER RECORD COPY' : 'ORIGINAL COPY';
          const billBytes = buildBillBytes(order, variant, copyLabel);
          await sendToPrinter({ host: COUNTER_PRINTER_HOST, port: PRINTER_PORT, payload: billBytes });
          console.log(`[AUTO-PRINT] Bill printed for #${order.order_code}`);
        } catch (err) {
          console.error(`[AUTO-PRINT] Bill Print failed for #${order.order_code || order.id}:`, err.message);
          printedBillOrderIds.delete(order.id); // Retry on next poll
        }
      }
    }
  } catch (error) {
    console.error('[AUTO-PRINT ERROR]', error.message);
  }
};

// Start auto-print polling
setInterval(pollForAutoPrint, AUTO_PRINT_POLL_INTERVAL_MS);
