import { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useInterval } from '../hooks/useInterval.js';
import { kitchenLogin } from '../services/authService.js';
import { fetchKitchenQueue, updateKitchenOrderStatus } from '../services/orderService.js';
import { timeAgo } from '../utils/format.js';

export default function KitchenPage() {
  const { kitchenToken, setKitchenToken } = useAppContext();
  const { showToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [readyCount, setReadyCount] = useState(0);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  const loadQueue = async () => {
    if (!kitchenToken) return;
    try {
      const data = await fetchKitchenQueue(kitchenToken);
      setOrders(data.orders);
      setReadyCount(data.readyCount);
    } catch {
      showToast('Failed to load orders', 'error');
    }
  };

  useEffect(() => {
    if (kitchenToken) {
      loadQueue();
    }
  }, [kitchenToken]);

  useInterval(() => {
    if (kitchenToken) loadQueue();
  }, kitchenToken ? 10000 : null);

  useInterval(() => {
    setNow(Date.now());
  }, 1000);

  const handleLogin = async () => {
    try {
      const data = await kitchenLogin(password);
      setKitchenToken(data.token);
      setError('');
      showToast('Welcome to Kitchen! 👨‍🍳');
    } catch (loginError) {
      setError(loginError.response?.data?.message || 'Wrong password. Try again.');
    }
  };

  const handleStatus = async (orderId, status) => {
    await updateKitchenOrderStatus(kitchenToken, orderId, status);
    showToast(status === 'IN_KITCHEN' ? '🔥 Cooking started!' : '✅ Marked as ready!');
    await loadQueue();
  };

  return (
    <div>
      {!kitchenToken && (
        <div className="password-overlay">
          <div className="password-box">
            <div className="kitchen-emoji">👨‍🍳</div>
            <h2>Kitchen Access</h2>
            <input className="input-field" onChange={(event) => setPassword(event.target.value)} placeholder="Enter kitchen password" type="password" value={password} />
            <button className="btn-gold" onClick={handleLogin} type="button">
              🔓 Enter Kitchen
            </button>
            {!!error && <p className="form-error">{error}</p>}
          </div>
        </div>
      )}

      <nav className="navbar">
        <div className="nav-inner">
          <h1 className="page-title">👨‍🍳 Kitchen</h1>
          <div className="kitchen-nav-right">
            <span className="muted-small">Updated just now</span>
            <button className="logout-link button-reset" onClick={() => setKitchenToken('')} type="button">
              🔒 Lock
            </button>
          </div>
        </div>
      </nav>

      <main className="dashboard-main">
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

        {orders.length ? (
          orders.map((order) => {
            const elapsedSeconds = order.cook_started_at ? Math.floor((now - new Date(order.cook_started_at).getTime()) / 1000) : 0;
            const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
            const secs = String(elapsedSeconds % 60).padStart(2, '0');

            return (
              <div className="card" key={order.id}>
                <div className="order-card-head">
                  <div>
                    <h3 className="order-card-title">#{order.order_code}</h3>
                    <div className="muted-small">
                      {timeAgo(order.created_at)} · {order.type === 'delivery' ? '🛵 Delivery' : `🪑 Table ${order.table_number || '?'}`}
                    </div>
                  </div>
                  <span className="badge" style={{ background: order.status === 'IN_KITCHEN' ? '#f9731620' : '#3b82f620', color: order.status === 'IN_KITCHEN' ? '#f97316' : '#3b82f6' }}>
                    {order.status === 'IN_KITCHEN' ? '🔥 COOKING' : '⏳ IN QUEUE'}
                  </span>
                </div>
                <div className="kitchen-items-box">
                  {(order.order_items || []).map((item) => (
                    <div className="items-row" key={`${item.item_name}-${item.quantity}`}>
                      <span>{item.item_name}</span>
                      <span className="gold-text strong">×{item.quantity}</span>
                    </div>
                  ))}
                </div>
                {order.status === 'IN_KITCHEN' && <div className={`kitchen-timer ${elapsedSeconds > 900 ? 'timer-warning' : ''}`}>{mins}:{secs}</div>}
                <button className={`act-btn ${order.status === 'IN_KITCHEN' ? 'act-ready' : 'act-cook'}`} onClick={() => handleStatus(order.id, order.status === 'IN_KITCHEN' ? 'READY' : 'IN_KITCHEN')} type="button">
                  {order.status === 'IN_KITCHEN' ? '✅ Mark Ready' : '🔥 Start Cooking'}
                </button>
              </div>
            );
          })
        ) : (
          <div className="card empty-center">
            <div className="empty-icon">✅</div>
            <h3>All caught up!</h3>
            <p>No orders in queue. Waiting for new orders...</p>
          </div>
        )}

        <p className="auto-note">🔄 Auto-refreshes every 10 seconds · Timers tick every second</p>
      </main>
    </div>
  );
}
