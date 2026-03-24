import {
  getMenuManagementItems,
  getPublicMenu,
  updateMenuItemAvailability,
} from '../services/menuService.js';

export const fetchPublicMenu = async (_req, res) => {
  const data = await getPublicMenu();
  res.json(data);
};

export const fetchMenuManagementItems = async (_req, res) => {
  const items = await getMenuManagementItems();
  res.json({ items });
};

export const patchMenuItemAvailability = async (req, res) => {
  await updateMenuItemAvailability(req.params.itemId, req.body.isAvailable);
  res.json({ success: true });
};
