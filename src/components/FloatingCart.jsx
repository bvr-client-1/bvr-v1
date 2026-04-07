'use client';

import Link from 'next/link';
import { formatPrice } from '../utils/format.js';

export function FloatingCart({ cart }) {
  const total = cart.reduce((sum, item) => sum + item.quantity, 0);
  const price = cart.reduce((sum, item) => sum + item.quantity * item.price, 0);

  if (!total) {
    return null;
  }

  return (
    <div className="float-cart visible">
      <Link className="float-cart-btn" href="/cart">
        <span>🛒</span>
        <span>View Cart</span>
        <div className="float-cart-divider" />
        <span>
          {total} item{total !== 1 ? 's' : ''} · {formatPrice(price)}
        </span>
      </Link>
    </div>
  );
}
