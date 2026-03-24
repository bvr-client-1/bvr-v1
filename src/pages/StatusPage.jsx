import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useInterval } from '../hooks/useInterval.js';
import { fetchOrderById, lookupOrderByPhone } from '../services/orderService.js';
import { STATUS_LABELS, STATUS_STEPS_DELIVERY, STATUS_STEPS_DINEIN } from '../utils/constants.js';
import { formatPrice, formatTime } from '../utils/format.js';

export default function StatusPage() {
  const { orderId, setOrderCode, setOrderId } = useAppContext();
  const { showToast } = useToast();
  const [order, setOrder] = useState(null);
  const [lookupPhone, setLookupPhone] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [expanded, setExpanded] = useState(false);

  const loadStatus = async () => {
    if (!orderId) return;
    try {
      const nextOrder = await fetchOrderById(orderId);
      setOrder(nextOrder);
    } catch {
      setOrder(null);
    }
  };

  useEffect(() => {
    loadStatus();
  }, [orderId]);

  useInterval(() => {
    if (orderId) loadStatus();
  }, 10000);

  const onLookup = async () => {
    if (!/^\d{10}$/.test(lookupPhone)) {
      setLookupError('Please enter a valid 10-digit phone number');
      return;
    }

    try {
      const data = await lookupOrderByPhone(lookupPhone);
      setOrderId(data.id);
      setOrderCode(data.order_code);
      setLookupError('');
      showToast('Order found! Loading status...');
    } catch {
      setLookupError('No order found for this number');
    }
  };

  const renderStatusTracker = () => {
    if (!order) return null;

    if (order.status === 'CANCELLED') {
      return (
        <div className="rejected-card">
          <div className="rejected-icon">❌</div>
          <h3>Order Rejected</h3>
          <div className="reason-text">{order.rejection_reason || 'Order could not be fulfilled'}</div>
          <p className="refund-note">We're sorry! Your payment will be refunded within 24-48 hours.</p>
          <Link className="back-btn" to="/menu">
            🏠 Back to Menu
          </Link>
        </div>
      );
    }

    const steps = order.type === 'delivery' ? STATUS_STEPS_DELIVERY : STATUS_STEPS_DINEIN;
    const currentIndex = steps.indexOf(order.status);

    return steps.map((step, index) => {
      const className = index < currentIndex ? 'completed' : index === currentIndex ? 'active' : 'pending';
      const icon = index < currentIndex ? '✅' : index === currentIndex ? '🔥' : '⬜';
      return (
        <div className={`step ${className}`} key={step}>
          {index !== steps.length - 1 && <div className="step-line" />}
          <div className="step-dot">{icon}</div>
          <div className="step-info">
            <div className="step-label">{STATUS_LABELS[step]}</div>
            <div className="step-time">{index === 0 ? formatTime(order.created_at) : index === currentIndex ? 'In progress' : '—'}</div>
          </div>
        </div>
      );
    });
  };

  return (
    <div>
      <nav className="navbar">
        <div className="nav-inner">
          <Link className="back-link" to="/menu">
            ← <span>Menu</span>
          </Link>
          <h1 className="page-title">Order Status</h1>
          <div style={{ width: 50 }} />
        </div>
      </nav>

      <main className="status-main">
        {!order ? (
          <div className="lookup-card">
            <h2>🔍 Find Your Order</h2>
            <p>Lost your status? Enter the phone number used to place your order.</p>
            <input className="input-field" maxLength={10} onChange={(event) => setLookupPhone(event.target.value.replace(/\D/g, ''))} placeholder="10-digit phone number" type="tel" value={lookupPhone} />
            <button className="btn-gold" onClick={onLookup} type="button">
              🔍 Find
            </button>
            {!!lookupError && <div className="form-error">{lookupError}</div>}
            <Link className="lookup-link" to="/menu">
              🍽️ Order More
            </Link>
          </div>
        ) : (
          <>
            <div className="card">
              <div className="status-header">
                <div>
                  <h2 className="order-title">Order #{order.order_code}</h2>
                  <span className="order-badge">
                    {order.type === 'delivery' ? '🛵 Delivery' : `🪑 Dine-In · Table ${order.table_number || '?'}`}
                  </span>
                </div>
                <div className="status-header-right">
                  <div className="muted-small">{formatTime(order.created_at)}</div>
                  <div className={order.status === 'CANCELLED' ? 'order-total cancelled' : 'order-total'}>
                    {formatPrice(order.total)} {order.status === 'CANCELLED' ? '❌' : '✅'}
                  </div>
                </div>
              </div>
              <div className="muted-small">
                {order.type === 'delivery'
                  ? `${order.delivery_address || 'Delivery'} · Paid via UPI`
                  : `Table ${order.table_number || '?'} · Paid via UPI`}
              </div>
            </div>

            <div className="card">
              <h2 className="card-title">Live Status</h2>
              <div>{renderStatusTracker()}</div>
            </div>

            {order.status === 'OUT_FOR_DELIVERY' && order.delivery_people && (
              <div className="card">
                <h2 className="card-title">🛵 Your Delivery Partner</h2>
                <div className="delivery-card-row">
                  <div className="delivery-avatar">👤</div>
                  <div>
                    <div className="delivery-name">{order.delivery_people.name}</div>
                    <a className="delivery-phone" href={`tel:${order.delivery_people.phone}`}>
                      📞 {order.delivery_people.phone}
                    </a>
                  </div>
                </div>
              </div>
            )}

            <div className="card">
              <button className="collapse-header" onClick={() => setExpanded((value) => !value)} type="button">
                <h2 className="card-title">Items Ordered</h2>
                <span>{expanded ? '▴' : '▾'}</span>
              </button>
              {expanded && (
                <div className="collapse-body open">
                  {(order.order_items || []).map((item) => (
                    <div className="items-row" key={`${item.item_name}-${item.id || item.quantity}`}>
                      <span>
                        {item.item_name} × {item.quantity}
                      </span>
                      <span className="gold-text">{formatPrice(item.price * item.quantity)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="auto-note">🔄 Status updates automatically every 10 seconds</p>
            <div className="center-box">
              <Link className="btn-gold inline-button" to="/menu">
                🍽️ Order More
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
