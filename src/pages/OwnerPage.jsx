import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useInterval } from '../hooks/useInterval.js';
import { ownerLogin } from '../services/authService.js';
import { fetchAdminMenuItems, updateMenuAvailability } from '../services/menuService.js';
import { assignDeliveryPartner, fetchAdminOrders, updateAdminOrderStatus } from '../services/orderService.js';
import { formatPrice, timeAgo } from '../utils/format.js';

const statusBadgeMap = {
  NEW: { bg: '#3b82f620', color: '#3b82f6', text: '🆕 NEW' },
  CONFIRMED: { bg: '#d4a01720', color: '#d4a017', text: '✅ CONFIRMED' },
  IN_KITCHEN: { bg: '#f9731620', color: '#f97316', text: '🔥 IN KITCHEN' },
  READY: { bg: '#22c55e20', color: '#22c55e', text: '✅ READY' },
  OUT_FOR_DELIVERY: { bg: '#8b5cf620', color: '#8b5cf6', text: '🛵 OUT FOR DELIVERY' },
  COMPLETED: { bg: '#22c55e20', color: '#22c55e', text: '✅ COMPLETED' },
  CANCELLED: { bg: '#ef444420', color: '#ef4444', text: '❌ CANCELLED' },
};

export default function OwnerPage() {
  const { ownerToken, setOwnerToken } = useAppContext();
  const { showToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [deliveryPeople, setDeliveryPeople] = useState([]);
  const [managedItems, setManagedItems] = useState([]);
  const [currentTab, setCurrentTab] = useState('orders');
  const [currentFilter, setCurrentFilter] = useState('all');
  const [menuFilter, setMenuFilter] = useState('all');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [rejectingOrderId, setRejectingOrderId] = useState('');
  const [selectedReason, setSelectedReason] = useState('');

  const loadOrders = async () => {
    if (!ownerToken) return;
    const data = await fetchAdminOrders(ownerToken);
    setOrders(data.orders);
    setDeliveryPeople(data.deliveryPeople);
  };

  const loadMenu = async () => {
    if (!ownerToken) return;
    const items = await fetchAdminMenuItems(ownerToken);
    setManagedItems(items);
  };

  useEffect(() => {
    if (ownerToken) {
      loadOrders();
    }
  }, [ownerToken]);

  useEffect(() => {
    if (ownerToken && currentTab === 'menu') {
      loadMenu();
    }
  }, [currentTab, ownerToken]);

  useInterval(() => {
    if (ownerToken) {
      loadOrders();
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
      const data = await ownerLogin(email, password);
      setOwnerToken(data.token);
      setLoginError('');
      showToast('Welcome, Owner!');
    } catch (error) {
      setLoginError(error.response?.data?.message || 'Invalid email or password');
    }
  };

  const handleStatusUpdate = async (orderId, status, rejectionReason = null) => {
    try {
      await updateAdminOrderStatus(ownerToken, orderId, status, rejectionReason);
      showToast(status === 'CONFIRMED' ? 'Order accepted! Sent to kitchen. ✅' : 'Order updated ✅');
      setRejectingOrderId('');
      setSelectedReason('');
      await loadOrders();
    } catch {
      showToast('Update failed', 'error');
    }
  };

  const handleAssignDelivery = async (orderId, deliveryPersonId) => {
    if (!deliveryPersonId) {
      showToast('Please select a delivery partner', 'error');
      return;
    }

    try {
      await assignDeliveryPartner(ownerToken, orderId, deliveryPersonId);
      showToast('🛵 Delivery partner assigned!');
      await loadOrders();
    } catch {
      showToast('Assignment failed', 'error');
    }
  };

  const handleToggleMenu = async (itemId, isAvailable) => {
    try {
      await updateMenuAvailability(ownerToken, itemId, isAvailable);
      setManagedItems((previous) => previous.map((item) => (item.id === itemId ? { ...item, is_available: isAvailable } : item)));
      showToast(isAvailable ? 'Marked Available ✅' : 'Marked Unavailable ❌', isAvailable ? 'success' : 'info');
    } catch {
      showToast('Update failed', 'error');
    }
  };

  return (
    <div>
      {!ownerToken && (
        <div className="login-overlay">
          <div className="login-box">
            <h2>🔐 Owner Login</h2>
            <div className="stacked-fields">
              <input className="input-field" onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" value={email} />
              <input className="input-field" onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" value={password} />
              <button className="btn-gold" onClick={handleLogin} type="button">
                🔓 Login
              </button>
              {!!loginError && <p className="form-error">{loginError}</p>}
            </div>
          </div>
        </div>
      )}

      <nav className="navbar">
        <div className="nav-inner">
          <h1 className="page-title">🧑 Owner Dashboard</h1>
          <button className="logout-link button-reset" onClick={() => setOwnerToken('')} type="button">
            Logout ↗
          </button>
        </div>
      </nav>

      <main className="dashboard-main">
        <div className="owner-tabs">
          <button className={`owner-tab ${currentTab === 'orders' ? 'active' : ''}`} onClick={() => setCurrentTab('orders')} type="button">
            📋 Orders
          </button>
          <button className={`owner-tab ${currentTab === 'menu' ? 'active' : ''}`} onClick={() => setCurrentTab('menu')} type="button">
            🍽️ Menu
          </button>
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
              <div className="stat-label">Today's Revenue</div>
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
              {filteredOrders.map((order) => (
                <div className="card" key={order.id}>
                  <div className="order-card-head">
                    <div>
                      <h3 className="order-card-title">#{order.order_code}</h3>
                      <div className="muted-small">{timeAgo(order.created_at)}</div>
                      <span className="tiny-badge">{order.type === 'delivery' ? '🛵 DELIVERY' : `🪑 Table ${order.table_number || '?'}`}</span>
                    </div>
                    <div className="order-card-price">
                      <span className="badge" style={{ background: statusBadgeMap[order.status]?.bg, color: statusBadgeMap[order.status]?.color }}>
                        {statusBadgeMap[order.status]?.text || order.status}
                      </span>
                      <div className="gold-text strong">{formatPrice(order.total)}</div>
                    </div>
                  </div>

                  <div className="muted-small">👤 {order.customer_name} · 📞 {order.customer_phone}</div>
                  <div className="order-items-copy">{(order.order_items || []).map((item) => `${item.item_name} ×${item.quantity}`).join(', ')}</div>
                  {!!order.delivery_address && <div className="muted-small">📍 {order.delivery_address}</div>}
                  {!!order.rejection_reason && <div className="reason-note">Reason: {order.rejection_reason}</div>}

                  {order.status === 'NEW' && order.type === 'delivery' && (
                    <div className="action-row">
                      <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'CONFIRMED')} type="button">
                        ✅ Accept & Confirm
                      </button>
                      <button className="act-btn act-danger" onClick={() => setRejectingOrderId(order.id)} type="button">
                        ❌ Reject Order
                      </button>
                    </div>
                  )}
                  {order.status === 'NEW' && order.type !== 'delivery' && (
                    <div className="action-row">
                      <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'CONFIRMED')} type="button">
                        ✅ Confirm
                      </button>
                      <button className="act-btn act-danger" onClick={() => handleStatusUpdate(order.id, 'CANCELLED')} type="button">
                        ❌ Reject
                      </button>
                    </div>
                  )}
                  {order.status === 'CONFIRMED' && (
                    <button className="act-btn act-cook" onClick={() => handleStatusUpdate(order.id, 'IN_KITCHEN')} type="button">
                      🔥 Send to Kitchen
                    </button>
                  )}
                  {order.status === 'IN_KITCHEN' && (
                    <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'READY')} type="button">
                      ✅ Mark Ready
                    </button>
                  )}
                  {order.status === 'READY' && order.type === 'dine-in' && (
                    <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'COMPLETED')} type="button">
                      ✅ Mark as Served
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
                        🛵 Assign
                      </button>
                    </div>
                  )}
                  {order.status === 'OUT_FOR_DELIVERY' && (
                    <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'COMPLETED')} type="button">
                      ✅ Mark Delivered
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="availability-bar">
              <span>
                ✅ Available: <strong>{managedItems.filter((item) => item.is_available).length}</strong>
              </span>
              <span>
                ❌ Unavailable: <strong>{managedItems.filter((item) => !item.is_available).length}</strong>
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
              {visibleMenuItems.map((item) => (
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
            <h3>❌ Reject this order?</h3>
            {['Outside delivery area', 'Address not clear', 'Delivery not available now'].map((reason) => (
              <button className={`reason-option ${selectedReason === reason ? 'selected' : ''}`} key={reason} onClick={() => setSelectedReason(reason)} type="button">
                {reason}
              </button>
            ))}
            <div className="reject-actions">
              <button className="reject-cancel-btn" onClick={() => setRejectingOrderId('')} type="button">
                Cancel
              </button>
              <button className="reject-confirm-btn" disabled={!selectedReason} onClick={() => handleStatusUpdate(rejectingOrderId, 'CANCELLED', selectedReason)} type="button">
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
