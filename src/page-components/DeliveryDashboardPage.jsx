'use client';

import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../context/ToastContext.jsx';
import { useInterval } from '../hooks/useInterval.js';
import { fetchDeliveryDashboardOrders } from '../services/orderService.js';
import { getUserFacingErrorMessage } from '../utils/errorMessages.js';
import { formatPrice, timeAgo } from '../utils/format.js';
import { getDirectionsUrl, parseDeliveryAddress } from '../utils/orderLocation.js';

const deliveryStatuses = new Set(['READY', 'OUT_FOR_DELIVERY', 'COMPLETED']);
const cleanPhone = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);
const phoneHref = (value) => {
  const phone = cleanPhone(value);
  return phone ? `tel:${phone}` : '';
};

export default function DeliveryDashboardPage() {
  const { showToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadOrders = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const data = await fetchDeliveryDashboardOrders();
      setOrders(data.orders || []);
      setError('');
    } catch (requestError) {
      const message = getUserFacingErrorMessage(requestError, 'Could not load delivery orders.');
      setError(message);
      if (!silent) showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  useInterval(() => {
    loadOrders({ silent: true });
  }, 10000);

  const deliveryOrders = useMemo(
    () =>
      orders
        .filter((order) => order.type === 'delivery' && deliveryStatuses.has(order.status))
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    [orders],
  );

  return (
    <div>
      <nav className="navbar">
        <div className="nav-inner">
          <div style={{ width: 96 }} />
          <h1 className="page-title">Delivery Dashboard</h1>
          <button className="logout-link button-reset" onClick={() => loadOrders()} type="button">
            Refresh
          </button>
        </div>
      </nav>
      <main className="dashboard-main">
        <div className="availability-bar">
          <span>
            Ready / assigned: <strong>{deliveryOrders.length}</strong>
          </span>
          <span>
            Assigned riders: <strong>{deliveryOrders.filter((order) => order.delivery_people).length}</strong>
          </span>
        </div>
        {!!error && <div className="reason-note">{error}</div>}
        {loading && !deliveryOrders.length && <div className="muted-small">Loading delivery orders...</div>}
        {!loading && !deliveryOrders.length && <div className="card muted-small">No ready or out-for-delivery orders right now.</div>}
        {deliveryOrders.map((order) => {
          const deliveryMeta = parseDeliveryAddress(order.delivery_address || '');
          const directionsUrl = getDirectionsUrl(deliveryMeta);

          return (
            <div className="card dashboard-order-card" key={order.id}>
              <div className="order-card-head">
                <div>
                  <h3 className="order-card-title">#{order.order_code}</h3>
                  <div className="muted-small">{timeAgo(order.created_at)} · {order.status.replaceAll('_', ' ')}</div>
                </div>
                <div className="order-card-price">
                  <span className="tiny-badge">{order.delivery_people ? order.delivery_people.name : 'Not assigned'}</span>
                  <div className="gold-text strong">{formatPrice(order.total)}</div>
                </div>
              </div>
              <div className="muted-small">
                Customer: {order.customer_name}
                {phoneHref(order.customer_phone) ? (
                  <>
                    {' '}| <a className="phone-link" href={phoneHref(order.customer_phone)}>{cleanPhone(order.customer_phone)}</a>
                  </>
                ) : null}
              </div>
              {order.delivery_people && (
                <div className="reason-note">
                  Rider: {order.delivery_people.name}
                  {phoneHref(order.delivery_people.phone) ? (
                    <>
                      {' '}| <a className="phone-link" href={phoneHref(order.delivery_people.phone)}>{cleanPhone(order.delivery_people.phone)}</a>
                    </>
                  ) : null}
                </div>
              )}
              <div className="order-items-copy">{(order.order_items || []).map((item) => `${item.item_name} x${item.quantity}`).join(', ')}</div>
              <div className="delivery-info-block">
                <div className="muted-small">Address: {deliveryMeta.address || order.delivery_address || 'Address not available'}</div>
                {!!directionsUrl && (
                  <a className="order-map-link" href={directionsUrl} rel="noreferrer" target="_blank">
                    Navigate
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
