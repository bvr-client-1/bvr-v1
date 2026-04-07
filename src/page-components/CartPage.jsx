'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAppContext } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { createPaymentOrder, verifyPayment } from '../services/paymentService.js';
import {
  calculateDistanceKm,
  DELIVERY_RADIUS_KM,
  getCurrentPosition,
  hasDeliveryZoneConfig,
  RESTAURANT_LOCATION,
} from '../utils/delivery.js';
import { formatPrice } from '../utils/format.js';
import { getOpenMessage, isRestaurantOpen, loadRazorpayScript } from '../utils/restaurant.js';

const FREE_DELIVERY_ENABLED = (process.env.NEXT_PUBLIC_FREE_DELIVERY_ENABLED ?? 'true') === 'true';
const FREE_DELIVERY_COUPON = process.env.NEXT_PUBLIC_FREE_DELIVERY_COUPON_CODE || 'FREEDEL';
const STANDARD_DELIVERY_CHARGE = 30;

export default function CartPage() {
  const router = useRouter();
  const { cart, setCart, setOrderCode, setOrderId, restaurantStatus } = useAppContext();
  const { showToast } = useToast();
  const [orderType, setOrderType] = useState('dine-in');
  const [tableNumber, setTableNumber] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const open = isRestaurantOpen(restaurantStatus);

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.quantity * item.price, 0), [cart]);
  const baseDeliveryCharge = orderType === 'delivery' ? STANDARD_DELIVERY_CHARGE : 0;
  const couponDiscount = orderType === 'delivery' && FREE_DELIVERY_ENABLED ? baseDeliveryCharge : 0;
  const deliveryCharge = Math.max(baseDeliveryCharge - couponDiscount, 0);
  const total = subtotal + deliveryCharge;

  const updateQuantity = (id, delta) => {
    setCart((previous) =>
      previous
        .map((item) => (item.id === id ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0),
    );
  };

  const validateForm = () => {
    if (!cart.length) return 'Cart empty';
    if (orderType === 'dine-in' && !tableNumber) return 'Please select a table number';
    if (orderType === 'delivery' && deliveryAddress.trim().length < 10) return 'Please enter a valid delivery address';
    if (!customerName.trim()) return 'Please enter your name';
    if (!/^\d{10}$/.test(customerPhone.trim())) return 'Enter valid 10-digit phone';
    return '';
  };

  const handlePay = async () => {
    const nextError = validateForm();
    setError(nextError);
    if (nextError || !open || paying) {
      return;
    }

    setPaying(true);

    try {
      let currentDeliveryLocation = deliveryLocation;
      if (orderType === 'delivery') {
        if (!hasDeliveryZoneConfig()) {
          throw new Error('Delivery zone is not configured right now');
        }

        currentDeliveryLocation = await getCurrentPosition();
        const distanceKm = calculateDistanceKm(currentDeliveryLocation, RESTAURANT_LOCATION);
        if (distanceKm > DELIVERY_RADIUS_KM) {
          throw new Error(`Delivery is available only within ${DELIVERY_RADIUS_KM} km of the restaurant`);
        }
        setDeliveryLocation(currentDeliveryLocation);
      }

      const razorpayLoaded = await loadRazorpayScript();
      if (!razorpayLoaded) {
        throw new Error('Unable to load payment gateway');
      }

      const orderCode = `BVR${Date.now().toString().slice(-6)}`;
      const paymentDraft = {
        receipt: orderCode,
        orderCode,
        orderType,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        tableNumber,
        deliveryAddress:
          orderType === 'delivery'
            ? `${deliveryAddress.trim()}${landmark.trim() ? `, ${landmark.trim()}` : ''}`
            : '',
        deliveryLatitude: orderType === 'delivery' ? currentDeliveryLocation.latitude : null,
        deliveryLongitude: orderType === 'delivery' ? currentDeliveryLocation.longitude : null,
        subtotal,
        deliveryCharge,
        total,
        items: cart,
      };

      const paymentOrder = await createPaymentOrder(paymentDraft);

      const options = {
        key: paymentOrder.keyId || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: paymentOrder.amount,
        currency: paymentOrder.currency,
        name: 'BVR Restaurant',
        description: `Order #${orderCode}`,
        order_id: paymentOrder.orderId,
        handler: async (response) => {
          const payload = await verifyPayment({
            ...paymentDraft,
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          });

          setOrderId(payload.orderId);
          setOrderCode(payload.orderCode);
          setCart([]);
          setPaying(false);
          showToast('Payment successful! Saving order...');
          router.push('/status');
        },
        prefill: {
          name: customerName.trim(),
          contact: customerPhone.trim(),
        },
        theme: { color: '#d4a017' },
        modal: {
          ondismiss: () => {
            setPaying(false);
            showToast('Payment cancelled', 'info');
          },
        },
      };

      const razorpay = new window.Razorpay(options);
      razorpay.on('payment.failed', (response) => {
        const reason = response?.error?.description || response?.error?.reason || response?.error?.source || 'Payment failed';
        setError(reason);
        setPaying(false);
        showToast(reason, 'error');
      });
      razorpay.open();
    } catch (paymentError) {
      setError(paymentError.message || 'Unable to start payment');
      showToast(paymentError.message || 'Unable to start payment', 'error');
      setPaying(false);
    }
  };

  return (
    <div>
      <nav className="navbar">
        <div className="nav-inner">
          <Link className="back-link" href="/menu">
            <span>←</span>
            <span>Menu</span>
          </Link>
          <h1 className="page-title">Your Cart</h1>
          <div style={{ width: 56 }} />
        </div>
      </nav>

      {!open && (
        <div className="closed-banner" style={{ display: 'block', marginTop: 64 }}>
          Orders are currently unavailable · {getOpenMessage(restaurantStatus)}
        </div>
      )}

      <main className="cart-main">
        {!cart.length ? (
          <div className="empty-cart">
            <div className="empty-cart-icon">Cart</div>
            <h2>Your cart is empty</h2>
            <p>Add items from our menu to get started</p>
            <Link className="btn-gold inline-button" href="/menu">
              Browse Menu
            </Link>
          </div>
        ) : (
          <div className="cart-shell">
            <div className="card cart-card cart-items-card">
              <h2 className="card-title">Order Items</h2>
              {cart.map((item) => (
                <div className="cart-item-row" key={item.id}>
                  <div className="cart-item-copy">
                    <div className="cart-item-name">{item.name}</div>
                    <div className="cart-item-meta">{formatPrice(item.price)} each</div>
                  </div>
                  <div className="cart-item-actions">
                    <div className="qty-wrap">
                      <button className="qty-btn small" onClick={() => updateQuantity(item.id, -1)} type="button">
                        -
                      </button>
                      <span className="qty-num">{item.quantity}</span>
                      <button className="qty-btn small" onClick={() => updateQuantity(item.id, 1)} type="button">
                        +
                      </button>
                    </div>
                    <span className="cart-item-total">{formatPrice(item.price * item.quantity)}</span>
                    <button className="remove-btn" onClick={() => updateQuantity(item.id, -item.quantity)} type="button">
                      ×
                    </button>
                  </div>
                </div>
              ))}
              <div className="summary-row top-border">
                <span>Subtotal</span>
                <span className="gold-text">{formatPrice(subtotal)}</span>
              </div>
            </div>

            <div className="card cart-card">
              <h2 className="card-title">Order Type</h2>
              <div aria-label="Order Type" className="order-type-toggle" role="tablist">
                <button className={`toggle-btn ${orderType === 'dine-in' ? 'active' : ''}`} onClick={() => setOrderType('dine-in')} type="button">
                  <span>Dine-In</span>
                </button>
                <button className={`toggle-btn ${orderType === 'delivery' ? 'active' : ''}`} onClick={() => setOrderType('delivery')} type="button">
                  <span>Delivery</span>
                </button>
              </div>
            </div>

            <div className="card cart-card">
              <h2 className="card-title">Your Details</h2>
              {orderType === 'dine-in' ? (
                <div>
                  <label className="label">Table Number</label>
                  <select className="input-field" onChange={(event) => setTableNumber(event.target.value)} value={tableNumber}>
                    <option value="">Select table...</option>
                    {Array.from({ length: 16 }).map((_, index) => (
                      <option key={index + 1} value={index + 1}>
                        Table {index + 1}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="stacked-fields">
                  <div className="delivery-zone-note">
                    Delivery is available only within {DELIVERY_RADIUS_KM} km of the restaurant. We use your current location at checkout to confirm eligibility.
                  </div>
                  <div>
                    <label className="label">Delivery Address</label>
                    <textarea className="input-field" onChange={(event) => setDeliveryAddress(event.target.value)} placeholder="Enter your full address" value={deliveryAddress} />
                  </div>
                  <div>
                    <label className="label">Landmark (optional)</label>
                    <input className="input-field" onChange={(event) => setLandmark(event.target.value)} placeholder="Near..." type="text" value={landmark} />
                  </div>
                </div>
              )}

              <div>
                <label className="label">Your Name</label>
                <input className="input-field" onChange={(event) => setCustomerName(event.target.value)} placeholder="Enter your name" type="text" value={customerName} />
              </div>
              <div>
                <label className="label">Phone Number</label>
                <input className="input-field" maxLength={10} onChange={(event) => setCustomerPhone(event.target.value.replace(/\D/g, ''))} placeholder="10-digit phone number" type="tel" value={customerPhone} />
              </div>
            </div>

            <div className="card cart-card price-summary-card">
              <h2 className="card-title">Price Summary</h2>
              <div className="summary-row">
                <span>Subtotal</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              {orderType === 'delivery' && (
                <>
                  <div className="summary-row">
                    <span>Delivery Charge</span>
                    <span>{formatPrice(baseDeliveryCharge)}</span>
                  </div>
                  {FREE_DELIVERY_ENABLED && (
                    <>
                      <div className="coupon-chip">Coupon Applied: {FREE_DELIVERY_COUPON} · Free Delivery</div>
                      <div className="summary-row coupon-row">
                        <span>Coupon Discount</span>
                        <span>-{formatPrice(couponDiscount)}</span>
                      </div>
                    </>
                  )}
                </>
              )}
              <div className="summary-row top-border total-row">
                <span>Total</span>
                <span>{formatPrice(total)}</span>
              </div>
            </div>

            <button className="btn-gold full-width pay-button" disabled={paying || !open} onClick={handlePay} type="button">
              {paying ? 'Processing...' : `Pay ${formatPrice(total)} via UPI`}
            </button>
            {!!error && <p className="form-error">{error}</p>}
          </div>
        )}
      </main>
    </div>
  );
}
