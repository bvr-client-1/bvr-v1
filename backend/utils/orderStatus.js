const DELIVERY_STATUSES = new Set(['READY', 'OUT_FOR_DELIVERY', 'COMPLETED']);
const DINE_IN_STATUSES = new Set(['READY', 'SERVED', 'COMPLETED']);

const allowedTransitions = {
  NEW: new Set(['CONFIRMED', 'CANCELLED']),
  CONFIRMED: new Set(['IN_KITCHEN', 'CANCELLED']),
  IN_KITCHEN: new Set(['READY', 'CANCELLED']),
  READY: new Set(['OUT_FOR_DELIVERY', 'SERVED', 'COMPLETED']),
  OUT_FOR_DELIVERY: new Set(['COMPLETED']),
  SERVED: new Set(['COMPLETED']),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

export const canTransitionStatus = ({ currentStatus, nextStatus, orderType }) => {
  if (currentStatus === nextStatus) {
    return true;
  }

  const nextStatuses = allowedTransitions[currentStatus];
  if (!nextStatuses?.has(nextStatus)) {
    return false;
  }

  if (orderType === 'delivery' && nextStatus === 'SERVED') {
    return false;
  }

  if (orderType === 'dine-in' && nextStatus === 'OUT_FOR_DELIVERY') {
    return false;
  }

  if (orderType === 'delivery' && currentStatus === 'READY' && !DELIVERY_STATUSES.has(nextStatus)) {
    return false;
  }

  if (orderType === 'dine-in' && currentStatus === 'READY' && !DINE_IN_STATUSES.has(nextStatus)) {
    return false;
  }

  return true;
};

export const assertValidStatusTransition = ({ currentStatus, nextStatus, orderType }) => {
  if (
    !canTransitionStatus({
      currentStatus,
      nextStatus,
      orderType,
    })
  ) {
    const error = new Error(`Cannot change order status from ${currentStatus} to ${nextStatus}`);
    error.statusCode = 400;
    throw error;
  }
};
