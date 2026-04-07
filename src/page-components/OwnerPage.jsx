'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useInterval } from '../hooks/useInterval.js';
import { ownerLogin } from '../services/authService.js';
import { fetchAdminMenuItems, updateMenuAvailability } from '../services/menuService.js';
import { addDeliveryPerson, assignDeliveryPartner, fetchAdminOrders, removeDeliveryPerson, updateAdminOrderStatus } from '../services/orderService.js';
import { formatPrice, timeAgo } from '../utils/format.js';
import { getDirectionsUrl, parseDeliveryAddress } from '../utils/orderLocation.js';
import { notifyNewOrder, primeAlertAudio, requestStaffNotificationPermission, startNewOrderAlertLoop, stopNewOrderAlertLoop } from '../utils/staffAlerts.js';

const statusBadgeMap = {
  NEW: { bg: '#3b82f620', color: '#3b82f6', text: 'NEW' },
  CONFIRMED: { bg: '#d4a01720', color: '#d4a017', text: 'CONFIRMED' },
  IN_KITCHEN: { bg: '#f9731620', color: '#f97316', text: 'IN KITCHEN' },
  READY: { bg: '#22c55e20', color: '#22c55e', text: 'READY' },
  OUT_FOR_DELIVERY: { bg: '#8b5cf620', color: '#8b5cf6', text: 'OUT FOR DELIVERY' },
  COMPLETED: { bg: '#22c55e20', color: '#22c55e', text: 'COMPLETED' },
  CANCELLED: { bg: '#ef444420', color: '#ef4444', text: 'CANCELLED' },
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

export default function OwnerPage() {
  const { ownerToken, setOwnerToken, restaurantStatus, setKitchenPaused, setMaintenanceMode } = useAppContext();
  const { showToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [deliveryPeople, setDeliveryPeople] = useState([]);
  const [managedItems, setManagedItems] = useState([]);
  const [currentTab, setCurrentTab] = useState('orders');
  const [currentFilter, setCurrentFilter] = useState('all');
  const [menuFilter, setMenuFilter] = useState('all');
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
  const knownOrderIdsRef = useRef(new Set());

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
      const incomingOrders = data.orders.filter((order) => !knownOrderIdsRef.current.has(order.id));
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

  useEffect(() => {
    if (ownerToken && currentTab === 'menu') {
      loadMenu();
    }
  }, [currentTab, ownerToken]);

  useInterval(() => {
    if (ownerToken) {
      loadOrders({ silent: true });
    }
  }, ownerToken ? 10000 : null);

  const filteredOrders = useMemo(() => {
    if (currentFilter === 'all') return orders;
    if (currentFilter === 'new') return orders.filter((order) => order.status === 'NEW');
    if (currentFilter === 'active') return orders.filter((order) => ['CONFIRMED', 'IN_KITCHEN'].includes(order.status));
    if (currentFilter === 'ready') return orders.filter((order) => ['READY', 'OUT_FOR_DELIVERY'].includes(order.status));
    return orders.filter((order) => ['COMPLETED', 'SERVED', 'CANCELLED'].includes(order.status));
  }, [currentFilter, orders]);

  const stats = useMemo(() => {
    const today = new Date().toDateString();
    const todayOrders = orders.filter((order) => new Date(order.created_at).toDateString() === today);
    return {
      pending: orders.filter((order) => order.status === 'NEW').length,
      active: orders.filter((order) => ['CONFIRMED', 'IN_KITCHEN', 'READY', 'OUT_FOR_DELIVERY'].includes(order.status)).length,
      today: todayOrders.length,
      revenue: todayOrders.filter((order) => order.status !== 'CANCELLED').reduce((sum, order) => sum + (order.total || 0), 0),
    };
  }, [orders]);

  const menuCategories = [...new Set(managedItems.map((item) => item.menu_categories?.name).filter(Boolean))];
  const visibleMenuItems = menuFilter === 'all' ? managedItems : managedItems.filter((item) => item.menu_categories?.name === menuFilter);

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
      if (status === 'CONFIRMED') {
        showToast('Order accepted and sent to kitchen.');
      } else if (status === 'CANCELLED' && result?.refund?.status) {
        showToast(`Order cancelled. Refund ${result.refund.status === 'processed' ? 'completed' : 'initiated'}.`);
      } else {
        showToast('Order updated.');
      }
      setRejectingOrderId('');
      setSelectedReason('');
      await loadOrders();
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(error.response?.data?.message || 'Update failed', 'error');
      }
    }
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
        <div className="owner-tabs">
          <button className={`owner-tab ${currentTab === 'orders' ? 'active' : ''}`} onClick={() => setCurrentTab('orders')} type="button">
            Orders
          </button>
          <button className={`owner-tab ${currentTab === 'menu' ? 'active' : ''}`} onClick={() => setCurrentTab('menu')} type="button">
            Menu
          </button>
        </div>

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

        {currentTab === 'orders' ? (
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
              <div className="stat-label">Today&apos;s Revenue</div>
              <div className="revenue-total">{formatPrice(stats.revenue)}</div>
            </div>

            <div className="filter-wrap">
              {['all', 'new', 'active', 'ready', 'completed'].map((filter) => (
                <button className={`filter-btn ${currentFilter === filter ? 'active' : ''}`} key={filter} onClick={() => setCurrentFilter(filter)} type="button">
                  {filter}
                </button>
              ))}
            </div>

            <div>
              {loadingOrders && !orders.length
                ? Array.from({ length: 3 }).map((_, index) => (
                    <div className="card dashboard-order-card skeleton-panel" key={`owner-order-skeleton-${index}`}>
                      <div className="skeleton-line wide" />
                      <div className="skeleton-line mid" />
                      <div className="skeleton-line wide" />
                      <div className="skeleton-line buttonish" />
                    </div>
                  ))
                : null}
              {filteredOrders.map((order) => {
                const deliveryMeta = parseDeliveryAddress(order.delivery_address || '');
                const directionsUrl = getDirectionsUrl(deliveryMeta);

                return (
                  <div className="card" key={order.id}>
                    <div className="order-card-head">
                      <div>
                        <h3 className="order-card-title">#{order.order_code}</h3>
                        <div className="muted-small">{timeAgo(order.created_at)}</div>
                        <span className="tiny-badge">{order.type === 'delivery' ? 'DELIVERY' : `Table ${order.table_number || '?'}`}</span>
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

                    {order.status === 'NEW' && (
                      <div className="action-row">
                        <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'CONFIRMED')} type="button">
                          Confirm
                        </button>
                        <button className="act-btn act-danger" onClick={() => setRejectingOrderId(order.id)} type="button">
                          Cancel Order
                        </button>
                      </div>
                    )}
                    {order.status === 'CONFIRMED' && (
                      <div className="action-row">
                        <button className="act-btn act-cook" onClick={() => handleStatusUpdate(order.id, 'IN_KITCHEN')} type="button">
                          Send to Kitchen
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
                        <button className="act-btn act-danger" onClick={() => setRejectingOrderId(order.id)} type="button">
                          Cancel Order
                        </button>
                      </div>
                    )}
                    {order.status === 'READY' && order.type === 'dine-in' && (
                      <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'COMPLETED')} type="button">
                        Mark as Served
                      </button>
                    )}
                    {order.status === 'READY' && order.type === 'delivery' && (
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
        ) : (
          <>
            <div className="availability-bar">
              <span>
                Available: <strong>{managedItems.filter((item) => item.is_available).length}</strong>
              </span>
              <span>
                Unavailable: <strong>{managedItems.filter((item) => !item.is_available).length}</strong>
              </span>
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
              {loadingMenu && !managedItems.length
                ? Array.from({ length: 5 }).map((_, index) => (
                    <div className="menu-item-row" key={`menu-skeleton-${index}`}>
                      <div className="menu-item-thumb skeleton-img" />
                      <div className="menu-item-body">
                        <div className="skeleton-line wide" />
                        <div className="skeleton-line mid" />
                      </div>
                    </div>
                  ))
                : visibleMenuItems.map((item) => (
                    <div className="menu-item-row" key={item.id}>
                      <div className="menu-item-thumb">{item.image_url ? <img alt={item.name} src={item.image_url} /> : '🍽️'}</div>
                      <div className="menu-item-body">
                        <div className="menu-item-name">{item.name}</div>
                        <div className="muted-small">{item.menu_categories?.name || 'Other'}</div>
                        <div className={item.is_available ? 'available-text' : 'unavailable-text'}>● {item.is_available ? 'Available' : 'Unavailable'}</div>
                      </div>
                      <div className="menu-item-side">
                        <span className="gold-text strong">{formatPrice(item.price)}</span>
                        <label className="toggle-switch">
                          <input checked={item.is_available} onChange={(event) => handleToggleMenu(item.id, event.target.checked)} type="checkbox" />
                          <span className="toggle-slider" />
                        </label>
                      </div>
                    </div>
                  ))}
            </div>
          </>
        )}
      </main>

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
    </div>
  );
}
