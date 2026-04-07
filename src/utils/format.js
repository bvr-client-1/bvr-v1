'use client';

import { CAT_EMOJI } from './constants.js';

export const formatPrice = (amount) => `₹${amount}`;

export const formatTime = (isoString) => {
  try {
    return new Date(isoString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '—';
  }
};

export const timeAgo = (isoString) => {
  try {
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)} mins ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hrs ago`;
    return `${Math.floor(diff / 86400)} days ago`;
  } catch {
    return '—';
  }
};

export const getCatEmoji = (category) => CAT_EMOJI[(category || '').toLowerCase()] || '🍽️';
