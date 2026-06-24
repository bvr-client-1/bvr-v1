'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useInterval } from '../hooks/useInterval.js';
import { ownerLogin } from '../services/authService.js';
import {
  printOrderCopiesLocally,
  testPrinterConnection,
  flushPrintQueue,
  getPrintQueue,
  clearPrintQueue,
  printDaySalesReportLocally,
} from '../services/localPrintService.js';
import { createAdminMenuItem, fetchAdminMenuItems, updateMenuAvailability, updateMenuItemPrice } from '../services/menuService.js';
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
import { getUserFacingErrorMessage } from '../utils/errorMessages.js';
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
const ownerSections = [
  { value: 'counter', label: 'Counter' },
  { value: 'active', label: 'Active Tables' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'reports', label: 'Reports' },
  { value: 'controls', label: 'Controls' },
  { value: 'menu', label: 'Menu' },
];
const roundUpToTen = (value) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  return Math.ceil(amount / 10) * 10;
};
const getDeliveryPrice = (item) => {
  const explicitDeliveryPrice = Number(item.delivery_price);
  if (Number.isFinite(explicitDeliveryPrice) && explicitDeliveryPrice > 0) {
    return roundUpToTen(explicitDeliveryPrice);
  }

  const descriptionDeliveryPrice = String(item.description || '').match(/\s*\[\[BVR_DELIVERY_PRICE:([0-9]+(?:\.[0-9]+)?)\]\]\s*$/);
  if (descriptionDeliveryPrice) {
    return roundUpToTen(Number(descriptionDeliveryPrice[1]));
  }

  return roundUpToTen(Number(item.price || 0) * 1.2);
};
const foodMarkLabel = (foodType) => (foodType === 'non-veg' ? 'Non-Veg' : 'Veg');
const buildPriceDrafts = (items, priceType = 'restaurant') =>
  Object.fromEntries(items.map((item) => [item.id, String(priceType === 'delivery' ? getDeliveryPrice(item) : item.price ?? '')]));
const getRestaurantTaxBreakup = (amount) => {
  const subtotal = Number(amount || 0);
  const cgst = Math.round(subtotal * 0.025 * 100) / 100;
  const sgst = Math.round(subtotal * 0.025 * 100) / 100;
  const exactTotal = Math.round((subtotal + cgst + sgst) * 100) / 100;
  return { cgst, sgst, grandTotal: Math.ceil(exactTotal), roundOff: Math.ceil(exactTotal) - exactTotal };
};
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
const isPlaceholderCustomerName = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return (
    !normalized ||
    normalized.startsWith('walk-in table') ||
    normalized.startsWith('walk-in-table') ||
    normalized.startsWith('takeaway token') ||
    normalized === 'walk-in'
  );
};
const cleanCustomerPhone = (value) => {
  const phone = String(value || '').replace(/\D/g, '').slice(0, 10);
  return phone && phone !== '0000000000' ? phone : '';
};
const phoneHref = (value) => {
  const phone = cleanCustomerPhone(value);
  return phone ? `tel:${phone}` : '';
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
const getSettlementMeta = (order) =>
  parseSettlementMeta(order?.rejection_reason) || parseSettlementMeta(order?.payment_record?.refundFailureReason);

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
const getAuditEventDateKey = (event, fallbackDate) => toDateKey(event.createdAt || event.created_at || fallbackDate);

const countsAsRevenue = (order) =>
  order.status !== 'CANCELLED' && (order.payment_status === 'PAID' || order.status === 'COMPLETED');

const getReportDateKey = (order) => {
  const settlementMeta = getSettlementMeta(order);
  return toDateKey(settlementMeta?.settledAt || order.created_at);
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
        customerName: isPlaceholderCustomerName(order.customer_name) ? '' : order.customer_name || '',
        customerPhone: cleanCustomerPhone(order.customer_phone),
      });
    }

    const group = groups.get(groupKey);
    group.orders.push(order);
    group.total += Number(order.total || 0);
    group.itemCount += (order.order_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    if (new Date(order.created_at) > new Date(group.latestCreatedAt)) {
      group.latestCreatedAt = order.created_at;
    }
    if (!isPlaceholderCustomerName(order.customer_name)) {
      group.customerName = order.customer_name;
    }
    const nextCustomerPhone = cleanCustomerPhone(order.customer_phone);
    if (nextCustomerPhone) {
      group.customerPhone = nextCustomerPhone;
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
    subtotal: group.total,
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
    if (!countsAsRevenue(order)) {
      if (order.status === 'CANCELLED') {
        cancelledCount += 1;
      }
      continue;
    }

    const settlementMeta = getSettlementMeta(order);
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
    orderCount: ordersForDay.filter(countsAsRevenue).length,
    tipTotal,
    totalRevenue: foodRevenue + tipTotal,
  };
};


