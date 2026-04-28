'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useInterval } from '../hooks/useInterval.js';
import { ownerLogin } from '../services/authService.js';
import { fetchAdminMenuItems, updateMenuAvailability, updateMenuItemPrice } from '../services/menuService.js';
import {
  addDeliveryPerson,
  assignDeliveryPartner,
  createCounterTableOrder,
  fetchAdminOrders,
  removeTableOrderItem,
  removeDeliveryPerson,
  settleTableBill,
  updateAdminOrderStatus,
} from '../services/orderService.js';
import { formatPrice, timeAgo } from '../utils/format.js';
import { printBillSlip } from '../utils/billPrint.js';
import { printKotSlip } from '../utils/kotPrint.js';
import { getDirectionsUrl, parseDeliveryAddress } from '../utils/orderLocation.js';
import { notifyNewOrder, primeAlertAudio, requestStaffNotificationPermission, startNewOrderAlertLoop, stopNewOrderAlertLoop } from '../utils/staffAlerts.js';

const statusBadgeMap = {
  NEW: { bg: '#3b82f620', color: '#3b82f6', text: 'NEW' },
  CONFIRMED: { bg: '#d4a01720', color: '#d4a017', text: 'CONFIRMED' },
  IN_KITCHEN: { bg: '#f9731620', color: '#f97316', text: 'IN KITCHEN' },
  READY: { bg: '#22c55e20', color: '#22c55e', text: 'READY' },
  SERVED: { bg: '#14b8a620', color: '#14b8a6', text: 'SERVED' },
  OUT_FOR_DELIVERY: { bg: '#8b5cf620', color: '#8b5cf6', text: 'OUT FOR DELIVERY' },
  COMPLETED: { bg: '#22c55e20', color: '#22c55e', text: 'COMPLETED' },
  CANCELLED: { bg: '#ef444420', color: '#ef4444', text: 'CANCELLED' },
};

const paymentMethods = ['CASH', 'CARD', 'UPI'];
const removalConsentOptions = [
  { value: 'WITH_CONSENT', label: 'With customer consent' },
  { value: 'WITHOUT_CONSENT', label: 'Without customer consent' },
];
const tableOptions = Array.from({ length: 16 }, (_, index) => String(index + 1));
const ownerSections = [
  { value: 'counter', label: 'Counter' },
  { value: 'active', label: 'Active Tables' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'reports', label: 'Reports' },
  { value: 'controls', label: 'Controls' },
  { value: 'menu', label: 'Menu' },
];
const buildPriceDrafts = (items) => Object.fromEntries(items.map((item) => [item.id, String(item.price ?? '')]));
const formatHistoryDate = (date) =>
  new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
const toDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const getTodayDateKey = () => toDateKey(new Date());
const getTakeawayToken = (order) => {
  const marker = String(order.delivery_address || '');
  return marker.startsWith('TAKEAWAY::') ? marker.slice('TAKEAWAY::'.length) || 'Walk-In' : '';
};
const parseSettlementMeta = (reason) => {
  const prefix = 'SETTLEMENT_META::';
  if (!String(reason || '').startsWith(prefix)) {
    return null;
  }

  try {
    return JSON.parse(String(reason).slice(prefix.length));
  } catch {
    return null;
  }
};

const getRefundNote = (order) => {
  if (order.payment_status === 'REFUNDED' || order.refund_status === 'processed') {
    return 'Refund completed to the original payment method.';
  }

  if (order.payment_status === 'REFUND_PENDING' || ['created', 'pending'].includes(order.refund_status || '')) {
    return 'Refund initiated and waiting for banking settlement.';
  }

  if (order.payment_status === 'REFUND_FAILED' || order.refund_status === 'failed') {
    return `Refund failed${order.refund_failure_reason ? `: ${order.refund_failure_reason}` : '.'}`;
  }

  return '';
};

const getAuditConsentLabel = (value) => {
  if (value === 'WITH_CONSENT') return 'With consent';
  if (value === 'WITHOUT_CONSENT') return 'Without consent';
  return 'Consent not recorded';
};

