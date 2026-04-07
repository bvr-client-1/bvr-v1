import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cachePath = path.resolve(__dirname, '../data/google-reviews.json');

const fallbackReviews = [
  {
    author: 'Jeevan P.',
    relativeTime: 'Google review',
    rating: 5,
    text: 'Guests highlight the taste, clean cooking, polite staff, and a warm atmosphere that feels made for family dinners.',
  },
  {
    author: 'Kandukuri N.',
    relativeTime: 'Google review',
    rating: 5,
    text: 'The location, quick service, and biryani are getting special praise from first-time diners and regulars alike.',
  },
  {
    author: 'Poojitha',
    relativeTime: 'Google review',
    rating: 5,
    text: 'Reviewers consistently call out flavorful biryani, fast service, and presentation that feels worth the visit.',
  },
  {
    author: 'Naveen Kumar',
    relativeTime: 'Google review',
    rating: 5,
    text: 'Comfortable seating, friendly staff, and quick turnaround are common reasons people recommend the restaurant.',
  },
];

const defaultCache = {
  lastFetchedAt: null,
  source: 'fallback',
  summary: {
    name: 'Bangaru Vakili Family Restaurant',
    rating: 4.9,
    userRatingCount: 69,
  },
  reviews: fallbackReviews,
};

const readCache = async () => {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    return { ...defaultCache, ...JSON.parse(raw) };
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(cachePath, JSON.stringify(defaultCache, null, 2));
      return defaultCache;
    }
    throw error;
  }
};

const writeCache = async (cache) => {
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2));
  return cache;
};

const needsRefresh = (cache) => {
  if (!cache.lastFetchedAt) return true;
  return Date.now() - new Date(cache.lastFetchedAt).getTime() >= env.reviewSyncIntervalMs;
};

const mapReview = (review) => ({
  author: review.authorAttribution?.displayName || 'Google user',
  relativeTime: review.relativePublishTimeDescription || 'Google review',
  rating: review.rating || 5,
  text: review.text?.text || 'Shared a positive Google review.',
});

const fetchGoogleReviews = async () => {
  if (!env.googlePlacesApiKey || !env.googlePlaceId) {
    return null;
  }

  const response = await fetch(`https://places.googleapis.com/v1/places/${env.googlePlaceId}`, {
    headers: {
      'X-Goog-Api-Key': env.googlePlacesApiKey,
      'X-Goog-FieldMask': 'displayName,rating,userRatingCount,reviews',
    },
  });

  if (!response.ok) {
    throw new Error(`Google Places review fetch failed with status ${response.status}`);
  }

  const data = await response.json();
  return {
    lastFetchedAt: new Date().toISOString(),
    source: 'google_places',
    summary: {
      name: data.displayName?.text || defaultCache.summary.name,
      rating: data.rating || defaultCache.summary.rating,
      userRatingCount: data.userRatingCount || defaultCache.summary.userRatingCount,
    },
    reviews: (data.reviews || []).slice(0, 4).map(mapReview),
  };
};

export const getPublicReviews = async () => {
  const cache = await readCache();
  if (!needsRefresh(cache)) {
    return cache;
  }

  try {
    const fresh = await fetchGoogleReviews();
    if (!fresh) {
      return cache;
    }
    return await writeCache(fresh);
  } catch (error) {
    console.error('[reviews] Failed to refresh Google reviews', error.message);
    return cache;
  }
};
