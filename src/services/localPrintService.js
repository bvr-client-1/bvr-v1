'use client';

const LOCAL_PRINT_BRIDGE_URL = process.env.NEXT_PUBLIC_LOCAL_PRINT_BRIDGE_URL || 'http://127.0.0.1:9123';

export const printOrderCopiesLocally = async (order) => {
  if (typeof window === 'undefined' || !order) {
    return { ok: false, message: 'No order to print' };
  }

  try {
    const response = await fetch(`${LOCAL_PRINT_BRIDGE_URL}/print/order-copies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.ok === false) {
      return { ok: false, message: data.message || 'Local print bridge rejected the print job' };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message || 'Local print bridge is not running' };
  }
};
