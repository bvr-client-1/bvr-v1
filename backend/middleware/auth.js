import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const requireAuth = (role) => (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    if (role && payload.role !== role) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
};
