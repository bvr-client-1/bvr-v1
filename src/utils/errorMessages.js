'use client';

const uppercaseFirst = (value) => value.charAt(0).toUpperCase() + value.slice(1);

export const getUserFacingErrorMessage = (error, fallback = 'Something went wrong. Please try again.') => {
  const responseMessage = String(error?.response?.data?.message || '').trim();
  const baseMessage = responseMessage || String(error?.message || '').trim();

  if (!baseMessage) {
    return fallback;
  }

  const normalized = baseMessage.toLowerCase();

  if (
    normalized.includes('network error') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('load failed') ||
    normalized.includes('timeout') ||
    normalized.includes('ecconnaborted')
  ) {
    return 'We could not reach the server. Please check the connection and try again.';
  }

  if (normalized.includes('cors')) {
    return 'This request was blocked by server access settings. Please verify the live frontend URL configuration.';
  }

  if (normalized.includes('internal server error')) {
    return fallback;
  }

  return uppercaseFirst(baseMessage);
};
