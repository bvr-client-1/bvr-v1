import { kitchenLogin, ownerLogin } from '../services/authService.js';

export const loginOwner = async (req, res) => {
  const token = await ownerLogin(req.body);
  res.json({ token, role: 'owner' });
};

export const loginKitchen = async (req, res) => {
  const token = await kitchenLogin(req.body);
  res.json({ token, role: 'kitchen' });
};
