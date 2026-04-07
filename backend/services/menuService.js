import { supabase } from '../config/supabase.js';

const throwSupabaseError = (error) => {
  if (error) {
    const wrapped = new Error(error.message);
    wrapped.statusCode = 500;
    throw wrapped;
  }
};

export const getPublicMenu = async () => {
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
        price: item.price,
        imageUrl: item.image_url || null,
        category: item.menu_categories?.name || 'Other',
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

export const updateMenuItemAvailability = async (itemId, isAvailable) => {
  const { error } = await supabase
    .from('menu_items')
    .update({ is_available: isAvailable })
    .eq('id', itemId);

  throwSupabaseError(error);
};

export const getMenuItemsByIds = async (itemIds) => {
  if (!itemIds?.length) {
    return [];
  }

  const { data, error } = await supabase
    .from('menu_items')
    .select('id, name, price, is_available')
    .in('id', itemIds);

  throwSupabaseError(error);
  return data || [];
};
