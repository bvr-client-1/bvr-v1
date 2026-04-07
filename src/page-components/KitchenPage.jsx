'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useInterval } from '../hooks/useInterval.js';
import { kitchenLogin } from '../services/authService.js';
import { fetchKitchenQueue, updateKitchenOrderStatus } from '../services/orderService.js';
import { timeAgo } from '../utils/format.js';
import { getDirectionsUrl, parseDeliveryAddress } from '../utils/orderLocation.js';
import { notifyNewOrder, primeAlertAudio, requestStaffNotificationPermission, startNewOrderAlertLoop, stopNewOrderAlertLoop } from '../utils/staffAlerts.js';

export default function KitchenPage() {
  const { kitchenToken, setKitchenToken, restaurantStatus, setKitchenPaused } = useAppContext();
  const { showToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [readyCount, setReadyCount] = useState(0);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [loadingQueue, setLoadingQueue] = useState(false);
  const knownQueueIdsRef = useRef(new Set());

  const handleAuthFailure = (requestError) => {
    if (requestError?.response?.status === 401) {
      setKitchenToken('');
      showToast('Session expired. Please login again.', 'error');
      return true;
    }

    return false;
  };

  const loadQueue = async ({ silent = false } = {}) => {
    if (!kitchenToken) return;
    try {
      setLoadingQueue((current) => current || !orders.length);
      const data = await fetchKitchenQueue(kitchenToken);
      const nextOrderIds = new Set(data.orders.map((order) => order.id));
      const incomingOrders = data.orders.filter((order) => !knownQueueIdsRef.current.has(order.id));
      if (knownQueueIdsRef.current.size && incomingOrders.length) {
        const latestOrder = incomingOrders[0];
        showToast(`New kitchen order: #${latestOrder.order_code}`);
        startNewOrderAlertLoop();
        notifyNewOrder('New kitchen order', `Order #${latestOrder.order_code} is waiting in the kitchen queue.`);
      }
      knownQueueIdsRef.current = nextOrderIds;
      setOrders(data.orders);
      setReadyCount(data.readyCount);
    } catch (requestError) {
      handleAuthFailure(requestError);
    } finally {
      setLoadingQueue(false);
    }
  };

  useEffect(() => {
    if (kitchenToken) {
      loadQueue();
    }
  }, [kitchenToken]);

  useEffect(() => {
    if (!kitchenToken) return;

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
  }, [kitchenToken]);

  useInterval(() => {
    if (kitchenToken) loadQueue({ silent: true });
  }, kitchenToken ? 10000 : null);

  useInterval(() => {
    setNow(Date.now());
  }, 1000);

  const handleLogin = async () => {
    try {
      await primeAlertAudio();
      requestStaffNotificationPermission();
      const data = await kitchenLogin(loginId, password);
      setKitchenToken(data.token);
      setError('');
      showToast('Welcome to Kitchen!');
    } catch (loginError) {
      setError(loginError.response?.data?.message || 'Invalid kitchen ID or password');
    }
  };

  const handleStatus = async (orderId, status) => {
    try {
      stopNewOrderAlertLoop();
      await updateKitchenOrderStatus(kitchenToken, orderId, status);
      showToast(status === 'IN_KITCHEN' ? 'Cooking started.' : 'Marked as ready.');
      await loadQueue();
    } catch (requestError) {
      if (!handleAuthFailure(requestError)) {
        showToast('Could not update order', 'error');
      }
    }
  };

  const handleKitchenToggle = async () => {
    try {
      stopNewOrderAlertLoop();
      await setKitchenPaused(!restaurantStatus.kitchenPaused);
      showToast(restaurantStatus.kitchenPaused ? 'Kitchen is back on and orders are open.' : 'Kitchen paused. New orders are blocked.');
    } catch (requestError) {
      if (!handleAuthFailure(requestError)) {
        showToast('Could not update kitchen status', 'error');
      }
    }
  };

  if (!kitchenToken) {
    return (
      <div className="password-overlay auth-screen">
        <div className="password-box">
          <div className="kitchen-emoji">{'\u{1F468}\u200D\u{1F373}'}</div>
          <h2>Kitchen Access</h2>
          <input className="input-field" onChange={(event) => setLoginId(event.target.value)} placeholder="Enter kitchen ID" type="text" value={loginId} />
          <div className="password-input-wrap">
            <input className="input-field password-input" onChange={(event) => setPassword(event.target.value)} placeholder="Enter kitchen password" type={showPassword ? 'text' : 'password'} value={password} />
            <button className="password-toggle-btn" onClick={() => setShowPassword((value) => !value)} type="button">
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <button className="btn-gold" onClick={handleLogin} type="button">
            Enter Kitchen
          </button>
          {!!error && <p className="form-error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div>

      <nav className="navbar">
        <div className="nav-inner">
          <h1 className="page-title">Kitchen Dashboard</h1>
          <div className="kitchen-nav-right">
            <span className="muted-small">{restaurantStatus.kitchenPaused ? 'Orders paused' : 'Orders live'}</span>
            <button
              className="logout-link button-reset"
              onClick={() => {
                stopNewOrderAlertLoop();
                setKitchenToken('');
              }}
              type="button"
            >
              Lock
            </button>
          </div>
        </div>
      </nav>

      <main className="dashboard-main">
        <div className="status-control-card">
          <div>
            <div className="status-control-label">Kitchen Control</div>
            <div className={`status-chip ${restaurantStatus.kitchenPaused ? 'paused' : 'live'}`}>
              {restaurantStatus.kitchenPaused ? 'Paused manually' : 'Accepting orders'}
            </div>
            <p className="muted-small">
              {restaurantStatus.kitchenPaused
                ? 'Pause mode is on. New customer orders stay blocked until you switch it back on.'
                : 'Kitchen is live. New confirmed orders will continue appearing here automatically.'}
            </p>
          </div>
          <button className={`status-toggle-btn ${restaurantStatus.kitchenPaused ? 'resume' : 'pause'}`} onClick={handleKitchenToggle} type="button">
            {restaurantStatus.kitchenPaused ? 'Turn Kitchen On' : 'Pause Kitchen'}
          </button>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-num">{orders.filter((order) => order.status === 'CONFIRMED').length}</div>
            <div className="stat-label">In Queue</div>
          </div>
          <div className="stat-card">
            <div className="stat-num">{orders.filter((order) => order.status === 'IN_KITCHEN').length}</div>
            <div className="stat-label">Cooking</div>
          </div>
          <div className="stat-card">
            <div className="stat-num">{readyCount}</div>
            <div className="stat-label">Ready</div>
          </div>
        </div>

        {loadingQueue && !orders.length ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div className="card dashboard-order-card skeleton-panel" key={`kitchen-skeleton-${index}`}>
              <div className="skeleton-line wide" />
              <div className="skeleton-line mid" />
              <div className="skeleton-line wide" />
              <div className="skeleton-line buttonish" />
            </div>
          ))
        ) : orders.length ? (
          orders.map((order) => {
            const elapsedSeconds = order.cook_started_at ? Math.floor((now - new Date(order.cook_started_at).getTime()) / 1000) : 0;
            const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
            const secs = String(elapsedSeconds % 60).padStart(2, '0');
            const deliveryMeta = parseDeliveryAddress(order.delivery_address || '');
            const directionsUrl = getDirectionsUrl(deliveryMeta);

            return (
              <div className="card dashboard-order-card" key={order.id}>
                <div className="order-card-head">
                  <div>
                    <h3 className="order-card-title">#{order.order_code}</h3>
                    <div className="muted-small">
                      {timeAgo(order.created_at)} · {order.type === 'delivery' ? 'Delivery' : `Table ${order.table_number || '?'}`}
                    </div>
                  </div>
                  <span className="badge" style={{ background: order.status === 'IN_KITCHEN' ? '#f9731620' : '#3b82f620', color: order.status === 'IN_KITCHEN' ? '#f97316' : '#3b82f6' }}>
                    {order.status === 'IN_KITCHEN' ? 'COOKING' : 'IN QUEUE'}
                  </span>
                </div>
                <div className="kitchen-items-box">
                  {(order.order_items || []).map((item) => (
                    <div className="items-row" key={`${item.item_name}-${item.quantity}`}>
                      <span>{item.item_name}</span>
                      <span className="gold-text strong">x{item.quantity}</span>
                    </div>
                  ))}
                </div>
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
                {order.status === 'IN_KITCHEN' && <div className={`kitchen-timer ${elapsedSeconds > 900 ? 'timer-warning' : ''}`}>{mins}:{secs}</div>}
                <button className={`act-btn ${order.status === 'IN_KITCHEN' ? 'act-ready' : 'act-cook'}`} onClick={() => handleStatus(order.id, order.status === 'IN_KITCHEN' ? 'READY' : 'IN_KITCHEN')} type="button">
                  {order.status === 'IN_KITCHEN' ? 'Mark Ready' : 'Start Cooking'}
                </button>
              </div>
            );
          })
        ) : (
          <div className="card empty-center">
            <div className="empty-icon">OK</div>
            <h3>All caught up</h3>
            <p>No active kitchen orders right now.</p>
          </div>
        )}
      </main>
    </div>
  );
}