const groupTableOrders = (orders) => {
  const groups = new Map();

  for (const order of orders) {
    const takeawayToken = getTakeawayToken(order);
    const serviceMode = takeawayToken ? 'TAKEAWAY' : 'TABLE';
    const groupKey = serviceMode === 'TAKEAWAY' ? `TAKEAWAY:${takeawayToken}` : `TABLE:${String(order.table_number || 'Unknown')}`;
    const displayLabel = serviceMode === 'TAKEAWAY' ? `Takeaway ${takeawayToken}` : `Table ${order.table_number}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        serviceMode,
        displayLabel,
        takeawayToken: takeawayToken || '',
        tableNumber: serviceMode === 'TABLE' ? String(order.table_number || 'Unknown') : '',
        orders: [],
        total: 0,
        itemCount: 0,
        latestCreatedAt: order.created_at,
        customerName: order.customer_name || '',
        customerPhone: order.customer_phone || '',
      });
    }

    const group = groups.get(groupKey);
    group.orders.push(order);
    group.total += Number(order.total || 0);
    group.itemCount += (order.order_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    if (new Date(order.created_at) > new Date(group.latestCreatedAt)) {
      group.latestCreatedAt = order.created_at;
    }
    if (order.customer_name && !String(order.customer_name).startsWith('Walk-in Table')) {
      group.customerName = order.customer_name;
    }
    if (order.customer_phone && order.customer_phone !== '0000000000') {
      group.customerPhone = order.customer_phone;
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.serviceMode !== b.serviceMode) {
      return a.serviceMode === 'TABLE' ? -1 : 1;
    }

    if (a.serviceMode === 'TABLE') {
      return Number(a.tableNumber) - Number(b.tableNumber);
    }

    return String(a.takeawayToken).localeCompare(String(b.takeawayToken), undefined, { numeric: true });
  });
};

const buildAggregatedBillOrder = (group, options = {}) => {
  const { paymentMethod = 'Pending', tipAmount = 0 } = options;
  const itemMap = new Map();

  for (const order of group.orders) {
    for (const item of order.order_items || []) {
      const unitPrice = Number(item.price_at_purchase ?? item.price ?? 0);
      const key = `${item.item_name}__${unitPrice}`;
      const existing = itemMap.get(key);
      if (existing) {
        existing.quantity += Number(item.quantity || 0);
      } else {
        itemMap.set(key, {
          item_name: item.item_name,
          quantity: Number(item.quantity || 0),
          price: unitPrice,
        });
      }
    }
  }

  return {
    order_code: group.serviceMode === 'TAKEAWAY' ? `TAKEAWAY-${group.takeawayToken}` : `TABLE-${group.tableNumber}`,
    type: 'dine-in',
    table_number: group.serviceMode === 'TABLE' ? group.tableNumber : null,
    delivery_address: group.serviceMode === 'TAKEAWAY' ? `TAKEAWAY::${group.takeawayToken}` : null,
    customer_name:
      group.customerName ||
      (group.serviceMode === 'TAKEAWAY' ? `Takeaway ${group.takeawayToken}` : `Walk-in Table ${group.tableNumber}`),
    customer_phone: group.customerPhone || '',
    created_at: group.latestCreatedAt,
    total: group.total,
    payment_method: paymentMethod,
    tip_amount: Number(tipAmount || 0),
    order_items: Array.from(itemMap.values()),
  };
};

const buildDaySalesReport = (ordersForDay) => {
  const itemMap = new Map();
  let foodRevenue = 0;
  let tipTotal = 0;
  let cancelledCount = 0;

  for (const order of ordersForDay) {
    if (order.status === 'CANCELLED') {
      cancelledCount += 1;
      continue;
    }

    const settlementMeta = parseSettlementMeta(order.rejection_reason);
    tipTotal += Number(settlementMeta?.primary ? settlementMeta.tipAmount || 0 : 0);
    foodRevenue += Number(order.total || 0);

    for (const item of order.order_items || []) {
      const rate = Number(item.price_at_purchase ?? item.price ?? 0);
      const quantity = Number(item.quantity || 0);
      const key = `${item.item_name}__${rate}`;
      const entry = itemMap.get(key) || {
        name: item.item_name,
        quantity: 0,
        rate,
        amount: 0,
      };

      entry.quantity += quantity;
      entry.amount += quantity * rate;
      itemMap.set(key, entry);
    }
  }

  return {
    cancelledCount,
    foodRevenue,
    itemCount: Array.from(itemMap.values()).reduce((sum, item) => sum + item.quantity, 0),
    items: Array.from(itemMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    orderCount: ordersForDay.length,
    tipTotal,
    totalRevenue: foodRevenue + tipTotal,
  };
};

const openDaySalesPrintWindow = ({ dateLabel, report }) => {
  if (typeof window === 'undefined') {
    return false;
  }

  const rows = report.items
    .map(
      (item) => `
        <tr>
          <td>${item.name}</td>
          <td class="right">${item.quantity}</td>
          <td class="right">${formatPrice(item.rate)}</td>
          <td class="right">${formatPrice(item.amount)}</td>
        </tr>
      `,
    )
    .join('');

  const printWindow = window.open('', `Day Sale ${dateLabel}`, 'width=420,height=720');
  if (!printWindow) {
    return false;
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>Day Sale ${dateLabel}</title>
        <style>
          @page { size: 80mm auto; margin: 4mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: "Courier New", monospace; color: #000; font-weight: 700; }
          .receipt { width: 72mm; margin: 0 auto; }
          h1, h2, p { margin: 0; text-align: center; }
          h1 { font-size: 18px; letter-spacing: 1px; }
          h2 { font-size: 15px; margin-top: 6px; }
          p { font-size: 11px; line-height: 1.35; }
          .line { border-top: 1px dashed #000; margin: 8px 0; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
          th, td { padding: 3px 0; border-bottom: 1px dotted #777; vertical-align: top; }
          th { text-align: left; }
          .right { text-align: right; }
          .summary { display: grid; gap: 4px; font-size: 12px; }
          .summary div { display: flex; justify-content: space-between; gap: 10px; }
          .total { font-size: 15px; }
        </style>
      </head>
      <body>
        <div class="receipt">
          <h1>BANGARU VAKILI</h1>
          <p>FAMILY RESTAURANT</p>
          <p>SHIVAJI NAGAR, NALGONDA</p>
          <p>GSTIN: 36ELLPP6523H1ZP</p>
          <p>CELL: 7337334474 / 9701054013</p>
          <div class="line"></div>
          <h2>DAY SALE REPORT</h2>
          <p>${dateLabel}</p>
          <div class="line"></div>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th class="right">Qty</th>
                <th class="right">Rate</th>
                <th class="right">Amt</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="4">No items sold</td></tr>'}</tbody>
          </table>
          <div class="line"></div>
          <div class="summary">
            <div><span>Orders</span><strong>${report.orderCount}</strong></div>
            <div><span>Items</span><strong>${report.itemCount}</strong></div>
            <div><span>Cancelled</span><strong>${report.cancelledCount}</strong></div>
            <div><span>Food Sale</span><strong>${formatPrice(report.foodRevenue)}</strong></div>
            <div><span>Tips</span><strong>${formatPrice(report.tipTotal)}</strong></div>
            <div class="total"><span>Total</span><strong>${formatPrice(report.totalRevenue)}</strong></div>
          </div>
          <div class="line"></div>
          <p>END OF DAY COUNTER COPY</p>
        </div>
        <script>
          window.onload = () => {
            window.focus();
            window.print();
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
  return true;
};

export default function OwnerPage() {
  const { ownerToken, setOwnerToken, restaurantStatus, setKitchenPaused, setMaintenanceMode } = useAppContext();
  const { showToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [deliveryPeople, setDeliveryPeople] = useState([]);
  const [managedItems, setManagedItems] = useState([]);
  const [currentTab, setCurrentTab] = useState('counter');
  const [currentFilter, setCurrentFilter] = useState('all');
  const [menuFilter, setMenuFilter] = useState('all');
  const [menuSearchQuery, setMenuSearchQuery] = useState('');
  const [priceDrafts, setPriceDrafts] = useState({});
  const [savingMenuItemId, setSavingMenuItemId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [rejectingOrderId, setRejectingOrderId] = useState('');
  const [selectedReason, setSelectedReason] = useState('');
  const [deliveryStaffForm, setDeliveryStaffForm] = useState({ name: '', phone: '' });
  const [addingDeliveryStaff, setAddingDeliveryStaff] = useState(false);
  const [removingDeliveryStaffId, setRemovingDeliveryStaffId] = useState('');
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [serviceMode, setServiceMode] = useState('TABLE');
  const [tableNumber, setTableNumber] = useState('');
  const [takeawayToken, setTakeawayToken] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [builderCategory, setBuilderCategory] = useState('all');
  const [builderQuery, setBuilderQuery] = useState('');
  const [draftItems, setDraftItems] = useState([]);
  const [submittingTableOrder, setSubmittingTableOrder] = useState(false);
  const [billingGroupKey, setBillingGroupKey] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('CASH');
  const [selectedTipAmount, setSelectedTipAmount] = useState('0');
  const [settlingTable, setSettlingTable] = useState(false);
  const [removingTableItemKey, setRemovingTableItemKey] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [removalConsentStatus, setRemovalConsentStatus] = useState('WITH_CONSENT');
  const [removalNote, setRemovalNote] = useState('');
  const [historyDate, setHistoryDate] = useState(getTodayDateKey());
  const [selectedActiveGroupKey, setSelectedActiveGroupKey] = useState('');
  const knownOrderIdsRef = useRef(new Set());
  const orderEntryRef = useRef(null);

  const handleAuthFailure = (error) => {
    if (error?.response?.status === 401) {
      setOwnerToken('');
      showToast('Session expired. Please login again.', 'error');
      return true;
    }

    return false;
  };

  const loadOrders = async ({ silent = false } = {}) => {
    if (!ownerToken) return;
    try {
      if (!silent) {
        setLoadingOrders(true);
      }
      const data = await fetchAdminOrders(ownerToken);
      const nextOrderIds = new Set(data.orders.map((order) => order.id));
      const incomingOrders = data.orders.filter((order) => !knownOrderIdsRef.current.has(order.id) && order.type === 'delivery');
      if (knownOrderIdsRef.current.size && incomingOrders.length) {
        const latestOrder = incomingOrders[0];
        showToast(`New order received: #${latestOrder.order_code}`);
        startNewOrderAlertLoop();
        notifyNewOrder('New BVR order', `Order #${latestOrder.order_code} is waiting in the owner dashboard.`);
      }
      knownOrderIdsRef.current = nextOrderIds;
      setOrders(data.orders);
      setDeliveryPeople(data.deliveryPeople);
    } catch (error) {
      handleAuthFailure(error);
    } finally {
      setLoadingOrders(false);
    }
  };

  const loadMenu = async () => {
    if (!ownerToken) return;
    try {
      setLoadingMenu(true);
      const items = await fetchAdminMenuItems(ownerToken);
      setManagedItems(items);
      setPriceDrafts(buildPriceDrafts(items));
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast('Failed to load menu', 'error');
      }
    } finally {
      setLoadingMenu(false);
    }
  };

  useEffect(() => {
    if (ownerToken) {
      loadOrders();
      loadMenu();
    }
  }, [ownerToken]);

  useEffect(() => {
    if (!ownerToken) return;

    const unlockAlerts = () => {
      primeAlertAudio();
      requestStaffNotificationPermission();
    };

    unlockAlerts();
    window.addEventListener('pointerdown', unlockAlerts, { passive: true });
    window.addEventListener('keydown', unlockAlerts);

    return () => {
      window.removeEventListener('pointerdown', unlockAlerts);
      window.removeEventListener('keydown', unlockAlerts);
    };
  }, [ownerToken]);

  useInterval(() => {
    if (ownerToken) {
      loadOrders({ silent: true });
    }
  }, ownerToken ? 10000 : null);

  const deliveryOrders = useMemo(() => orders.filter((order) => order.type === 'delivery'), [orders]);
  const activeTableGroups = useMemo(
    () =>
      groupTableOrders(
        orders.filter(
          (order) =>
            order.type === 'dine-in' &&
            !['CANCELLED', 'COMPLETED'].includes(order.status) &&
            order.payment_status !== 'PAID',
        ),
      ),
    [orders],
  );
  const activeTableMap = useMemo(
    () => new Map(activeTableGroups.filter((group) => group.serviceMode === 'TABLE').map((group) => [String(group.tableNumber), group])),
    [activeTableGroups],
  );
  const activeTakeawayGroups = useMemo(
    () => activeTableGroups.filter((group) => group.serviceMode === 'TAKEAWAY'),
    [activeTableGroups],
  );
  const selectedActiveGroup = useMemo(
    () => activeTableGroups.find((group) => group.groupKey === selectedActiveGroupKey) || activeTableGroups[0] || null,
    [activeTableGroups, selectedActiveGroupKey],
  );

  useEffect(() => {
    if (!activeTableGroups.length) {
      if (selectedActiveGroupKey) {
        setSelectedActiveGroupKey('');
      }
      return;
    }

    if (!activeTableGroups.some((group) => group.groupKey === selectedActiveGroupKey)) {
      setSelectedActiveGroupKey(activeTableGroups[0].groupKey);
    }
  }, [activeTableGroups, selectedActiveGroupKey]);

  const historyOrders = useMemo(
    () => orders.filter((order) => toDateKey(order.created_at) === historyDate),
    [historyDate, orders],
  );
  const historyRemovalEvents = useMemo(
    () =>
      historyOrders
        .flatMap((order) =>
          (order.audit_events || []).map((event) => ({
            ...event,
            orderCode: order.order_code,
            displayLabel: getTakeawayToken(order) ? `Takeaway ${getTakeawayToken(order)}` : `Table ${order.table_number || '-'}`,
          })),
        )
        .filter((event) => event.eventType === 'ITEM_REMOVED')
        .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()),
    [historyOrders],
  );

  const filteredDeliveryOrders = useMemo(() => {
    if (currentFilter === 'all') return deliveryOrders;
    if (currentFilter === 'new') return deliveryOrders.filter((order) => order.status === 'NEW');
    if (currentFilter === 'active') return deliveryOrders.filter((order) => ['CONFIRMED', 'IN_KITCHEN'].includes(order.status));
    if (currentFilter === 'ready') return deliveryOrders.filter((order) => ['READY', 'OUT_FOR_DELIVERY'].includes(order.status));
    return deliveryOrders.filter((order) => ['COMPLETED', 'SERVED', 'CANCELLED'].includes(order.status));
  }, [currentFilter, deliveryOrders]);

  const stats = useMemo(() => {
    const today = new Date().toDateString();
    const todayOrders = orders.filter((order) => new Date(order.created_at).toDateString() === today);
    const todayTips = todayOrders.reduce((sum, order) => {
      const settlementMeta = parseSettlementMeta(order.rejection_reason);
      return sum + Number(settlementMeta?.primary ? settlementMeta.tipAmount || 0 : 0);
    }, 0);

    return {
      pending: deliveryOrders.filter((order) => order.status === 'NEW').length + activeTableGroups.length,
      active: orders.filter((order) => !['COMPLETED', 'CANCELLED'].includes(order.status)).length,
      today: todayOrders.length,
      revenue:
        todayOrders.filter((order) => order.status !== 'CANCELLED').reduce((sum, order) => sum + (order.total || 0), 0) + todayTips,
    };
  }, [activeTableGroups.length, deliveryOrders, orders]);

  const historySummary = useMemo(() => {
    const tipTotal = historyOrders.reduce((sum, order) => {
      const settlementMeta = parseSettlementMeta(order.rejection_reason);
      return sum + Number(settlementMeta?.primary ? settlementMeta.tipAmount || 0 : 0);
    }, 0);

    return {
      orderCount: historyOrders.length,
      deliveryCount: historyOrders.filter((order) => order.type === 'delivery').length,
      dineInCount: historyOrders.filter((order) => order.type === 'dine-in').length,
      cancelledCount: historyOrders.filter((order) => order.status === 'CANCELLED').length,
      revenue: historyOrders.filter((order) => order.status !== 'CANCELLED').reduce((sum, order) => sum + Number(order.total || 0), 0) + tipTotal,
      tipTotal,
    };
  }, [historyOrders]);

  const historyDateObject = useMemo(() => new Date(`${historyDate}T00:00:00`), [historyDate]);
  const historyEntries = useMemo(
    () =>
      historyOrders.map((order) => {
        const settlementMeta = parseSettlementMeta(order.rejection_reason);
        const takeawayOrder = !!getTakeawayToken(order);
        return {
          id: order.id,
          title:
            order.type === 'delivery'
              ? `Delivery #${order.order_code}`
              : takeawayOrder
                ? `Takeaway ${getTakeawayToken(order)}`
                : `Table ${order.table_number}`,
          subtitle: `${order.order_code} · ${order.status}${settlementMeta?.primary ? ` · ${settlementMeta.paymentMethod}` : ''}`,
          amount: Number(order.total || 0) + Number(settlementMeta?.primary ? settlementMeta.tipAmount || 0 : 0),
          detail:
            (order.order_items || [])
              .map((item) => `${item.item_name} ×${item.quantity}`)
              .join(', ') || 'No items',
          time: order.created_at,
          tipAmount: Number(settlementMeta?.primary ? settlementMeta.tipAmount || 0 : 0),
        };
      }),
    [historyOrders],
  );

  const menuCategories = [...new Set(managedItems.map((item) => item.menu_categories?.name).filter(Boolean))];
  const visibleMenuItems = useMemo(() => {
    const normalizedQuery = menuSearchQuery.trim().toLowerCase();
    return managedItems.filter((item) => {
      const categoryMatch = menuFilter === 'all' || item.menu_categories?.name === menuFilter;
      const searchMatch =
        !normalizedQuery ||
        item.name.toLowerCase().includes(normalizedQuery) ||
        item.menu_categories?.name?.toLowerCase().includes(normalizedQuery);
      return categoryMatch && searchMatch;
    });
  }, [managedItems, menuFilter, menuSearchQuery]);
  const builderItems = useMemo(() => {
    const availableItems = managedItems.filter((item) => item.is_available);
    return availableItems.filter((item) => {
      const categoryMatch = builderCategory === 'all' || item.menu_categories?.name === builderCategory;
      const queryMatch = !builderQuery.trim() || item.name.toLowerCase().includes(builderQuery.trim().toLowerCase());
      return categoryMatch && queryMatch;
    });
  }, [builderCategory, builderQuery, managedItems]);

  const handleLogin = async () => {
    try {
      await primeAlertAudio();
      requestStaffNotificationPermission();
      const data = await ownerLogin(email, password);
      setOwnerToken(data.token);
      setLoginError('');
      showToast('Welcome, owner!');
    } catch (error) {
      setLoginError(error.response?.data?.message || 'Invalid email or password');
    }
  };

  const handleStatusUpdate = async (orderId, status, rejectionReason = null) => {
    try {
      stopNewOrderAlertLoop();
      const result = await updateAdminOrderStatus(ownerToken, orderId, status, rejectionReason);
      if (status === 'CANCELLED' && result?.order) {
        const printOpened = printKotSlip(result.order, {
          variant: 'cancel',
          heading: 'CANCEL KOT',
          reason: rejectionReason || result.order.rejection_reason || 'Cancelled by counter',
        });
        if (printOpened) {
          showToast(`Cancel KOT opened for #${result.order.order_code}.`);
        } else {
          showToast('Order cancelled, but cancel KOT popup was blocked.', 'error');
        }
      }
      if (status === 'CANCELLED' && result?.refund?.status) {
        showToast(`Order cancelled. Refund ${result.refund.status === 'processed' ? 'completed' : 'initiated'}.`);
      } else {
        showToast('Order updated.');
      }
      setRejectingOrderId('');
      setSelectedReason('');
      await loadOrders();
      return result;
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(error.response?.data?.message || 'Update failed', 'error');
      }
      return null;
    }
  };

  const handlePrintKot = async (order) => {
    const printOpened = printKotSlip(order);
    if (!printOpened) {
      showToast('Could not open KOT print window. Please check pop-up permission.', 'error');
      return false;
    }
    showToast(`KOT print window opened for order #${order.order_code}`);
    return true;
  };

  const handlePrintBill = async (order, options = {}) => {
    const printOpened = await printBillSlip(order, options);
    if (!printOpened) {
      showToast('Could not open bill print window. Please check pop-up permission.', 'error');
      return false;
    }
    showToast(`Bill print window opened for ${order.order_code}`);
    return true;
  };

  const handleAssignDelivery = async (orderId, deliveryPersonId) => {
    if (!deliveryPersonId) {
      showToast('Please select a delivery partner', 'error');
      return;
    }

    try {
      stopNewOrderAlertLoop();
      await assignDeliveryPartner(ownerToken, orderId, deliveryPersonId);
      showToast('Delivery partner assigned.');
      await loadOrders();
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast('Assignment failed', 'error');
      }
    }
  };

  const handleDeliveryStaffChange = (event) => {
    const { name, value } = event.target;
    setDeliveryStaffForm((current) => ({
      ...current,
      [name]: name === 'phone' ? value.replace(/\D/g, '').slice(0, 10) : value,
    }));
  };

  const handleAddDeliveryStaff = async () => {
    const name = deliveryStaffForm.name.trim();
    const phone = deliveryStaffForm.phone.trim();

    if (name.length < 2) {
      showToast('Please enter the delivery person name.', 'error');
      return;
    }

    if (!/^\d{10}$/.test(phone)) {
      showToast('Please enter a valid 10-digit phone number.', 'error');
      return;
    }

    try {
      stopNewOrderAlertLoop();
      setAddingDeliveryStaff(true);
      const person = await addDeliveryPerson(ownerToken, { name, phone });
      setDeliveryPeople((current) => [person, ...current.filter((existing) => existing.id !== person.id)]);
      setDeliveryStaffForm({ name: '', phone: '' });
      showToast('Delivery person added.');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(error.response?.data?.message || 'Could not add delivery person', 'error');
      }
    } finally {
      setAddingDeliveryStaff(false);
    }
  };

  const handleRemoveDeliveryStaff = async (person) => {
    const confirmed = window.confirm(`Remove ${person.name} from active delivery staff?`);
    if (!confirmed) return;

    try {
      stopNewOrderAlertLoop();
      setRemovingDeliveryStaffId(person.id);
      await removeDeliveryPerson(ownerToken, person.id);
      setDeliveryPeople((current) => current.filter((existing) => existing.id !== person.id));
      showToast('Delivery person removed from active staff.');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(error.response?.data?.message || 'Could not remove delivery person', 'error');
      }
    } finally {
      setRemovingDeliveryStaffId('');
    }
  };

  const handleToggleMenu = async (itemId, isAvailable) => {
    try {
      stopNewOrderAlertLoop();
      await updateMenuAvailability(ownerToken, itemId, isAvailable);
      setManagedItems((previous) => previous.map((item) => (item.id === itemId ? { ...item, is_available: isAvailable } : item)));
      showToast(isAvailable ? 'Marked available.' : 'Marked unavailable.', isAvailable ? 'success' : 'info');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast('Update failed', 'error');
      }
    }
  };

  const handlePriceDraftChange = (itemId, value) => {
    if (/^\d*(\.\d{0,2})?$/.test(value)) {
      setPriceDrafts((previous) => ({
        ...previous,
        [itemId]: value,
      }));
    }
  };

  const handleSavePrice = async (item) => {
    const draftValue = String(priceDrafts[item.id] ?? '').trim();
    const nextPrice = Number(draftValue);

    if (!draftValue || Number.isNaN(nextPrice) || nextPrice < 0) {
      showToast('Enter a valid price before saving.', 'error');
      return;
    }

    if (Number(item.price) === nextPrice) {
      showToast('Price is already up to date.', 'info');
      return;
    }

    try {
      setSavingMenuItemId(item.id);
      await updateMenuItemPrice(ownerToken, item.id, nextPrice);
      setManagedItems((previous) =>
        previous.map((menuItem) => (menuItem.id === item.id ? { ...menuItem, price: nextPrice } : menuItem)),
      );
      setPriceDrafts((previous) => ({
        ...previous,
        [item.id]: String(nextPrice),
      }));
      showToast(`Updated price for ${item.name}.`, 'success');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(error.response?.data?.message || 'Could not update price', 'error');
      }
    } finally {
      setSavingMenuItemId('');
    }
  };

  const handleKitchenToggle = async () => {
    try {
      stopNewOrderAlertLoop();
      await setKitchenPaused(!restaurantStatus.kitchenPaused);
      showToast(restaurantStatus.kitchenPaused ? 'Kitchen is back on and orders are open.' : 'Kitchen paused. New orders are blocked.');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast('Could not update kitchen status', 'error');
      }
    }
  };

  const handleMaintenanceToggle = async () => {
    try {
      stopNewOrderAlertLoop();
      await setMaintenanceMode(!restaurantStatus.maintenanceMode);
      showToast(restaurantStatus.maintenanceMode ? 'Website is back online.' : 'Maintenance mode is now live for customers.');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast('Could not update maintenance mode', 'error');
      }
    }
  };

  const changeDraftItem = (menuItem, delta) => {
    setDraftItems((current) => {
      const existing = current.find((item) => item.id === menuItem.id);
      if (!existing && delta < 0) {
        return current;
      }

      if (existing) {
        return current
          .map((item) => (item.id === menuItem.id ? { ...item, quantity: item.quantity + delta } : item))
          .filter((item) => item.quantity > 0);
      }

      return [...current, { id: menuItem.id, name: menuItem.name, price: Number(menuItem.price), quantity: 1 }];
    });
  };

  const draftSubtotal = useMemo(
    () => draftItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0),
    [draftItems],
  );
  const counterTargetValue = serviceMode === 'TAKEAWAY' ? 'TAKEAWAY' : tableNumber ? `TABLE:${tableNumber}` : '';

  const handleCounterTargetChange = (value) => {
    if (value === 'TAKEAWAY') {
      setServiceMode('TAKEAWAY');
      setTableNumber('');
      setTakeawayToken('');
      return;
    }

    if (value.startsWith('TABLE:')) {
      setServiceMode('TABLE');
      setTableNumber(value.slice('TABLE:'.length));
      setTakeawayToken('');
      return;
    }

    setServiceMode('TABLE');
    setTableNumber('');
    setTakeawayToken('');
  };

  const resetDraft = () => {
    setDraftItems([]);
    setBuilderQuery('');
    setBuilderCategory('all');
  };

  const handleCreateTableKot = async () => {
    if (!counterTargetValue) {
      showToast('Select table or takeaway first.', 'error');
      return;
    }
    if (!draftItems.length) {
      showToast('Add at least one item before creating this KOT.', 'error');
      return;
    }

    const generatedTakeawayToken = takeawayToken.trim() || `Walk-In-${Date.now().toString().slice(-5)}`;

    try {
      setSubmittingTableOrder(true);
      const response = await createCounterTableOrder(ownerToken, {
        serviceMode,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        tableNumber: serviceMode === 'TABLE' ? String(tableNumber).trim() : null,
        takeawayToken: serviceMode === 'TAKEAWAY' ? generatedTakeawayToken : '',
        subtotal: draftSubtotal,
        total: draftSubtotal,
        items: draftItems,
      });

      await handlePrintKot(response.order);
      showToast(serviceMode === 'TAKEAWAY' ? 'Takeaway KOT created.' : `KOT created for Table ${tableNumber}.`);
      resetDraft();
      await loadOrders();
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(error.response?.data?.message || 'Could not create table KOT', 'error');
      }
    } finally {
      setSubmittingTableOrder(false);
    }
  };

  const startAddMoreForTable = (group) => {
    setServiceMode(group.serviceMode);
    setTableNumber(group.serviceMode === 'TABLE' ? group.tableNumber : '');
    setTakeawayToken(group.serviceMode === 'TAKEAWAY' ? group.takeawayToken : '');
    setCustomerName(group.customerName || '');
    setCustomerPhone(group.customerPhone || '');
    resetDraft();
    orderEntryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`Ready to add more items for ${group.displayLabel}.`, 'info');
  };

  const openBillingForTable = (group) => {
    setBillingGroupKey(group.groupKey);
    setSelectedPaymentMethod('CASH');
    setSelectedTipAmount('0');
  };

  const selectedBillingGroup = useMemo(
    () => activeTableGroups.find((group) => group.groupKey === billingGroupKey) || null,
    [activeTableGroups, billingGroupKey],
  );

  const handleSettleCurrentTable = async () => {
    if (!selectedBillingGroup) return;

    try {
      setSettlingTable(true);
      await settleTableBill(ownerToken, {
        serviceMode: selectedBillingGroup.serviceMode,
        tableNumber: selectedBillingGroup.serviceMode === 'TABLE' ? Number(selectedBillingGroup.tableNumber) : null,
        takeawayToken: selectedBillingGroup.serviceMode === 'TAKEAWAY' ? selectedBillingGroup.takeawayToken : '',
        paymentMethod: selectedPaymentMethod,
        tipAmount: Number(selectedTipAmount || 0),
      });
      showToast(`${selectedBillingGroup.displayLabel} closed as ${selectedPaymentMethod}.`);
      setBillingGroupKey('');
      await loadOrders();
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(error.response?.data?.message || 'Could not close table', 'error');
      }
    } finally {
      setSettlingTable(false);
    }
  };

  const handleRemoveTableItem = async (orderId, orderItemId) => {
    try {
      setRemovingTableItemKey(`${orderId}:${orderItemId}`);
      const response = await removeTableOrderItem(ownerToken, orderId, {
        orderItemId,
        quantityToRemove: 1,
        consentStatus: removalConsentStatus,
        note: removalNote.trim(),
      });
      if (response?.order?.status === 'CANCELLED') {
        const fallbackCancelledOrder =
          pendingRemoval && (!response.order.order_items || !response.order.order_items.length)
            ? {
                ...response.order,
                order_items: [{ item_name: pendingRemoval.itemName, quantity: 1 }],
              }
            : response.order;
        const printOpened = printKotSlip(fallbackCancelledOrder, {
          variant: 'cancel',
          heading: 'CANCEL KOT',
          reason: response.order.rejection_reason || 'All items removed from the order',
        });
        if (printOpened) {
          showToast('Item removed and cancel KOT opened for kitchen.', 'success');
        } else {
          showToast('Item removed and order cancelled, but cancel KOT popup was blocked.', 'error');
        }
      } else {
        showToast('Item updated in the active bill.', 'success');
      }
      setPendingRemoval(null);
      setRemovalConsentStatus('WITH_CONSENT');
      setRemovalNote('');
      await loadOrders({ silent: true });
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(error.response?.data?.message || 'Could not remove item', 'error');
      }
    } finally {
      setRemovingTableItemKey('');
    }
  };

  const openRemoveItemPrompt = (order, item, displayLabel) => {
    setPendingRemoval({
      orderId: order.id,
      orderItemId: item.id,
      orderCode: order.order_code,
      itemName: item.item_name,
      displayLabel,
    });
    setRemovalConsentStatus('WITH_CONSENT');
    setRemovalNote('');
  };

  const handlePrintDemoBill = async (group) => {
    const printOpened = await handlePrintBill(
      buildAggregatedBillOrder(group, { paymentMethod: 'Pending' }),
      {
        variant: 'demo',
        copyLabel: 'DEMO CHECK COPY',
      },
    );
    return printOpened;
  };

  const handlePrintDaySales = () => {
    const report = buildDaySalesReport(historyOrders);
    const opened = openDaySalesPrintWindow({
      dateLabel: formatHistoryDate(historyDateObject),
      report,
    });

    if (!opened) {
      showToast('Could not open day sale print window. Please check pop-up permission.', 'error');
      return;
    }

    showToast('Day sale report opened for printing.');
  };

  const shiftHistoryDate = (days) => {
    const nextDate = new Date(historyDateObject);
    nextDate.setDate(nextDate.getDate() + days);
    setHistoryDate(toDateKey(nextDate));
  };

  if (!ownerToken) {
    return (
      <div className="login-overlay auth-screen">
        <div className="login-box">
          <h2>Owner Login</h2>
          <div className="stacked-fields">
            <input className="input-field" onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" value={email} />
            <div className="password-input-wrap">
              <input className="input-field password-input" onChange={(event) => setPassword(event.target.value)} placeholder="Password" type={showPassword ? 'text' : 'password'} value={password} />
              <button className="password-toggle-btn" onClick={() => setShowPassword((value) => !value)} type="button">
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <button className="btn-gold" onClick={handleLogin} type="button">
              Login
            </button>
            {!!loginError && <p className="form-error">{loginError}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <nav className="navbar">
        <div className="nav-inner">
          <h1 className="page-title">Owner Dashboard</h1>
          <button
            className="logout-link button-reset"
            onClick={() => {
              stopNewOrderAlertLoop();
              setOwnerToken('');
            }}
            type="button"
          >
            Logout
          </button>
        </div>
      </nav>

      <main className="dashboard-main">
        <div className="owner-tabs owner-section-tabs">
          {ownerSections.map((section) => (
            <button
              className={`owner-tab ${currentTab === section.value ? 'active' : ''}`}
              key={section.value}
              onClick={() => setCurrentTab(section.value)}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </div>

        {currentTab === 'controls' && (
          <>
        <div className="status-control-card">
          <div>
            <div className="status-control-label">Kitchen Control</div>
            <div className={`status-chip ${restaurantStatus.kitchenPaused ? 'paused' : 'live'}`}>
              {restaurantStatus.kitchenPaused ? 'Paused manually' : 'Accepting orders'}
            </div>
            <p className="muted-small">
              {restaurantStatus.kitchenPaused
                ? 'Checkout is blocked until the kitchen is turned back on.'
                : 'Ordering is live and synchronized with the kitchen dashboard.'}
            </p>
          </div>
          <button className={`status-toggle-btn ${restaurantStatus.kitchenPaused ? 'resume' : 'pause'}`} onClick={handleKitchenToggle} type="button">
            {restaurantStatus.kitchenPaused ? 'Turn Kitchen On' : 'Pause Kitchen'}
          </button>
        </div>

        <div className="status-control-card">
          <div>
            <div className="status-control-label">Website Maintenance</div>
            <div className={`status-chip ${restaurantStatus.maintenanceMode ? 'paused' : 'live'}`}>
              {restaurantStatus.maintenanceMode ? 'Maintenance is live' : 'Website is public'}
            </div>
            <p className="muted-small">
              {restaurantStatus.maintenanceMode
                ? 'Customers see a maintenance screen until you turn the website back on.'
                : 'Turn this on when you want to temporarily hide the public website and stop customer access.'}
            </p>
          </div>
          <button className={`status-toggle-btn ${restaurantStatus.maintenanceMode ? 'resume' : 'pause'}`} onClick={handleMaintenanceToggle} type="button">
            {restaurantStatus.maintenanceMode ? 'Turn Website On' : 'Enable Maintenance'}
          </button>
        </div>

        <div className="status-control-card staff-control-card">
          <div className="staff-control-copy">
            <div className="status-control-label">Delivery Staff</div>
            <p className="muted-small">Add a new delivery person here. Their name and phone will show to the customer after assignment.</p>
            <div className="staff-list-row">
              {deliveryPeople.length ? (
                deliveryPeople.map((person) => (
                  <span className="staff-person-chip" key={person.id}>
                    <span>{person.name} · {person.phone}</span>
                    <button
                      className="staff-remove-btn"
                      disabled={removingDeliveryStaffId === person.id}
                      onClick={() => handleRemoveDeliveryStaff(person)}
                      type="button"
                    >
                      {removingDeliveryStaffId === person.id ? 'Removing...' : 'Remove'}
                    </button>
                  </span>
                ))
              ) : (
                <span className="muted-small">No active delivery staff added yet.</span>
              )}
            </div>
          </div>
          <div className="staff-form-card">
            <input
              className="input-field"
              name="name"
              onChange={handleDeliveryStaffChange}
              placeholder="Delivery person name"
              type="text"
              value={deliveryStaffForm.name}
            />
            <input
              className="input-field"
              inputMode="numeric"
              maxLength={10}
              name="phone"
              onChange={handleDeliveryStaffChange}
              placeholder="10-digit phone number"
              type="tel"
              value={deliveryStaffForm.phone}
            />
            <button className="status-toggle-btn resume" disabled={addingDeliveryStaff} onClick={handleAddDeliveryStaff} type="button">
              {addingDeliveryStaff ? 'Adding...' : 'Add Delivery Person'}
            </button>
          </div>
        </div>
          </>
        )}

        {currentTab !== 'menu' ? (
          <>
            {currentTab === 'reports' && (
              <>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-num">{stats.pending}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-card">
                <div className="stat-num">{stats.active}</div>
                <div className="stat-label">Active</div>
              </div>
              <div className="stat-card">
                <div className="stat-num">{stats.today}</div>
                <div className="stat-label">Today</div>
              </div>
            </div>

            <div className="card revenue-card">
              <div className="stat-label">Today's Revenue</div>
              <div className="revenue-total">{formatPrice(stats.revenue)}</div>
            </div>
              </>
            )}

            {currentTab === 'counter' && (
            <div className="card" ref={orderEntryRef}>
              <div className="status-control-label" style={{ marginBottom: 12 }}>Counter Table Order Entry</div>
              <p className="muted-small" style={{ marginBottom: 16 }}>
                Select a table or takeaway, add items, then create a KOT. Customers do not pay while ordering in restaurant.
              </p>
              <div className="staff-form-card" style={{ alignItems: 'stretch' }}>
                <select className="input-field" onChange={(event) => handleCounterTargetChange(event.target.value)} value={counterTargetValue}>
                  <option value="">Select table / takeaway</option>
                  {tableOptions.map((option) => (
                    <option key={option} value={`TABLE:${option}`}>
                      Table {option}
                    </option>
                  ))}
                  <option value="TAKEAWAY">Takeaway</option>
                </select>
                <input className="input-field" onChange={(event) => setCustomerName(event.target.value)} placeholder="Customer name (optional)" type="text" value={customerName} />
                <input className="input-field" inputMode="numeric" maxLength={10} onChange={(event) => setCustomerPhone(event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="Customer phone (optional)" type="tel" value={customerPhone} />
              </div>

              <div className="filter-wrap" style={{ marginTop: 16 }}>
                <button className={`filter-btn ${builderCategory === 'all' ? 'active' : ''}`} onClick={() => setBuilderCategory('all')} type="button">
                  All Items
                </button>
                {menuCategories.map((category) => (
                  <button className={`filter-btn ${builderCategory === category ? 'active' : ''}`} key={category} onClick={() => setBuilderCategory(category)} type="button">
                    {category}
                  </button>
                ))}
              </div>

              <input className="input-field" onChange={(event) => setBuilderQuery(event.target.value)} placeholder="Search item name" style={{ marginTop: 12 }} type="text" value={builderQuery} />

              <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
                {builderItems.slice(0, 18).map((item) => {
                  const qty = draftItems.find((draftItem) => draftItem.id === item.id)?.quantity || 0;
                  return (
                    <div className="menu-item-row" key={item.id}>
                      <div className="menu-item-thumb">{item.image_url ? <img alt={item.name} src={item.image_url} /> : '🍽️'}</div>
                      <div className="menu-item-body">
                        <div className="menu-item-name">{item.name}</div>
                        <div className="muted-small">{item.menu_categories?.name || 'Other'}</div>
                      </div>
                      <div className="menu-item-side">
                        <span className="gold-text strong">{formatPrice(item.price)}</span>
                        <div className="qty-wrap">
                          <button className="qty-btn small" onClick={() => changeDraftItem(item, -1)} type="button">
                            -
                          </button>
                          <span className="qty-num">{qty}</span>
                          <button className="qty-btn small" onClick={() => changeDraftItem(item, 1)} type="button">
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="summary-row top-border" style={{ marginTop: 16 }}>
                <span>Draft Total</span>
                <span className="gold-text strong">{formatPrice(draftSubtotal)}</span>
              </div>

              <div className="action-row">
                <button className="act-btn act-secondary" onClick={resetDraft} type="button">
                  Clear Draft
                </button>
                <button className="act-btn act-confirm" disabled={submittingTableOrder} onClick={handleCreateTableKot} type="button">
                  {submittingTableOrder ? 'Creating KOT...' : serviceMode === 'TAKEAWAY' ? 'Create Takeaway KOT' : 'Create KOT For Table'}
                </button>
              </div>
            </div>
            )}

            {currentTab === 'active' && (
            <div className="card">
              <div className="status-control-label" style={{ marginBottom: 12 }}>Active Table / Takeaway Orders</div>
              {!activeTableGroups.length && <div className="muted-small">No active in-restaurant tables or takeaways right now.</div>}
              {!!activeTableGroups.length && (
                <>
                  <div className="table-board-grid">
                    {tableOptions.map((option) => {
                      const group = activeTableMap.get(option);
                      const selected = !!group && selectedActiveGroup?.groupKey === group.groupKey;
                      return (
                        <button
                          className={`table-board-card ${group ? 'occupied' : 'free'} ${selected ? 'active' : ''}`}
                          disabled={!group}
                          key={option}
                          onClick={() => group && setSelectedActiveGroupKey(group.groupKey)}
                          type="button"
                        >
                          <span>Table {option}</span>
                          <strong>{group ? formatPrice(group.total) : 'Free'}</strong>
                          {group ? <small>{group.orders.length} KOTs · {group.itemCount} items</small> : <small>Ready</small>}
                        </button>
                      );
                    })}
                  </div>
                  {!!activeTakeawayGroups.length && (
                    <div className="takeaway-board-row">
                      {activeTakeawayGroups.map((group) => (
                        <button
                          className={`table-board-card occupied takeaway ${selectedActiveGroup?.groupKey === group.groupKey ? 'active' : ''}`}
                          key={group.groupKey}
                          onClick={() => setSelectedActiveGroupKey(group.groupKey)}
                          type="button"
                        >
                          <span>{group.displayLabel}</span>
                          <strong>{formatPrice(group.total)}</strong>
                          <small>{group.orders.length} KOTs · {group.itemCount} items</small>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {[selectedActiveGroup].filter(Boolean).map((group) => (
                <div className="card" key={group.groupKey} style={{ marginBottom: 16 }}>
                  <div className="order-card-head">
                    <div>
                      <h3 className="order-card-title">{group.displayLabel}</h3>
                      <div className="muted-small">{timeAgo(group.latestCreatedAt)} · {group.orders.length} KOTs · {group.itemCount} items</div>
                      <div className="muted-small">{group.customerName || `Walk-in Table ${group.tableNumber}`}{group.customerPhone ? ` · ${group.customerPhone}` : ''}</div>
                    </div>
                    <div className="order-card-price">
                      <span className="badge" style={{ background: '#d4a01720', color: '#d4a017' }}>PENDING BILL</span>
                      <div className="gold-text strong">{formatPrice(group.total)}</div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 10 }}>
                    {group.orders.map((order) => (
                      <div key={order.id} style={{ border: '1px solid rgba(212,160,23,0.18)', borderRadius: 14, padding: 14 }}>
                        <div className="order-card-head">
                          <div>
                            <div className="gold-text strong">#{order.order_code}</div>
                            <div className="muted-small">{timeAgo(order.created_at)}</div>
                          </div>
                          <span className="badge" style={{ background: statusBadgeMap[order.status]?.bg, color: statusBadgeMap[order.status]?.color }}>
                            {statusBadgeMap[order.status]?.text || order.status}
                          </span>
                        </div>
                        <div className="table-item-list">
                          {(order.order_items || []).map((item) => (
                            <div className="table-item-row" key={item.id || `${item.item_name}${item.quantity}`}>
                              <span>{item.item_name} ×{item.quantity}</span>
                              <div className="table-item-actions">
                                <span className="gold-text strong">{formatPrice(Number(item.price_at_purchase ?? item.price ?? 0) * Number(item.quantity || 0))}</span>
                                <button
                                  className="table-item-remove-btn"
                                  disabled={removingTableItemKey === `${order.id}:${item.id}`}
                                  onClick={() => openRemoveItemPrompt(order, item, selectedActiveGroup.displayLabel)}
                                  type="button"
                                >
                                  {removingTableItemKey === `${order.id}:${item.id}` ? 'Updating...' : 'Remove 1'}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="action-row">
                          {order.status === 'IN_KITCHEN' && (
                            <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'READY')} type="button">
                              Mark Ready
                            </button>
                          )}
                          {order.status === 'READY' && (
                            <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'SERVED')} type="button">
                              Mark Served
                            </button>
                          )}
                          {['IN_KITCHEN', 'READY', 'SERVED', 'CONFIRMED'].includes(order.status) && (
                            <button className="act-btn act-secondary" onClick={() => handlePrintKot(order)} type="button">
                              {order.status === 'SERVED' ? 'Reprint KOT' : 'Print KOT'}
                            </button>
                          )}
                          {order.status !== 'SERVED' && order.status !== 'COMPLETED' && (
                            <button className="act-btn act-danger" onClick={() => setRejectingOrderId(order.id)} type="button">
                              Cancel KOT
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="action-row" style={{ marginTop: 16 }}>
                    <button className="act-btn act-secondary" onClick={() => startAddMoreForTable(group)} type="button">
                      Add More Items
                    </button>
                    <button className="act-btn act-secondary" onClick={() => handlePrintDemoBill(group)} type="button">
                      Print Demo Bill
                    </button>
                    <button className="act-btn act-secondary" onClick={() => handlePrintBill(buildAggregatedBillOrder(group, { paymentMethod: 'Pending' }), { variant: 'customer', copyLabel: 'FINAL CUSTOMER BILL' })} type="button">
                      Print Final Bill
                    </button>
                    <button className="act-btn act-confirm" onClick={() => openBillingForTable(group)} type="button">
                      Close Table / Take Payment
                    </button>
                  </div>
                </div>
              ))}
            </div>
            )}

            {currentTab === 'reports' && (
            <div className="card history-shell">
              <div className="history-header">
                <h3 className="order-card-title">Previous Orders & Revenue</h3>
                <div className="history-action-group">
                  <button className="history-today-btn" onClick={() => setHistoryDate(getTodayDateKey())} type="button">
                    Today
                  </button>
                  <button className="history-today-btn" onClick={handlePrintDaySales} type="button">
                    Print Day Sale
                  </button>
                </div>
              </div>
              <div className="history-nav">
                <button className="history-nav-btn" onClick={() => shiftHistoryDate(-1)} type="button">
                  ‹
                </button>
                <div className="history-date-label">{formatHistoryDate(historyDateObject)}</div>
                <button className="history-nav-btn" onClick={() => shiftHistoryDate(1)} type="button">
                  ›
                </button>
              </div>
              <div className="history-stats-grid">
                <div className="stat-card">
                  <div className="stat-num">{historySummary.orderCount}</div>
                  <div className="stat-label">Orders</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num">{historySummary.deliveryCount}</div>
                  <div className="stat-label">Delivery</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num">{historySummary.dineInCount}</div>
                  <div className="stat-label">In-house</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num">{historySummary.cancelledCount}</div>
                  <div className="stat-label">Cancelled</div>
                </div>
              </div>
              <div className="history-revenue-row">
                <div>
                  <div className="stat-label">Revenue</div>
                  <div className="revenue-total">{formatPrice(historySummary.revenue)}</div>
                </div>
                <div>
                  <div className="stat-label">Tips</div>
                  <div className="gold-text strong">{formatPrice(historySummary.tipTotal)}</div>
                </div>
              </div>
              {!historyEntries.length && <div className="muted-small">No orders found for this day.</div>}
              <div className="history-entry-list">
                {historyEntries.map((entry) => (
                  <div className="history-entry-card" key={entry.id}>
                    <div className="order-card-head">
                      <div>
                        <div className="gold-text strong">{entry.title}</div>
                        <div className="muted-small">{entry.subtitle}</div>
                      </div>
                      <div className="order-card-price">
                        <div className="gold-text strong">{formatPrice(entry.amount)}</div>
                        <div className="muted-small">{timeAgo(entry.time)}</div>
                      </div>
                    </div>
                    <div className="order-items-copy">{entry.detail}</div>
                    {!!entry.tipAmount && <div className="reason-note">Tip recorded: {formatPrice(entry.tipAmount)}</div>}
                  </div>
                ))}
              </div>
              <div className="card" style={{ marginTop: 18 }}>
                <div className="status-control-label" style={{ marginBottom: 10 }}>Removed Items Review</div>
                {!historyRemovalEvents.length ? (
                  <div className="muted-small">No items were removed on this day.</div>
                ) : (
                  <div className="history-entry-list">
                    {historyRemovalEvents.map((event) => (
                      <div className="history-entry-card" key={event.id}>
                        <div className="order-card-head">
                          <div>
                            <div className="gold-text strong">
                              #{event.orderCode} · {event.itemName || 'Removed item'}
                            </div>
                            <div className="muted-small">
                              {event.displayLabel} · {getAuditConsentLabel(event.consentStatus)}
                            </div>
                          </div>
                          <div className="order-card-price">
                            <div className="gold-text strong">x{event.quantityRemoved || 1}</div>
                            <div className="muted-small">{timeAgo(event.createdAt)}</div>
                          </div>
                        </div>
                        <div className="order-items-copy">
                          Removed value: {formatPrice(Number(event.lineTotal || 0))}
                        </div>
                        <div className="muted-small">
                          By {event.actorRole || 'owner'}
                          {event.note ? ` · Note: ${event.note}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            )}

            {currentTab === 'delivery' && (
              <>
            <div className="filter-wrap">
              {['all', 'new', 'active', 'ready', 'completed'].map((filter) => (
                <button className={`filter-btn ${currentFilter === filter ? 'active' : ''}`} key={filter} onClick={() => setCurrentFilter(filter)} type="button">
                  {filter}
                </button>
              ))}
            </div>

            <div className="card">
              <div className="status-control-label" style={{ marginBottom: 12 }}>Outside Restaurant Orders</div>
              {loadingOrders && !deliveryOrders.length
                ? Array.from({ length: 3 }).map((_, index) => (
                    <div className="card dashboard-order-card skeleton-panel" key={`owner-order-skeleton-${index}`}>
                      <div className="skeleton-line wide" />
                      <div className="skeleton-line mid" />
                      <div className="skeleton-line wide" />
                      <div className="skeleton-line buttonish" />
                    </div>
                  ))
                : null}

              {filteredDeliveryOrders.map((order) => {
                const deliveryMeta = parseDeliveryAddress(order.delivery_address || '');
                const directionsUrl = getDirectionsUrl(deliveryMeta);

                return (
                  <div className="card" key={order.id} style={{ marginBottom: 16 }}>
                    <div className="order-card-head">
                      <div>
                        <h3 className="order-card-title">#{order.order_code}</h3>
                        <div className="muted-small">{timeAgo(order.created_at)}</div>
                        <span className="tiny-badge">DELIVERY</span>
                      </div>
                      <div className="order-card-price">
                        <span className="badge" style={{ background: statusBadgeMap[order.status]?.bg, color: statusBadgeMap[order.status]?.color }}>
                          {statusBadgeMap[order.status]?.text || order.status}
                        </span>
                        <div className="gold-text strong">{formatPrice(order.total)}</div>
                      </div>
                    </div>

                    <div className="muted-small">Customer: {order.customer_name} · {order.customer_phone}</div>
                    <div className="order-items-copy">{(order.order_items || []).map((item) => `${item.item_name} ×${item.quantity}`).join(', ')}</div>
                    {!!deliveryMeta.address && (
                      <div className="delivery-info-block">
                        <div className="muted-small">Address: {deliveryMeta.address}</div>
                        {!!directionsUrl && (
                          <a className="order-map-link" href={directionsUrl} rel="noreferrer" target="_blank">
                            Open in Maps
                          </a>
                        )}
                      </div>
                    )}
                    {order.status === 'OUT_FOR_DELIVERY' && order.delivery_people && (
                      <div className="muted-small">
                        Rider: {order.delivery_people.name} · {order.delivery_people.phone}
                      </div>
                    )}
                    {!!getRefundNote(order) && <div className="reason-note">{getRefundNote(order)}</div>}
                    {!!order.rejection_reason && <div className="reason-note">Reason: {order.rejection_reason}</div>}

                    {['NEW', 'CONFIRMED'].includes(order.status) && (
                      <div className="action-row">
                        <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'IN_KITCHEN')} type="button">
                          Accept & Send to Kitchen
                        </button>
                        <button className="act-btn act-secondary" onClick={() => handlePrintKot({ ...order, status: 'IN_KITCHEN' })} type="button">
                          Print KOT
                        </button>
                        <button className="act-btn act-secondary" onClick={() => handlePrintBill(order)} type="button">
                          Print Bill
                        </button>
                        <button className="act-btn act-danger" onClick={() => setRejectingOrderId(order.id)} type="button">
                          Cancel Order
                        </button>
                      </div>
                    )}
                    {order.status === 'IN_KITCHEN' && (
                      <div className="action-row">
                        <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'READY')} type="button">
                          Mark Ready
                        </button>
                        <button className="act-btn act-secondary" onClick={() => handlePrintKot(order)} type="button">
                          Reprint KOT
                        </button>
                        <button className="act-btn act-danger" onClick={() => setRejectingOrderId(order.id)} type="button">
                          Cancel Order
                        </button>
                      </div>
                    )}
                    {order.status === 'READY' && (
                      <div className="action-row">
                        <select className="input-field" defaultValue="" id={`delivery-person-${order.id}`}>
                          <option value="">Select Rider</option>
                          {deliveryPeople.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name}
                            </option>
                          ))}
                        </select>
                        <button className="act-btn act-confirm" onClick={() => handleAssignDelivery(order.id, document.getElementById(`delivery-person-${order.id}`)?.value)} type="button">
                          Assign
                        </button>
                      </div>
                    )}
                    {order.status === 'OUT_FOR_DELIVERY' && (
                      <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'COMPLETED')} type="button">
                        Mark Delivered
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="availability-bar">
              <span>
                Available: <strong>{managedItems.filter((item) => item.is_available).length}</strong>
              </span>
              <span>
                Unavailable: <strong>{managedItems.filter((item) => !item.is_available).length}</strong>
              </span>
              <span>
                Showing: <strong>{visibleMenuItems.length}</strong>
              </span>
            </div>

            <div className="menu-admin-tools">
              <div className="menu-admin-search">
                <input
                  className="input-field"
                  onChange={(event) => setMenuSearchQuery(event.target.value)}
                  placeholder="Search menu item or category"
                  type="text"
                  value={menuSearchQuery}
                />
              </div>
            </div>

            <div className="filter-wrap">
              <button className={`filter-btn ${menuFilter === 'all' ? 'active' : ''}`} onClick={() => setMenuFilter('all')} type="button">
                All ({managedItems.length})
              </button>
              {menuCategories.map((category) => (
                <button className={`filter-btn ${menuFilter === category ? 'active' : ''}`} key={category} onClick={() => setMenuFilter(category)} type="button">
                  {category} ({managedItems.filter((item) => item.menu_categories?.name === category).length})
                </button>
              ))}
            </div>

            <div className="card">
              {loadingMenu && !managedItems.length ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <div className="menu-item-row" key={`menu-skeleton-${index}`}>
                    <div className="menu-item-thumb skeleton-img" />
                    <div className="menu-item-body">
                      <div className="skeleton-line wide" />
                      <div className="skeleton-line mid" />
                    </div>
                  </div>
                ))
              ) : visibleMenuItems.length ? (
                visibleMenuItems.map((item) => (
                  <div className="menu-item-row" key={item.id}>
                    <div className="menu-item-thumb">{item.image_url ? <img alt={item.name} src={item.image_url} /> : '🍽️'}</div>
                    <div className="menu-item-body">
                      <div className="menu-item-name">{item.name}</div>
                      <div className="muted-small">{item.menu_categories?.name || 'Other'}</div>
                      <div className={item.is_available ? 'available-text' : 'unavailable-text'}>● {item.is_available ? 'Available' : 'Unavailable'}</div>
                    </div>
                    <div className="menu-item-side menu-item-side-admin">
                      <div className="menu-price-editor">
                        <label className="menu-price-label" htmlFor={`menu-price-${item.id}`}>
                          Price
                        </label>
                        <div className="menu-price-input-row">
                          <span className="menu-price-currency">₹</span>
                          <input
                            className="menu-price-input"
                            id={`menu-price-${item.id}`}
                            onChange={(event) => handlePriceDraftChange(item.id, event.target.value)}
                            type="text"
                            value={priceDrafts[item.id] ?? ''}
                          />
                        </div>
                        <button
                          className="menu-price-save-btn"
                          disabled={savingMenuItemId === item.id}
                          onClick={() => handleSavePrice(item)}
                          type="button"
                        >
                          {savingMenuItemId === item.id ? 'Saving...' : 'Save Price'}
                        </button>
                      </div>
                      <label className="toggle-switch">
                        <input checked={item.is_available} onChange={(event) => handleToggleMenu(item.id, event.target.checked)} type="checkbox" />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                  </div>
                ))
              ) : (
                <div className="muted-small">No menu items match this category or search.</div>
              )}
            </div>
          </>
        )}
      </main>

      {!!pendingRemoval && (
        <div className="reject-overlay open">
          <div className="reject-box">
            <h3>Remove this item?</h3>
            <p className="muted-small">
              This will be saved for owner review with consent status and note.
            </p>
            <div className="reason-note">
              #{pendingRemoval.orderCode} · {pendingRemoval.displayLabel}
            </div>
            <div className="gold-text strong" style={{ marginBottom: 10 }}>
              {pendingRemoval.itemName}
            </div>
            {removalConsentOptions.map((option) => (
              <button
                className={`reason-option ${removalConsentStatus === option.value ? 'selected' : ''}`}
                key={option.value}
                onClick={() => setRemovalConsentStatus(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
            <div className="stacked-fields" style={{ marginTop: 12 }}>
              <input
                className="input-field"
                maxLength={240}
                onChange={(event) => setRemovalNote(event.target.value)}
                placeholder="Optional note (kitchen said unavailable, customer changed mind, etc.)"
                type="text"
                value={removalNote}
              />
            </div>
            <div className="reject-actions">
              <button
                className="reject-cancel-btn"
                onClick={() => {
                  setPendingRemoval(null);
                  setRemovalConsentStatus('WITH_CONSENT');
                  setRemovalNote('');
                }}
                type="button"
              >
                Back
              </button>
              <button
                className="reject-confirm-btn"
                disabled={removingTableItemKey === `${pendingRemoval.orderId}:${pendingRemoval.orderItemId}`}
                onClick={() => handleRemoveTableItem(pendingRemoval.orderId, pendingRemoval.orderItemId)}
                type="button"
              >
                {removingTableItemKey === `${pendingRemoval.orderId}:${pendingRemoval.orderItemId}` ? 'Removing...' : 'Confirm Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!!rejectingOrderId && (
        <div className="reject-overlay open">
          <div className="reject-box">
            <h3>Cancel this order?</h3>
            <p className="muted-small">If the customer has already paid online, a refund will be initiated automatically.</p>
            {['Restaurant issue', 'Item unavailable', 'Delivery not available now', 'Kitchen overloaded'].map((reason) => (
              <button className={`reason-option ${selectedReason === reason ? 'selected' : ''}`} key={reason} onClick={() => setSelectedReason(reason)} type="button">
                {reason}
              </button>
            ))}
            <div className="reject-actions">
              <button className="reject-cancel-btn" onClick={() => setRejectingOrderId('')} type="button">
                Cancel
              </button>
              <button className="reject-confirm-btn" disabled={!selectedReason} onClick={() => handleStatusUpdate(rejectingOrderId, 'CANCELLED', selectedReason)} type="button">
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}

      {!!selectedBillingGroup && (
        <div className="reject-overlay open">
          <div className="reject-box">
            <h3>Close {selectedBillingGroup.displayLabel}</h3>
            <p className="muted-small">
              Review items, add tip if needed, print the customer bill or the counter copy, then close this order.
            </p>
            {paymentMethods.map((method) => (
              <button className={`reason-option ${selectedPaymentMethod === method ? 'selected' : ''}`} key={method} onClick={() => setSelectedPaymentMethod(method)} type="button">
                {method}
              </button>
            ))}
            <div className="reason-note">Bill Total: {formatPrice(selectedBillingGroup.total)}</div>
            <div className="billing-review-list">
              {selectedBillingGroup.orders.map((order) => (
                <div className="billing-review-order" key={order.id}>
                  <div className="gold-text strong">#{order.order_code}</div>
                  {(order.order_items || []).map((item) => (
                    <div className="table-item-row" key={item.id || `${order.id}-${item.item_name}`}>
                      <span>{item.item_name} ×{item.quantity}</span>
                      <div className="table-item-actions">
                        <span>{formatPrice(Number(item.price_at_purchase ?? item.price ?? 0) * Number(item.quantity || 0))}</span>
                        <button
                          className="table-item-remove-btn"
                          disabled={removingTableItemKey === `${order.id}:${item.id}`}
                          onClick={() => openRemoveItemPrompt(order, item, selectedBillingGroup.displayLabel)}
                          type="button"
                        >
                          {removingTableItemKey === `${order.id}:${item.id}` ? 'Updating...' : 'Remove 1'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="stacked-fields" style={{ marginTop: 12 }}>
              <input
                className="input-field"
                inputMode="decimal"
                onChange={(event) => setSelectedTipAmount(event.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="Tip amount for waiter (optional)"
                type="text"
                value={selectedTipAmount}
              />
            </div>
            <div className="billing-amount-grid">
              <div className="billing-amount-line">
                <span>Bill Total</span>
                <strong>{formatPrice(selectedBillingGroup.total)}</strong>
              </div>
              <div className="billing-amount-line">
                <span>Tip</span>
                <strong>{formatPrice(Number(selectedTipAmount || 0))}</strong>
              </div>
              <div className="billing-amount-line total">
                <span>Counter Total</span>
                <strong>{formatPrice(Number(selectedBillingGroup.total) + Number(selectedTipAmount || 0))}</strong>
              </div>
            </div>
            <div className="reject-actions" style={{ flexWrap: 'wrap' }}>
              <button className="reject-cancel-btn" onClick={() => setBillingGroupKey('')} type="button">
                Cancel
              </button>
              <button
                className="act-btn act-secondary"
                onClick={() =>
                  handlePrintBill(buildAggregatedBillOrder(selectedBillingGroup, { paymentMethod: 'Pending' }), {
                    variant: 'customer',
                    copyLabel: 'FINAL CUSTOMER BILL',
                  })
                }
                type="button"
              >
                Print Final Bill
              </button>
              <button
                className="act-btn act-secondary"
                onClick={() =>
                  handlePrintBill(
                    buildAggregatedBillOrder(selectedBillingGroup, {
                      paymentMethod: selectedPaymentMethod,
                      tipAmount: Number(selectedTipAmount || 0),
                    }),
                    {
                      variant: 'counter',
                      copyLabel: 'COUNTER RECORD COPY',
                      tipAmount: Number(selectedTipAmount || 0),
                      paymentMethod: selectedPaymentMethod,
                      showQr: false,
                    },
                  )
                }
                type="button"
              >
                Print Counter Copy
              </button>
              <button className="act-btn act-secondary" onClick={() => startAddMoreForTable(selectedBillingGroup)} type="button">
                Add More Items
              </button>
              <button className="reject-confirm-btn" disabled={settlingTable} onClick={handleSettleCurrentTable} type="button">
                {settlingTable ? 'Closing...' : 'Mark Paid & Close Table'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
