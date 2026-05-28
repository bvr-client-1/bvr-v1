import http from 'node:http';
import net from 'node:net';

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

const buildKotBytes = (order) =>
  Buffer.concat([
    header(),
    command(ESC, 0x61, 0x01),
    command(ESC, 0x21, 0x30),
    line('KOT'),
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

const buildBillBytes = (order) => {
  const items = order.order_items || [];
  const total = Number(order.total || items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price_at_purchase ?? item.price ?? 0), 0));
  const restaurantSubtotal = Number(order.subtotal || total);
  const tax = getRestaurantTaxBreakup(restaurantSubtotal);
  const payableTotal = shouldApplyRestaurantGst(order) ? tax.grandTotal : total;

  return Buffer.concat([
    header(),
    command(ESC, 0x61, 0x01),
    command(ESC, 0x21, 0x30),
    line('COUNTER BILL'),
    command(ESC, 0x21, 0x00),
    command(ESC, 0x61, 0x00),
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
    finish(),
  ]);
};

const sendToPrinter = ({ host, port, payload }) =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port, timeout: 5000 }, () => {
      socket.write(payload, () => socket.end());
    });

    socket.on('close', resolve);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`Printer timed out: ${host}:${port}`));
    });
    socket.on('error', reject);
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

  if (req.method === 'POST' && req.url === '/print/order-copies') {
    try {
      const body = await readJsonBody(req);
      if (!body.order) {
        sendJson(res, 400, { ok: false, message: 'Missing order' });
        return;
      }

      await sendToPrinter({ host: KITCHEN_PRINTER_HOST, port: PRINTER_PORT, payload: buildKotBytes(body.order) });
      await sendToPrinter({ host: COUNTER_PRINTER_HOST, port: PRINTER_PORT, payload: buildBillBytes(body.order) });

      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { ok: false, message: error.message || 'Print failed' });
    }
    return;
  }

  sendJson(res, 404, { ok: false, message: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`BVR local print bridge running at http://127.0.0.1:${PORT}`);
  console.log(`Counter bill printer: ${COUNTER_PRINTER_HOST}:${PRINTER_PORT}`);
  console.log(`Kitchen KOT printer: ${KITCHEN_PRINTER_HOST}:${PRINTER_PORT}`);
});
