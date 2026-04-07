import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildRestaurantStatus } from '../utils/restaurantStatus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeStatePath = path.resolve(__dirname, '../data/runtime-state.json');

const defaultState = {
  kitchenPaused: false,
  maintenanceMode: false,
  updatedAt: null,
  updatedByRole: null,
};

const readRuntimeState = async () => {
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

const writeRuntimeState = async (state) => {
  await fs.writeFile(runtimeStatePath, JSON.stringify(state, null, 2));
  return state;
};

export const getRestaurantStatus = async () => buildRestaurantStatus(await readRuntimeState());

export const getRuntimeState = async () => readRuntimeState();

export const updateRestaurantRuntimeState = async ({ kitchenPaused, maintenanceMode, updatedByRole }) => {
  const currentState = await readRuntimeState();
  const nextState = {
    ...currentState,
    kitchenPaused: typeof kitchenPaused === 'boolean' ? kitchenPaused : currentState.kitchenPaused,
    maintenanceMode: typeof maintenanceMode === 'boolean' ? maintenanceMode : currentState.maintenanceMode,
    updatedAt: new Date().toISOString(),
    updatedByRole,
  };

  await writeRuntimeState(nextState);
  return buildRestaurantStatus(nextState);
};
