import { supabase } from '../config/supabase.js';

const throwSupabaseError = (error) => {
  if (error) {
    const wrapped = new Error(error.message);
    wrapped.statusCode = 500;
    throw wrapped;
  }
};

const isMissingDeliveryPriceColumn = (error) =>
  !!error && String(`${error.code || ''} ${error.message || ''}`).toLowerCase().includes('delivery_price');

const roundUpToTen = (value) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  return Math.ceil(amount / 10) * 10;
};

const nonVegKeywords = [
  'chicken',
  'mutton',
  'fish',
  'prawn',
  'prawns',
  'crab',
  'egg',
  'eggs',
  'meat',
  'keema',
  'lamb',
  'seafood',
];

const vegKeywords = ['paneer', 'veg', 'vegetable', 'mushroom', 'gobi', 'aloo', 'dal'];

const normalizeFoodType = (value) => {
  if (value === true) return 'veg';
  if (value === false) return 'non-veg';
  if (typeof value !== 'string') return '';

  const normalized = value.trim().toLowerCase();
  if (['veg', 'vegetarian', 'v'].includes(normalized)) return 'veg';
  if (['non-veg', 'non veg', 'nonvegetarian', 'non-vegetarian', 'nv'].includes(normalized)) return 'non-veg';
  return '';
};

const resolveFoodType = (item) => {
  const explicitType =
    normalizeFoodType(item.food_type) ||
    normalizeFoodType(item.diet_type) ||
    normalizeFoodType(item.item_type) ||
    normalizeFoodType(item.is_veg);

  if (explicitType) {
    return explicitType;
  }

  const searchableText = `${item.name || ''} ${item.description || ''} ${item.menu_categories?.name || ''}`.toLowerCase();
  if (nonVegKeywords.some((keyword) => searchableText.includes(keyword))) {
    return 'non-veg';
  }
  if (vegKeywords.some((keyword) => searchableText.includes(keyword))) {
    return 'veg';
  }

  return 'veg';
};

export const getDeliveryPrice = (item) => {
  const explicitDeliveryPrice = Number(item.delivery_price);
  if (Number.isFinite(explicitDeliveryPrice) && explicitDeliveryPrice > 0) {
    return roundUpToTen(explicitDeliveryPrice);
  }

  return roundUpToTen(Number(item.price || 0) * 1.2);
};

export const getPublicMenu = async ({ priceMode = 'delivery' } = {}) => {
  const useDeliveryPrice = priceMode === 'delivery';
  const [{ data: categories, error: categoryError }, { data: items, error: itemError }] =
    await Promise.all([
      supabase.from('menu_categories').select('*').order('sort_order'),
      supabase.from('menu_items').select('*, menu_categories(name)').eq('is_available', true),
    ]);

  throwSupabaseError(categoryError);
  throwSupabaseError(itemError);

  return {
    categories: categories || [],
    items:
      items?.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description || '',
        price: useDeliveryPrice ? getDeliveryPrice(item) : item.price,
        restaurantPrice: item.price,
        deliveryPrice: getDeliveryPrice(item),
        imageUrl: item.image_url || null,
        category: item.menu_categories?.name || 'Other',
        foodType: resolveFoodType(item),
      })) || [],
  };
};

export const getMenuManagementItems = async () => {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*, menu_categories(name)')
    .order('category_id');

  throwSupabaseError(error);
  return data || [];
};

export const updateMenuItemDetails = async (itemId, updates) => {
  const payload = {};

  if (typeof updates.isAvailable === 'boolean') {
    payload.is_available = updates.isAvailable;
  }

  if (typeof updates.price === 'number') {
    payload.price = updates.price;
  }

  if (typeof updates.deliveryPrice === 'number') {
    payload.delivery_price = updates.deliveryPrice;
  }

  if (!Object.keys(payload).length) {
    return;
  }

  const { error } = await supabase.from('menu_items').update(payload).eq('id', itemId);

  if (isMissingDeliveryPriceColumn(error)) {
    const wrapped = new Error('Delivery price setup is not installed on the database yet.');
    wrapped.statusCode = 409;
    throw wrapped;
  }

  throwSupabaseError(error);
};

export const getMenuItemsByIds = async (itemIds) => {
  if (!itemIds?.length) {
    return [];
  }

  const { data, error } = await supabase
    .from('menu_items')
    .select('id, name, price, delivery_price, is_available')
    .in('id', itemIds);

  if (isMissingDeliveryPriceColumn(error)) {
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('menu_items')
      .select('id, name, price, is_available')
      .in('id', itemIds);

    throwSupabaseError(fallbackError);
    return fallbackData || [];
  }

  throwSupabaseError(error);
  return data || [];
};