export default function OwnerPage() {
  const { ownerToken, setOwnerToken, restaurantStatus, setKitchenPaused, setMaintenanceMode, updateRestaurantSettings } = useAppContext();
  const { showToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [deliveryPeople, setDeliveryPeople] = useState([]);
  const [managedItems, setManagedItems] = useState([]);
  const [currentTab, setCurrentTab] = useState('counter');
  const [currentFilter, setCurrentFilter] = useState('all');
  const [menuFilter, setMenuFilter] = useState('all');
  const [menuAdminSection, setMenuAdminSection] = useState('restaurant');
  const [reportSection, setReportSection] = useState('orders');
  const [menuSearchQuery, setMenuSearchQuery] = useState('');
  const [restaurantPriceDrafts, setRestaurantPriceDrafts] = useState({});
  const [deliveryPriceDrafts, setDeliveryPriceDrafts] = useState({});
  const [savingMenuItemId, setSavingMenuItemId] = useState('');
  const [specialItemForm, setSpecialItemForm] = useState({
    name: '',
    categoryName: 'Daily Specials',
    foodType: 'veg',
    price: '',
    deliveryPrice: '',
  });
  const [creatingSpecialItem, setCreatingSpecialItem] = useState(false);
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
  const [expandedHistoryOrderId, setExpandedHistoryOrderId] = useState('');
  const [expandedAdjustmentOrderId, setExpandedAdjustmentOrderId] = useState('');
  const [selectedActiveGroupKey, setSelectedActiveGroupKey] = useState('');
  const [restaurantSettingsDraft, setRestaurantSettingsDraft] = useState({ tableCount: '16', deliveryRadiusKm: '4' });
  const [savingRestaurantSettings, setSavingRestaurantSettings] = useState(false);
  const [printBridgeUrl, setPrintBridgeUrl] = useState('http://127.0.0.1:9123');
  const [kitchenPrinterIp, setKitchenPrinterIp] = useState('192.168.1.110');
  const [kitchenPrinterPort, setKitchenPrinterPort] = useState('9100');
  const [counterPrinterIp, setCounterPrinterIp] = useState('192.168.1.110');
  const [counterPrinterPort, setCounterPrinterPort] = useState('9100');
  const [printQueueCount, setPrintQueueCount] = useState(0);
  const [printerOnlineStatus, setPrinterOnlineStatus] = useState('Offline');
  const [testingConnection, setTestingConnection] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPrintBridgeUrl(window.localStorage.getItem('bvr_print_bridge_url') || 'http://127.0.0.1:9123');
      setKitchenPrinterIp(window.localStorage.getItem('bvr_kitchen_printer_ip') || '192.168.1.110');
      setKitchenPrinterPort(window.localStorage.getItem('bvr_kitchen_printer_port') || '9100');
      setCounterPrinterIp(window.localStorage.getItem('bvr_counter_printer_ip') || '192.168.1.110');
      setCounterPrinterPort(window.localStorage.getItem('bvr_counter_printer_port') || '9100');
      setPrintQueueCount(getPrintQueue().length);
    }
  }, []);

  useInterval(() => {
    if (typeof window === 'undefined') return;
    const queue = getPrintQueue();
    setPrintQueueCount(queue.length);

    if (queue.length > 0) {
      flushPrintQueue().then(({ processed }) => {
        if (processed > 0) {
          showToast(`Printed ${processed} queued jobs automatically.`, 'success');
          setPrintQueueCount(getPrintQueue().length);
        }
      });
    }

    testPrinterConnection(kitchenPrinterIp, kitchenPrinterPort).then((res) => {
      setPrinterOnlineStatus(res.ok ? 'Online' : 'Offline');
    });
  }, 15000);

  const handleSavePrinterSettings = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('bvr_print_bridge_url', printBridgeUrl.trim());
      window.localStorage.setItem('bvr_kitchen_printer_ip', kitchenPrinterIp.trim());
      window.localStorage.setItem('bvr_kitchen_printer_port', kitchenPrinterPort.trim());
      window.localStorage.setItem('bvr_counter_printer_ip', counterPrinterIp.trim());
      window.localStorage.setItem('bvr_counter_printer_port', counterPrinterPort.trim());
      showToast('Printer settings saved successfully.', 'success');

      testPrinterConnection(kitchenPrinterIp.trim(), kitchenPrinterPort.trim()).then((res) => {
        setPrinterOnlineStatus(res.ok ? 'Online' : 'Offline');
      });
    }
  };

  const handleResetPrinterSettings = () => {
    setPrintBridgeUrl('http://127.0.0.1:9123');
    setKitchenPrinterIp('192.168.1.110');
    setKitchenPrinterPort('9100');
    setCounterPrinterIp('192.168.1.110');
    setCounterPrinterPort('9100');
    showToast('Printer settings reset to defaults. Remember to click Save Config.', 'info');
  };

  const handleTestPrinterConnection = async () => {
    setTestingConnection(true);
    showToast('Testing printer connection...');
    const res = await testPrinterConnection(kitchenPrinterIp.trim(), kitchenPrinterPort.trim());
    setTestingConnection(false);
    setPrinterOnlineStatus(res.ok ? 'Online' : 'Offline');
    if (res.ok) {
      showToast('Printer is online and connected!', 'success');
    } else {
      showToast(`Printer connection failed: ${res.message}`, 'error');
    }
  };

  const handleManualFlushQueue = async () => {
    const queue = getPrintQueue();
    if (!queue.length) {
      showToast('Print queue is empty.');
      return;
    }
    showToast('Retrying queued print jobs...');
    const { processed, failed } = await flushPrintQueue();
    setPrintQueueCount(getPrintQueue().length);
    if (processed > 0) {
      showToast(`Successfully printed ${processed} queued orders!`, 'success');
    }
    if (failed > 0) {
      showToast(`Failed to print ${failed} orders. Still in queue.`, 'error');
    }
  };

  const handleClearPrintQueue = () => {
    clearPrintQueue();
    setPrintQueueCount(0);
    showToast('Print queue cleared.');
  };

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
      if (knownOrderIdsRef.current.size && incomingOrders.length && currentTab !== 'delivery') {
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
      setRestaurantPriceDrafts(buildPriceDrafts(items, 'restaurant'));
      setDeliveryPriceDrafts(buildPriceDrafts(items, 'delivery'));
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(getUserFacingErrorMessage(error, 'Menu could not be loaded right now.'), 'error');
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
    setRestaurantSettingsDraft({
      tableCount: String(Number(restaurantStatus.tableCount) || 16),
      deliveryRadiusKm: String(Number(restaurantStatus.deliveryRadiusKm) || 4),
    });
  }, [restaurantStatus.tableCount, restaurantStatus.deliveryRadiusKm]);

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

  useEffect(() => {
    if (currentTab === 'delivery') {
      stopNewOrderAlertLoop();
    }
  }, [currentTab]);

  useEffect(() => {
    setExpandedAdjustmentOrderId('');
  }, [historyDate, reportSection]);

  useEffect(() => {
    setExpandedHistoryOrderId('');
  }, [historyDate, reportSection]);

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
  const tableOptions = useMemo(() => {
    const configuredTableCount = Math.max(1, Number(restaurantStatus.tableCount) || 16);
    const configuredTables = Array.from({ length: configuredTableCount }, (_, index) => String(index + 1));
    const activeTables = activeTableGroups
      .filter((group) => group.serviceMode === 'TABLE')
      .map((group) => String(group.tableNumber));

    return Array.from(new Set([...configuredTables, ...activeTables])).sort((left, right) => Number(left) - Number(right));
  }, [activeTableGroups, restaurantStatus.tableCount]);
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
    () => orders.filter((order) => getReportDateKey(order) === historyDate),
    [historyDate, orders],
  );
  const historyAdjustmentOrders = useMemo(
    () =>
      orders
        .map((order) => {
          const matchingEvents = (order.audit_events || [])
            .filter((event) => ['ITEM_REMOVED', 'ORDER_CANCELLED'].includes(event.eventType))
            .filter((event) => getAuditEventDateKey(event, order.created_at) === historyDate)
            .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());
          const hasCancellationEvent = matchingEvents.some((event) => event.eventType === 'ORDER_CANCELLED');
          const shouldIncludeCancelledFallback =
            order.status === 'CANCELLED' && !hasCancellationEvent && toDateKey(order.created_at) === historyDate;
          const events = shouldIncludeCancelledFallback
            ? [
                {
                  id: `${order.id}-cancelled-fallback`,
                  eventType: 'ORDER_CANCELLED',
                  lineTotal: Number(order.total || 0),
                  note: order.rejection_reason || 'Cancelled',
                  createdAt: order.created_at,
                },
                ...matchingEvents,
              ]
            : matchingEvents;

          if (!events.length) {
            return null;
          }

          const removedEvents = events.filter((event) => event.eventType === 'ITEM_REMOVED');
          const cancelledEvents = events.filter((event) => event.eventType === 'ORDER_CANCELLED');
          const takeawayToken = getTakeawayToken(order);
          const displayLabel = order.type === 'delivery'
            ? 'Delivery'
            : takeawayToken
              ? `Takeaway ${takeawayToken}`
              : `Table ${order.table_number || '-'}`;
          const latestEventTime = events.reduce(
            (latest, event) => Math.max(latest, new Date(event.createdAt || order.created_at || 0).getTime()),
            0,
          );

          return {
            order,
            id: order.id,
            orderCode: order.order_code,
            displayLabel,
            events,
            removedEvents,
            cancelledEvents,
            itemCount:
              removedEvents.reduce((sum, event) => sum + Number(event.quantityRemoved || 0), 0) ||
              (cancelledEvents.length ? (order.order_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0) : 0),
            amount: events.reduce((sum, event) => sum + Number(event.lineTotal || 0), 0),
            latestEventTime,
          };
        })
        .filter(Boolean)
        .sort((left, right) => right.latestEventTime - left.latestEventTime),
    [historyDate, orders],
  );

  const filteredDeliveryOrders = useMemo(() => {
    if (currentFilter === 'all') return deliveryOrders;
    if (currentFilter === 'new') return deliveryOrders.filter((order) => order.status === 'NEW');
    if (currentFilter === 'active') return deliveryOrders.filter((order) => ['CONFIRMED', 'IN_KITCHEN'].includes(order.status));
    if (currentFilter === 'ready') return deliveryOrders.filter((order) => ['READY', 'OUT_FOR_DELIVERY'].includes(order.status));
    return deliveryOrders.filter((order) => ['COMPLETED', 'SERVED', 'CANCELLED'].includes(order.status));
  }, [currentFilter, deliveryOrders]);

  const stats = useMemo(() => {
    const today = getTodayDateKey();
    const todayOrders = orders.filter((order) => getReportDateKey(order) === today);
    const revenueOrders = todayOrders.filter(countsAsRevenue);
    const todayTips = revenueOrders.reduce((sum, order) => {
      const settlementMeta = getSettlementMeta(order);
      return sum + Number(settlementMeta?.primary ? settlementMeta.tipAmount || 0 : 0);
    }, 0);

    return {
      pending: deliveryOrders.filter((order) => order.status === 'NEW').length + activeTableGroups.length,
      active: orders.filter((order) => !['COMPLETED', 'CANCELLED'].includes(order.status)).length,
      today: todayOrders.length,
      revenue: revenueOrders.reduce((sum, order) => sum + Number(order.total || 0), 0) + todayTips,
    };
  }, [activeTableGroups.length, deliveryOrders, orders]);

  const historySummary = useMemo(() => {
    const revenueOrders = historyOrders.filter(countsAsRevenue);
    const tipTotal = revenueOrders.reduce((sum, order) => {
      const settlementMeta = getSettlementMeta(order);
      return sum + Number(settlementMeta?.primary ? settlementMeta.tipAmount || 0 : 0);
    }, 0);

    return {
      orderCount: historyOrders.length,
      deliveryCount: historyOrders.filter((order) => order.type === 'delivery').length,
      dineInCount: historyOrders.filter((order) => order.type === 'dine-in').length,
      cancelledCount: historyOrders.filter((order) => order.status === 'CANCELLED').length,
      revenue: revenueOrders.reduce((sum, order) => sum + Number(order.total || 0), 0) + tipTotal,
      tipTotal,
    };
  }, [historyOrders]);

  const historyDateObject = useMemo(() => new Date(`${historyDate}T00:00:00`), [historyDate]);
  const historyEntries = useMemo(
    () =>
      historyOrders.map((order) => {
        const settlementMeta = getSettlementMeta(order);
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
          items: order.order_items || [],
          order,
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
        item.display_name?.toLowerCase().includes(normalizedQuery) ||
        item.menu_categories?.name?.toLowerCase().includes(normalizedQuery);
      return categoryMatch && searchMatch;
    });
  }, [managedItems, menuFilter, menuSearchQuery]);
  const builderItems = useMemo(() => {
    const availableItems = managedItems.filter((item) => item.is_available);
    return availableItems.filter((item) => {
      const categoryMatch = builderCategory === 'all' || item.menu_categories?.name === builderCategory;
      const query = builderQuery.trim().toLowerCase();
      const queryMatch = !query || item.name.toLowerCase().includes(query) || item.display_name?.toLowerCase().includes(query);
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
      setLoginError(getUserFacingErrorMessage(error, 'Invalid email or password'));
    }
  };

  const handleStatusUpdate = async (orderId, status, rejectionReason = null) => {
    try {
      const result = await updateAdminOrderStatus(ownerToken, orderId, status, rejectionReason);
      if (status === 'IN_KITCHEN' && result?.order) {
        await handleAutoPrintKitchenAndCounter(result.order);
      }
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
        showToast(getUserFacingErrorMessage(error, 'Order update failed. Please try again.'), 'error');
      }
      return null;
    }
  };

  const handlePrintKot = async (order) => {
    showToast('Sending KOT to printer...');
    const result = await printOrderCopiesLocally(order);
    if (result.ok) {
      showToast(`KOT sent to printer for order #${order.order_code}`, 'success');
      return true;
    }
    if (result.queued) {
      showToast(`Printer offline. KOT queued for order #${order.order_code}`, 'warning');
      setPrintQueueCount(getPrintQueue().length);
      return true;
    }
    showToast(`Print failed: ${result.message}`, 'error');
    return false;
  };

  const handlePrintBill = async (order, options = {}) => {
    showToast('Sending Bill to printer...');
    const result = await printOrderCopiesLocally(order);
    if (result.ok) {
      showToast(`Bill sent to printer for order #${order.order_code}`, 'success');
      return true;
    }
    if (result.queued) {
      showToast(`Printer offline. Bill queued for order #${order.order_code}`, 'warning');
      setPrintQueueCount(getPrintQueue().length);
      return true;
    }
    showToast(`Print failed: ${result.message}`, 'error');
    return false;
  };

  const handleAutoPrintKitchenAndCounter = async (order) => {
    const result = await printOrderCopiesLocally(order);
    if (result.ok) {
      showToast(`KOT and Bill sent to printer for order #${order.order_code}`, 'success');
      return true;
    }
    if (result.queued) {
      showToast(`Printer offline. KOT and Bill queued for order #${order.order_code}`, 'warning');
      setPrintQueueCount(getPrintQueue().length);
      return true;
    }
    showToast(`Automatic printing failed: ${result.message}`, 'error');
    return false;
  };

  const handleAssignDelivery = async (orderId, deliveryPersonId) => {
    if (!deliveryPersonId) {
      showToast('Please select a delivery partner', 'error');
      return;
    }

    try {
      const result = await assignDeliveryPartner(ownerToken, orderId, deliveryPersonId);
      if (result?.order) {
        setOrders((previous) => previous.map((order) => (order.id === orderId ? result.order : order)));
      } else {
        await loadOrders();
      }
      showToast('Delivery partner updated.');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(getUserFacingErrorMessage(error, 'Delivery partner update failed.'), 'error');
      }
    }
  };

  const handleSpecialItemChange = (field, value) => {
    setSpecialItemForm((current) => ({
      ...current,
      [field]: ['price', 'deliveryPrice'].includes(field) ? value.replace(/[^0-9.]/g, '') : value,
    }));
  };

  const handleCreateSpecialItem = async () => {
    const name = specialItemForm.name.trim();
    const categoryName = specialItemForm.categoryName.trim() || 'Daily Specials';
    const price = Number(specialItemForm.price);
    const deliveryPrice = specialItemForm.deliveryPrice.trim() ? Number(specialItemForm.deliveryPrice) : null;

    if (name.length < 2) {
      showToast('Enter the special item name.', 'error');
      return;
    }

    if (!Number.isFinite(price) || price <= 0) {
      showToast('Enter a valid restaurant price.', 'error');
      return;
    }

    if (specialItemForm.deliveryPrice.trim() && (!Number.isFinite(deliveryPrice) || deliveryPrice < 0)) {
      showToast('Enter a valid delivery price.', 'error');
      return;
    }

    try {
      setCreatingSpecialItem(true);
      const item = await createAdminMenuItem(ownerToken, {
        name,
        categoryName,
        foodType: specialItemForm.foodType,
        price,
        deliveryPrice,
      });
      setManagedItems((previous) => [item, ...previous]);
      setRestaurantPriceDrafts((previous) => ({ ...previous, [item.id]: String(item.price ?? price) }));
      setDeliveryPriceDrafts((previous) => ({ ...previous, [item.id]: String(getDeliveryPrice(item)) }));
      setSpecialItemForm({ name: '', categoryName: 'Daily Specials', foodType: 'veg', price: '', deliveryPrice: '' });
      setMenuAdminSection('restaurant');
      showToast(`${item.display_name || item.name} added for KOT creation.`, 'success');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(getUserFacingErrorMessage(error, 'Could not add this special item.'), 'error');
      }
    } finally {
      setCreatingSpecialItem(false);
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
      setAddingDeliveryStaff(true);
      const person = await addDeliveryPerson(ownerToken, { name, phone });
      setDeliveryPeople((current) => [person, ...current.filter((existing) => existing.id !== person.id)]);
      setDeliveryStaffForm({ name: '', phone: '' });
      showToast('Delivery person added.');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(getUserFacingErrorMessage(error, 'Could not add the delivery person right now.'), 'error');
      }
    } finally {
      setAddingDeliveryStaff(false);
    }
  };

  const handleRemoveDeliveryStaff = async (person) => {
    const confirmed = window.confirm(`Remove ${person.name} from active delivery staff?`);
    if (!confirmed) return;

    try {
      setRemovingDeliveryStaffId(person.id);
      await removeDeliveryPerson(ownerToken, person.id);
      setDeliveryPeople((current) => current.filter((existing) => existing.id !== person.id));
      showToast('Delivery person removed from active staff.');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(getUserFacingErrorMessage(error, 'Could not remove the delivery person right now.'), 'error');
      }
    } finally {
      setRemovingDeliveryStaffId('');
    }
  };

  const handleToggleMenu = async (itemId, isAvailable) => {
    try {
      await updateMenuAvailability(ownerToken, itemId, isAvailable);
      setManagedItems((previous) => previous.map((item) => (item.id === itemId ? { ...item, is_available: isAvailable } : item)));
      showToast(isAvailable ? 'Marked available.' : 'Marked unavailable.', isAvailable ? 'success' : 'info');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(getUserFacingErrorMessage(error, 'Menu availability update failed. Please try again.'), 'error');
      }
    }
  };

  const handlePriceDraftChange = (itemId, value, priceType = 'restaurant') => {
    if (/^\d*(\.\d{0,2})?$/.test(value)) {
      const setter = priceType === 'delivery' ? setDeliveryPriceDrafts : setRestaurantPriceDrafts;
      setter((previous) => ({
        ...previous,
        [itemId]: value,
      }));
    }
  };

  const handleSavePrice = async (item, priceType = 'restaurant') => {
    const drafts = priceType === 'delivery' ? deliveryPriceDrafts : restaurantPriceDrafts;
    const draftValue = String(drafts[item.id] ?? '').trim();
    const nextPrice = Number(draftValue);
    const currentPrice = priceType === 'delivery' ? getDeliveryPrice(item) : Number(item.price);

    if (!draftValue || Number.isNaN(nextPrice) || nextPrice < 0) {
      showToast('Enter a valid price before saving.', 'error');
      return;
    }

    if (currentPrice === nextPrice) {
      showToast('Price is already up to date.', 'info');
      return;
    }

    try {
      setSavingMenuItemId(item.id);
      await updateMenuItemPrice(ownerToken, item.id, nextPrice, priceType);
      setManagedItems((previous) =>
        previous.map((menuItem) =>
          menuItem.id === item.id
            ? priceType === 'delivery'
              ? { ...menuItem, delivery_price: nextPrice }
              : { ...menuItem, price: nextPrice }
            : menuItem,
        ),
      );
      const setter = priceType === 'delivery' ? setDeliveryPriceDrafts : setRestaurantPriceDrafts;
      setter((previous) => ({
        ...previous,
        [item.id]: String(nextPrice),
      }));
      showToast(`Updated ${priceType === 'delivery' ? 'delivery' : 'restaurant'} price for ${item.name}.`, 'success');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(getUserFacingErrorMessage(error, 'Could not update the menu price right now.'), 'error');
      }
    } finally {
      setSavingMenuItemId('');
    }
  };

  const handleKitchenToggle = async () => {
    try {
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
      await setMaintenanceMode(!restaurantStatus.maintenanceMode);
      showToast(restaurantStatus.maintenanceMode ? 'Website is back online.' : 'Maintenance mode is now live for customers.');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast('Could not update maintenance mode', 'error');
      }
    }
  };

  const handleRestaurantSettingsChange = (field, value) => {
    setRestaurantSettingsDraft((current) => ({
      ...current,
      [field]: value.replace(field === 'tableCount' ? /\D/g : /[^0-9.]/g, ''),
    }));
  };

  const handleSaveRestaurantSettings = async (settingsType = 'all') => {
    const tableCount = Number(restaurantSettingsDraft.tableCount);
    const deliveryRadiusKm = Number(restaurantSettingsDraft.deliveryRadiusKm);
    const nextSettings = {};

    if (['all', 'tables'].includes(settingsType) && (!Number.isInteger(tableCount) || tableCount < 1 || tableCount > 100)) {
      showToast('Table count must be between 1 and 100.', 'error');
      return;
    }

    if (['all', 'radius'].includes(settingsType) && (!Number.isFinite(deliveryRadiusKm) || deliveryRadiusKm < 0.5 || deliveryRadiusKm > 50)) {
      showToast('Delivery radius must be between 0.5 km and 50 km.', 'error');
      return;
    }

    if (['all', 'tables'].includes(settingsType)) {
      nextSettings.tableCount = tableCount;
    }

    if (['all', 'radius'].includes(settingsType)) {
      nextSettings.deliveryRadiusKm = deliveryRadiusKm;
    }

    try {
      setSavingRestaurantSettings(true);
      await updateRestaurantSettings(nextSettings);
      showToast(settingsType === 'tables' ? 'Table count updated.' : settingsType === 'radius' ? 'Delivery radius updated.' : 'Restaurant settings updated.', 'success');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(getUserFacingErrorMessage(error, 'Could not update restaurant settings.'), 'error');
      }
    } finally {
      setSavingRestaurantSettings(false);
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
  const counterTargetValue = serviceMode === 'TAKEAWAY' ? (takeawayToken ? `TAKEAWAY:${takeawayToken}` : 'TAKEAWAY_NEW') : tableNumber ? `TABLE:${tableNumber}` : '';

  const handleCounterTargetChange = (value) => {
    if (value === 'TAKEAWAY_NEW') {
      setServiceMode('TAKEAWAY');
      setTableNumber('');
      setTakeawayToken('');
      return;
    }

    if (value.startsWith('TAKEAWAY:')) {
      setServiceMode('TAKEAWAY');
      setTableNumber('');
      setTakeawayToken(value.slice('TAKEAWAY:'.length));
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

    const generatedTakeawayToken = takeawayToken.trim() || `TK-${Date.now().toString().slice(-6)}`;

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

      await handleAutoPrintKitchenAndCounter(response.order);
      showToast(serviceMode === 'TAKEAWAY' ? 'Takeaway KOT created.' : `KOT created for Table ${tableNumber}.`);
      resetDraft();
      if (serviceMode === 'TAKEAWAY' && !takeawayToken.trim()) {
        setTakeawayToken('');
      }
      await loadOrders();
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(getUserFacingErrorMessage(error, 'Could not create the KOT right now. Please review the draft and try again.'), 'error');
      }
    } finally {
      setSubmittingTableOrder(false);
    }
  };

  const startAddMoreForTable = (group) => {
    setServiceMode(group.serviceMode);
    setTableNumber(group.serviceMode === 'TABLE' ? group.tableNumber : '');
    setTakeawayToken(group.serviceMode === 'TAKEAWAY' ? group.takeawayToken : '');
    setCustomerName(isPlaceholderCustomerName(group.customerName) ? '' : group.customerName || '');
    setCustomerPhone(cleanCustomerPhone(group.customerPhone));
    setBillingGroupKey('');
    setCurrentTab('counter');
    resetDraft();
    window.setTimeout(() => orderEntryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
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
  const selectedBillingTax = useMemo(
    () => getRestaurantTaxBreakup(selectedBillingGroup?.total || 0),
    [selectedBillingGroup],
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
        showToast(getUserFacingErrorMessage(error, 'Could not close this table right now.'), 'error');
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
        showToast(getUserFacingErrorMessage(error, 'Could not remove that item right now.'), 'error');
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

  const handlePrintDaySales = async () => {
    const report = buildDaySalesReport(historyOrders);
    showToast('Sending day sale report to printer...');
    const res = await printDaySalesReportLocally(formatHistoryDate(historyDateObject), report);
    if (res.ok) {
      showToast('Day sale report printed successfully.', 'success');
    } else {
      showToast(`Failed to print day sale report: ${res.message}`, 'error');
    }
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

        <div className="status-control-card staff-control-card settings-control-card">
          <div className="staff-control-copy">
            <div className="status-control-label">Table Setup</div>
            <p className="muted-small">
              Set how many regular table buttons appear on the counter and active table boards.
              Active tables above this number stay visible until their bill is closed.
            </p>
            <div className="staff-list-row">
              <span className="tiny-badge">Configured: {Number(restaurantStatus.tableCount) || 16} tables</span>
            </div>
          </div>
          <div className="staff-form-card">
            <input
              className="input-field"
              inputMode="numeric"
              onChange={(event) => handleRestaurantSettingsChange('tableCount', event.target.value)}
              placeholder="Number of tables"
              type="text"
              value={restaurantSettingsDraft.tableCount}
            />
            <button className="status-toggle-btn resume" disabled={savingRestaurantSettings} onClick={() => handleSaveRestaurantSettings('tables')} type="button">
              {savingRestaurantSettings ? 'Saving...' : 'Save Table Count'}
            </button>
          </div>
        </div>

        <div className="status-control-card staff-control-card settings-control-card">
          <div className="staff-control-copy">
            <div className="status-control-label">Delivery Radius</div>
            <p className="muted-small">
              Set how far customer delivery checkout is allowed from the restaurant location.
            </p>
            <div className="staff-list-row">
              <span className="tiny-badge">Current: {Number(restaurantStatus.deliveryRadiusKm) || 4} km</span>
            </div>
          </div>
          <div className="staff-form-card">
            <input
              className="input-field"
              inputMode="decimal"
              onChange={(event) => handleRestaurantSettingsChange('deliveryRadiusKm', event.target.value)}
              placeholder="Delivery radius in km"
              type="text"
              value={restaurantSettingsDraft.deliveryRadiusKm}
            />
            <button className="status-toggle-btn resume" disabled={savingRestaurantSettings} onClick={() => handleSaveRestaurantSettings('radius')} type="button">
              {savingRestaurantSettings ? 'Saving...' : 'Save Delivery Radius'}
            </button>
          </div>
        </div>

        <div className="status-control-card staff-control-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', borderBottom: '1px solid rgba(212,160,23,0.15)', paddingBottom: '16px' }}>
            <div style={{ flex: 1, minWidth: '280px' }}>
              <div className="status-control-label">Network Printer & Queue Setup</div>
              <p className="muted-small" style={{ marginTop: '8px', lineHeight: '1.4' }}>
                Configure the local print bridge and thermal printers for this device. These settings are stored locally in the browser.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                <span className={`status-chip ${printerOnlineStatus === 'Online' ? 'live' : 'paused'}`} style={{ marginTop: 0 }}>
                  Kitchen Printer: {printerOnlineStatus}
                </span>
                <span className="status-chip" style={{ marginTop: 0, background: printQueueCount > 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.05)', color: printQueueCount > 0 ? '#fca5a5' : 'var(--text)', border: printQueueCount > 0 ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)' }}>
                  Queue: {printQueueCount} pending
                </span>
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button className="status-toggle-btn resume" onClick={handleSavePrinterSettings} type="button">
                Save Config
              </button>
              <button className="status-toggle-btn" onClick={handleTestPrinterConnection} disabled={testingConnection} type="button" style={{ background: 'rgba(212,160,23,0.1)', color: 'var(--bright-gold)', border: '1px solid rgba(212,160,23,0.25)' }}>
                {testingConnection ? 'Testing...' : 'Test Printer'}
              </button>
              <button className="status-toggle-btn pause" onClick={handleResetPrinterSettings} type="button" style={{ background: 'rgba(239, 68, 68, 0.1)' }}>
                Reset Defaults
              </button>
              {printQueueCount > 0 && (
                <>
                  <button className="status-toggle-btn resume" onClick={handleManualFlushQueue} type="button" style={{ background: 'linear-gradient(135deg, #22c55e, #4ade80)' }}>
                    Retry Queue
                  </button>
                  <button className="status-toggle-btn pause" onClick={handleClearPrintQueue} type="button" style={{ background: '#ef4444' }}>
                    Clear Queue
                  </button>
                </>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--bright-gold)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Local Print Bridge URL</label>
              <input
                className="input-field"
                onChange={(event) => setPrintBridgeUrl(event.target.value)}
                placeholder="http://192.168.1.50:9123"
                type="text"
                value={printBridgeUrl}
              />
              <span className="muted-small" style={{ fontSize: '0.72rem' }}>E.g. http://&lt;windows-pc-ip&gt;:9123</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--bright-gold)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Kitchen Printer IP & Port</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  className="input-field"
                  onChange={(event) => setKitchenPrinterIp(event.target.value)}
                  placeholder="192.168.1.110"
                  type="text"
                  value={kitchenPrinterIp}
                  style={{ flex: 2 }}
                />
                <input
                  className="input-field"
                  onChange={(event) => setKitchenPrinterPort(event.target.value)}
                  placeholder="9100"
                  type="text"
                  value={kitchenPrinterPort}
                  style={{ flex: 1 }}
                />
              </div>
              <span className="muted-small" style={{ fontSize: '0.72rem' }}>Kitchen printer (ESC/POS on Port 9100)</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--bright-gold)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Counter Printer IP & Port</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  className="input-field"
                  onChange={(event) => setCounterPrinterIp(event.target.value)}
                  placeholder="192.168.1.110"
                  type="text"
                  value={counterPrinterIp}
                  style={{ flex: 2 }}
                />
                <input
                  className="input-field"
                  onChange={(event) => setCounterPrinterPort(event.target.value)}
                  placeholder="9100"
                  type="text"
                  value={counterPrinterPort}
                  style={{ flex: 1 }}
                />
              </div>
              <span className="muted-small" style={{ fontSize: '0.72rem' }}>Billing printer (ESC/POS on Port 9100)</span>
            </div>
          </div>
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
                  <option value="TAKEAWAY_NEW">New Takeaway</option>
                  {activeTakeawayGroups.map((group) => (
                    <option key={group.groupKey} value={`TAKEAWAY:${group.takeawayToken}`}>
                      Add to {group.displayLabel}
                    </option>
                  ))}
                </select>
                {serviceMode === 'TAKEAWAY' && (
                  <div className="reason-note" style={{ margin: 0 }}>
                    {takeawayToken ? `Adding items to Takeaway ${takeawayToken}` : 'Creating a separate new takeaway order.'}
                  </div>
                )}
                <input className="input-field" onChange={(event) => setCustomerName(event.target.value)} placeholder="Customer name (optional)" type="text" value={customerName} />
                <input className="input-field" inputMode="numeric" maxLength={10} onChange={(event) => setCustomerPhone(event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="Customer phone (optional)" type="tel" value={customerPhone} />
              </div>

              <div className="owner-tabs owner-section-tabs builder-category-tabs">
                <button className={`owner-tab ${builderCategory === 'all' ? 'active' : ''}`} onClick={() => setBuilderCategory('all')} type="button">
                  All Items
                </button>
                {menuCategories.map((category) => (
                  <button className={`owner-tab ${builderCategory === category ? 'active' : ''}`} key={category} onClick={() => setBuilderCategory(category)} type="button">
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
                  {'<'}
                </button>
                <div className="history-date-label">{formatHistoryDate(historyDateObject)}</div>
                <button className="history-nav-btn" onClick={() => shiftHistoryDate(1)} type="button">
                  {'>'}
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
              <div className="owner-tabs owner-section-tabs report-section-tabs">
                {[
                  { value: 'orders', label: 'Orders' },
                  { value: 'adjustments', label: 'Removed / Cancelled' },
                ].map((section) => (
                  <button
                    className={`owner-tab ${reportSection === section.value ? 'active' : ''}`}
                    key={section.value}
                    onClick={() => setReportSection(section.value)}
                    type="button"
                  >
                    {section.label}
                  </button>
                ))}
              </div>
              {reportSection === 'orders' && (
                <>
              {!historyEntries.length && <div className="muted-small">No orders found for this day.</div>}
              <div className="history-entry-list">
                {historyEntries.map((entry) => {
                  const expanded = expandedHistoryOrderId === entry.id;
                  return (
                  <div className="history-entry-card" key={entry.id}>
                    <button
                      className="collapse-header adjustment-order-toggle"
                      onClick={() => setExpandedHistoryOrderId(expanded ? '' : entry.id)}
                      type="button"
                    >
                      <div>
                        <div className="gold-text strong">{entry.title}</div>
                        <div className="muted-small">{entry.subtitle}</div>
                      </div>
                      <div className="order-card-price">
                        <div className="gold-text strong">{formatPrice(entry.amount)}</div>
                        <div className="muted-small">{timeAgo(entry.time)}</div>
                      </div>
                    </button>
                    {expanded && (
                      <div className="adjustment-detail-list">
                        <div className="table-item-list">
                          {entry.items.length ? (
                            entry.items.map((item) => (
                              <div className="table-item-row" key={item.id || `${item.item_name}-${item.quantity}`}>
                                <span>{item.item_name} x{item.quantity}</span>
                                <span className="gold-text strong">{formatPrice(Number(item.price_at_purchase ?? item.price ?? 0) * Number(item.quantity || 0))}</span>
                              </div>
                            ))
                          ) : (
                            <div className="muted-small">No items</div>
                          )}
                        </div>
                      </div>
                    )}
                    {!!entry.tipAmount && <div className="reason-note">Tip recorded: {formatPrice(entry.tipAmount)}</div>}
                  </div>
                  );
                })}
              </div>
                </>
              )}
              {reportSection === 'adjustments' && (
                <>
                  {!historyAdjustmentOrders.length && <div className="muted-small">No removed items or cancelled KOTs found for this day.</div>}
                  <div className="history-entry-list">
                    {historyAdjustmentOrders.map((adjustment) => {
                      const expanded = expandedAdjustmentOrderId === adjustment.id;
                      return (
                        <div className="history-entry-card" key={adjustment.id}>
                          <button
                            className="collapse-header adjustment-order-toggle"
                            onClick={() => setExpandedAdjustmentOrderId(expanded ? '' : adjustment.id)}
                            type="button"
                          >
                            <span>
                              <span className="gold-text strong">#{adjustment.orderCode}</span>
                              <span className="muted-small">
                                {adjustment.displayLabel} | {adjustment.removedEvents.length ? `${adjustment.removedEvents.length} removals` : ''}
                                {adjustment.removedEvents.length && adjustment.cancelledEvents.length ? ' | ' : ''}
                                {adjustment.cancelledEvents.length ? 'cancelled' : ''}
                              </span>
                            </span>
                            <span className="order-card-price">
                              <span className="gold-text strong">{formatPrice(adjustment.amount)}</span>
                              <span className="muted-small">{timeAgo(adjustment.latestEventTime)}</span>
                            </span>
                          </button>
                          {expanded && (
                            <div className="adjustment-detail-list">
                              {!!adjustment.removedEvents.length && (
                                <div className="table-item-list">
                                  {adjustment.removedEvents.map((event) => (
                                    <div className="table-item-row" key={event.id}>
                                      <span>{event.itemName || 'Removed item'} x{event.quantityRemoved || 1}</span>
                                      <div className="table-item-actions">
                                        <span className="gold-text strong">{formatPrice(Number(event.lineTotal || 0))}</span>
                                        <span className="muted-small">{getAuditConsentLabel(event.consentStatus)}</span>
                                      </div>
                                      {!!event.note && <div className="muted-small full-width">Note: {event.note}</div>}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {!!adjustment.cancelledEvents.length && (
                                <div className="billing-review-order">
                                  <div className="status-control-label">Cancelled KOT Items</div>
                                  <div className="table-item-list">
                                    {(adjustment.order.order_items || []).map((item) => (
                                      <div className="table-item-row" key={item.id || `${item.item_name}-${item.quantity}`}>
                                        <span>{item.item_name} x{item.quantity}</span>
                                        <span className="gold-text strong">{formatPrice(Number(item.price_at_purchase ?? item.price ?? 0) * Number(item.quantity || 0))}</span>
                                      </div>
                                    ))}
                                  </div>
                                  {adjustment.cancelledEvents.map((event) => (
                                    <div className="reason-note" key={event.id}>
                                      Reason: {event.note || adjustment.order.rejection_reason || 'Cancelled'}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {false && (
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
              )}
            </div>
            )}

            {currentTab === 'delivery' && (
              <>
            <div className="owner-tabs owner-section-tabs delivery-section-tabs">
              {[
                { value: 'all', label: 'All' },
                { value: 'new', label: 'New' },
                { value: 'active', label: 'Active' },
                { value: 'ready', label: 'Ready' },
                { value: 'completed', label: 'Completed' },
              ].map((filter) => (
                <button className={`owner-tab ${currentFilter === filter.value ? 'active' : ''}`} key={filter.value} onClick={() => setCurrentFilter(filter.value)} type="button">
                  {filter.label}
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

                    <div className="muted-small">
                      Customer: {order.customer_name}
                      {phoneHref(order.customer_phone) ? (
                        <>
                          {' '}| <a className="phone-link" href={phoneHref(order.customer_phone)}>{cleanCustomerPhone(order.customer_phone)}</a>
                        </>
                      ) : null}
                    </div>
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
                        Rider: {order.delivery_people.name}
                        {phoneHref(order.delivery_people.phone) ? (
                          <>
                            {' '}| <a className="phone-link" href={phoneHref(order.delivery_people.phone)}>{cleanCustomerPhone(order.delivery_people.phone)}</a>
                          </>
                        ) : null}
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
                          Print Counter Bill
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
                        <button className="act-btn act-secondary" onClick={() => handlePrintBill(order)} type="button">
                          Print Counter Bill
                        </button>
                        <button className="act-btn act-danger" onClick={() => setRejectingOrderId(order.id)} type="button">
                          Cancel Order
                        </button>
                      </div>
                    )}
                    {['READY', 'OUT_FOR_DELIVERY'].includes(order.status) && (
                      <div className="action-row">
                        <select className="input-field" defaultValue={order.delivery_person_id || ''} id={`delivery-person-${order.id}`}>
                          <option value="">{order.status === 'OUT_FOR_DELIVERY' ? 'Change rider' : 'Select rider'}</option>
                          {deliveryPeople.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name}
                            </option>
                          ))}
                        </select>
                        <button className="act-btn act-confirm" onClick={() => handleAssignDelivery(order.id, document.getElementById(`delivery-person-${order.id}`)?.value)} type="button">
                          {order.status === 'OUT_FOR_DELIVERY' ? 'Change Rider' : 'Assign'}
                        </button>
                        <button className="act-btn act-secondary" onClick={() => handlePrintBill(order)} type="button">
                          Print Counter Bill
                        </button>
                      </div>
                    )}
                    {order.status === 'OUT_FOR_DELIVERY' && (
                      <div className="action-row">
                        <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'COMPLETED')} type="button">
                          Mark Delivered
                        </button>
                      </div>
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
                Menu Items: <strong>{managedItems.length}</strong>
              </span>
              <span>
                Available: <strong>{managedItems.filter((item) => item.is_available).length}</strong>
              </span>
              <span>
                Showing: <strong>{visibleMenuItems.length}</strong>
              </span>
            </div>

            <div className="owner-tabs owner-section-tabs">
              {[
                { value: 'restaurant', label: 'Restaurant Menu' },
                { value: 'delivery', label: 'Delivery Menu' },
                { value: 'stock', label: 'Stock Update' },
                { value: 'special', label: 'Add KOT Special' },
              ].map((section) => (
                <button
                  className={`owner-tab ${menuAdminSection === section.value ? 'active' : ''}`}
                  key={section.value}
                  onClick={() => setMenuAdminSection(section.value)}
                  type="button"
                >
                  {section.label}
                </button>
              ))}
            </div>

            {menuAdminSection === 'special' ? (
              <div className="card special-item-card">
                <div>
                  <div className="status-control-label">Daily Special / KOT Item</div>
                  <p className="muted-small">Add temporary restaurant items here. They become available immediately in counter KOT creation.</p>
                </div>
                <div className="special-item-grid">
                  <input
                    className="input-field"
                    onChange={(event) => handleSpecialItemChange('name', event.target.value)}
                    placeholder="Item name"
                    type="text"
                    value={specialItemForm.name}
                  />
                  <input
                    className="input-field"
                    onChange={(event) => handleSpecialItemChange('categoryName', event.target.value)}
                    placeholder="Category"
                    type="text"
                    value={specialItemForm.categoryName}
                  />
                  <select className="input-field" onChange={(event) => handleSpecialItemChange('foodType', event.target.value)} value={specialItemForm.foodType}>
                    <option value="veg">Veg</option>
                    <option value="non-veg">Non-Veg</option>
                  </select>
                  <input
                    className="input-field"
                    onChange={(event) => handleSpecialItemChange('price', event.target.value)}
                    placeholder="Restaurant price"
                    type="text"
                    value={specialItemForm.price}
                  />
                  <input
                    className="input-field"
                    onChange={(event) => handleSpecialItemChange('deliveryPrice', event.target.value)}
                    placeholder="Delivery price optional"
                    type="text"
                    value={specialItemForm.deliveryPrice}
                  />
                </div>
                <button className="status-toggle-btn resume full-width" disabled={creatingSpecialItem} onClick={handleCreateSpecialItem} type="button">
                  {creatingSpecialItem ? 'Adding...' : 'Add Item For KOT'}
                </button>
              </div>
            ) : (
              <>
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
                      {menuAdminSection !== 'stock' && (
                      <div className="menu-price-editor">
                        <label className="menu-price-label" htmlFor={`menu-price-${menuAdminSection}-${item.id}`}>
                          {menuAdminSection === 'delivery' ? 'Delivery Price' : 'Restaurant Price'}
                        </label>
                        <div className="menu-price-input-row">
                          <span className="menu-price-currency">₹</span>
                          <input
                            className="menu-price-input"
                            id={`menu-price-${menuAdminSection}-${item.id}`}
                            onChange={(event) => handlePriceDraftChange(item.id, event.target.value, menuAdminSection)}
                            type="text"
                            value={(menuAdminSection === 'delivery' ? deliveryPriceDrafts : restaurantPriceDrafts)[item.id] ?? ''}
                          />
                        </div>
                        <button
                          className="menu-price-save-btn"
                          disabled={savingMenuItemId === item.id}
                          onClick={() => handleSavePrice(item, menuAdminSection)}
                          type="button"
                        >
                          {savingMenuItemId === item.id ? 'Saving...' : `Save ${menuAdminSection === 'delivery' ? 'Delivery' : 'Restaurant'} Price`}
                        </button>
                      </div>
                      )}
                      {menuAdminSection === 'stock' && (
                      <label className="toggle-switch">
                        <input checked={item.is_available} onChange={(event) => handleToggleMenu(item.id, event.target.checked)} type="checkbox" />
                        <span className="toggle-slider" />
                      </label>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="muted-small">No menu items match this category or search.</div>
              )}
            </div>
              </>
            )}
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

      {!!selectedBillingGroup && !pendingRemoval && (
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
            <div className="reason-note">Bill Total with GST: {formatPrice(selectedBillingTax.grandTotal)}</div>
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
                <span>Subtotal</span>
                <strong>{formatPrice(selectedBillingGroup.total)}</strong>
              </div>
              <div className="billing-amount-line">
                <span>CGST 2.5%</span>
                <strong>{formatPrice(selectedBillingTax.cgst)}</strong>
              </div>
              <div className="billing-amount-line">
                <span>SGST 2.5%</span>
                <strong>{formatPrice(selectedBillingTax.sgst)}</strong>
              </div>
              {!!selectedBillingTax.roundOff && (
                <div className="billing-amount-line">
                  <span>Rounded up</span>
                  <strong>{formatPrice(selectedBillingTax.roundOff)}</strong>
                </div>
              )}
              <div className="billing-amount-line">
                <span>Tip</span>
                <strong>{formatPrice(Number(selectedTipAmount || 0))}</strong>
              </div>
              <div className="billing-amount-line total">
                <span>Counter Total</span>
                <strong>{formatPrice(Number(selectedBillingTax.grandTotal) + Number(selectedTipAmount || 0))}</strong>
              </div>
            </div>
            <div className="reject-actions" style={{ flexWrap: 'wrap' }}>
              <button className="reject-cancel-btn" onClick={() => setBillingGroupKey('')} type="button">
                Cancel
              </button>
              <button
                className="act-btn act-secondary"
                onClick={() =>
                  handlePrintBill(buildAggregatedBillOrder(selectedBillingGroup, {
                    paymentMethod: selectedPaymentMethod,
                    tipAmount: Number(selectedTipAmount || 0),
                  }), {
                    variant: 'customer',
                    copyLabel: 'FINAL CUSTOMER BILL',
                    tipAmount: Number(selectedTipAmount || 0),
                    paymentMethod: selectedPaymentMethod,
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
