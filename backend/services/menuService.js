import { supabase } from '../config/supabase.js';

const throwSupabaseError = (error) => {
  if (error) {
    const wrapped = new Error(error.message);
    wrapped.statusCode = 500;
    throw wrapped;
  }
};

const isMissingDeliveryPriceColumn = (error) =>
  !!error &&
  (String(error.code) === '42703' ||
    (String(error.message || '').toLowerCase().includes('delivery_price') &&
      String(error.message || '').toLowerCase().includes('does not exist')));

const roundUpToTen = (value) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  // For small amounts (under ₹50), round to nearest ₹5 instead of ₹10
  if (amount < 50) {
    return Math.ceil(amount / 5) * 5;
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
const FOOD_SUFFIX_PATTERN = /\s*\((veg|non-veg|non veg)\s*\)\s*$/i;
const DELIVERY_PRICE_MARKER = '[[BVR_DELIVERY_PRICE:';
const DELIVERY_PRICE_PATTERN = /\s*\[\[BVR_DELIVERY_PRICE:([0-9]+(?:\.[0-9]+)?)\]\]\s*$/;

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

export const getFoodTypeLabel = (foodType) => (foodType === 'non-veg' ? 'Non-Veg' : 'Veg');

export const withFoodTypeSuffix = (name, foodType) => {
  const cleanName = String(name || '').replace(FOOD_SUFFIX_PATTERN, '').trim();
  return `${cleanName} (${getFoodTypeLabel(foodType)} )`;
};

export const getDeliveryPrice = (item) => {
  // If an explicit delivery price was set by the owner, use it as-is (no rounding)
  const explicitDeliveryPrice = Number(item.delivery_price);
  if (Number.isFinite(explicitDeliveryPrice) && explicitDeliveryPrice > 0) {
    return explicitDeliveryPrice;
  }

  // If a delivery price marker exists in the description, use it as-is
  const descriptionDeliveryPrice = String(item.description || '').match(DELIVERY_PRICE_PATTERN);
  if (descriptionDeliveryPrice) {
    return Number(descriptionDeliveryPrice[1]);
  }

  // Auto-calculate: 1.2x restaurant price, rounded up
  return roundUpToTen(Number(item.price || 0) * 1.2);
};

const stripDeliveryPriceMarker = (description = '') => String(description || '').replace(DELIVERY_PRICE_PATTERN, '').trim();

const withDeliveryPriceMarker = (description = '', deliveryPrice) =>
  `${stripDeliveryPriceMarker(description)} ${DELIVERY_PRICE_MARKER}${Number(deliveryPrice)}]]`.trim();

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
      items?.map((item) => {
        const foodType = resolveFoodType(item);
        return {
        id: item.id,
        name: withFoodTypeSuffix(item.name, foodType),
        description: stripDeliveryPriceMarker(item.description),
        price: useDeliveryPrice ? getDeliveryPrice(item) : item.price,
        restaurantPrice: item.price,
        deliveryPrice: getDeliveryPrice(item),
        imageUrl: item.image_url || null,
        category: item.menu_categories?.name || 'Other',
        foodType,
        };
      }) || [],
  };
};

export const getMenuManagementItems = async () => {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*, menu_categories(name)')
    .order('category_id');

  throwSupabaseError(error);
  return (data || []).map((item) => ({
    ...item,
    description: stripDeliveryPriceMarker(item.description),
    foodType: resolveFoodType(item),
    display_name: withFoodTypeSuffix(item.name, resolveFoodType(item)),
  }));
};

export const updateMenuItemDetails = async (itemId, updates) => {
  const payload = {};

  if (typeof updates.isAvailable === 'boolean') {
    payload.is_available = updates.isAvailable;
  }

  if (typeof updates.price === 'number') {
    payload.price = updates.price;
  }

  const hasDeliveryPriceUpdate = typeof updates.deliveryPrice === 'number';

  if (hasDeliveryPriceUpdate) {
    payload.delivery_price = updates.deliveryPrice;
  }

  if (!Object.keys(payload).length) {
    return;
  }

  const { error } = await supabase.from('menu_items').update(payload).eq('id', itemId);

  if (isMissingDeliveryPriceColumn(error)) {
    if (hasDeliveryPriceUpdate) {
      const { data: currentItem, error: fetchError } = await supabase
        .from('menu_items')
        .select('description')
        .eq('id', itemId)
        .single();

      throwSupabaseError(fetchError);

      const fallbackPayload = { ...payload };
      delete fallbackPayload.delivery_price;
      fallbackPayload.description = withDeliveryPriceMarker(currentItem?.description, updates.deliveryPrice);

      const { error: fallbackError } = await supabase.from('menu_items').update(fallbackPayload).eq('id', itemId);
      throwSupabaseError(fallbackError);
      return;
    }

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
      .select('id, name, price, description, is_available')
      .in('id', itemIds);

    throwSupabaseError(fallbackError);
    return (fallbackData || []).map((item) => ({
      ...item,
      description: stripDeliveryPriceMarker(item.description),
      foodType: resolveFoodType(item),
      display_name: withFoodTypeSuffix(item.name, resolveFoodType(item)),
    }));
  }

  throwSupabaseError(error);
  return (data || []).map((item) => ({
    ...item,
    description: stripDeliveryPriceMarker(item.description),
    foodType: resolveFoodType(item),
    display_name: withFoodTypeSuffix(item.name, resolveFoodType(item)),
  }));
};

const findOrCreateCategory = async (categoryName) => {
  const normalizedName = String(categoryName || 'Daily Specials').trim() || 'Daily Specials';
  const { data: existing, error: existingError } = await supabase
    .from('menu_categories')
    .select('*')
    .ilike('name', normalizedName)
    .limit(1)
    .maybeSingle();

  throwSupabaseError(existingError);
  if (existing) return existing;

  const { data: lastCategory, error: lastError } = await supabase
    .from('menu_categories')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  throwSupabaseError(lastError);

  const { data, error } = await supabase
    .from('menu_categories')
    .insert({
      name: normalizedName,
      sort_order: Number(lastCategory?.sort_order || 0) + 1,
    })
    .select()
    .single();

  throwSupabaseError(error);
  return data;
};

export const createMenuItem = async ({ name, categoryName, price, deliveryPrice, foodType = 'veg' }) => {
  const category = await findOrCreateCategory(categoryName);
  const normalizedFoodType = normalizeFoodType(foodType) || 'veg';
  const restaurantPrice = Number(price);
  const nextDeliveryPrice = Number.isFinite(Number(deliveryPrice)) && Number(deliveryPrice) > 0
    ? Number(deliveryPrice)
    : roundUpToTen(restaurantPrice * 1.2);
  const payload = {
    name: withFoodTypeSuffix(name, normalizedFoodType),
    category_id: category.id,
    price: restaurantPrice,
    is_available: true,
  };

  const { data, error } = await supabase.from('menu_items').insert(payload).select('*, menu_categories(name)').single();
  throwSupabaseError(error);

  const item = {
    ...data,
    foodType: resolveFoodType(data),
    display_name: withFoodTypeSuffix(data.name, resolveFoodType(data)),
  };

  if (Number.isFinite(nextDeliveryPrice) && nextDeliveryPrice > 0) {
    try {
      await updateMenuItemDetails(item.id, { deliveryPrice: nextDeliveryPrice });
      item.delivery_price = nextDeliveryPrice;
    } catch (deliveryError) {
      if (!isMissingDeliveryPriceColumn(deliveryError)) {
        throw deliveryError;
      }
    }
  }

  return item;
};
