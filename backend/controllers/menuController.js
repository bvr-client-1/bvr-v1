import {
  getMenuManagementItems,
  getPublicMenu,
  updateMenuItemDetails,
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
  await updateMenuItemDetails(req.params.itemId, {
    isAvailable: req.body.isAvailable,
    price: req.body.price,
  });
  res.json({ success: true });
};
