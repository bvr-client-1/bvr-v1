import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../config/supabase.js';
import { buildRestaurantStatus } from '../utils/restaurantStatus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeStatePath = path.resolve(__dirname, '../data/runtime-state.json');

const defaultState = {
  kitchenPaused: false,
  maintenanceMode: false,
  tableCount: 16,
  deliveryRadiusKm: 4,
  updatedAt: null,
  updatedByRole: null,
};

const readLocalState = async () => {
  try {
    const raw = await fs.readFile(runtimeStatePath, 'utf8');
    return { ...defaultState, ...JSON.parse(raw) };
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(runtimeStatePath, JSON.stringify(defaultState, null, 2));
      return { ...defaultState };
    }
    throw error;
  }
};

const writeLocalState = async (state) => {
  try {
    await fs.writeFile(runtimeStatePath, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('[restaurantService] Failed to write local runtime state file:', error.message);
  }
  return state;
};

export const getRuntimeState = async () => {
  try {
    const { data, error } = await supabase
      .from('restaurant_runtime_state')
      .select('*')
      .eq('key', 'default')
      .maybeSingle();

    if (error) {
      if (String(error.code) === '42P01' || String(error.message).includes('does not exist')) {
        console.warn('[restaurantService] restaurant_runtime_state table not found in Supabase. Falling back to local JSON state.');
        return readLocalState();
      }
      throw error;
    }

    if (data) {
      return {
        kitchenPaused: data.kitchen_paused,
        maintenanceMode: data.maintenance_mode,
        tableCount: Number(data.table_count),
        deliveryRadiusKm: Number(data.delivery_radius_km),
        updatedAt: data.updated_at,
        updatedByRole: data.updated_by_role,
      };
    }

    const defaultPayload = {
      key: 'default',
      kitchen_paused: defaultState.kitchenPaused,
      maintenance_mode: defaultState.maintenanceMode,
      table_count: defaultState.tableCount,
      delivery_radius_km: defaultState.deliveryRadiusKm,
      updated_at: new Date().toISOString(),
      updated_by_role: 'system',
    };
    const { error: insertError } = await supabase.from('restaurant_runtime_state').insert(defaultPayload);
    if (!insertError) {
      return defaultState;
    }
  } catch (err) {
    console.error('[restaurantService] Supabase read state failed, falling back to local file. Error:', err.message);
  }

  return readLocalState();
};

export const getRestaurantStatus = async () => buildRestaurantStatus(await getRuntimeState());

export const updateRestaurantRuntimeState = async ({ kitchenPaused, maintenanceMode, tableCount, deliveryRadiusKm, updatedByRole }) => {
  const currentState = await getRuntimeState();
  const nextState = {
    ...currentState,
    kitchenPaused: typeof kitchenPaused === 'boolean' ? kitchenPaused : currentState.kitchenPaused,
    maintenanceMode: typeof maintenanceMode === 'boolean' ? maintenanceMode : currentState.maintenanceMode,
    tableCount: Number.isFinite(Number(tableCount)) ? Number(tableCount) : currentState.tableCount,
    deliveryRadiusKm: Number.isFinite(Number(deliveryRadiusKm)) ? Number(deliveryRadiusKm) : currentState.deliveryRadiusKm,
    updatedAt: new Date().toISOString(),
    updatedByRole,
  };

  await writeLocalState(nextState);

  try {
    const { error } = await supabase
      .from('restaurant_runtime_state')
      .update({
        kitchen_paused: nextState.kitchenPaused,
        maintenance_mode: nextState.maintenanceMode,
        table_count: nextState.tableCount,
        delivery_radius_km: nextState.deliveryRadiusKm,
        updated_at: nextState.updatedAt,
        updated_by_role: nextState.updatedByRole,
      })
      .eq('key', 'default');

    if (error && String(error.code) !== '42P01' && !String(error.message).includes('does not exist')) {
      console.error('[restaurantService] Supabase update state error:', error.message);
    }
  } catch (err) {
    console.error('[restaurantService] Supabase update state failed:', err.message);
  }

  return buildRestaurantStatus(nextState);
};
