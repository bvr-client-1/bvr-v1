import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const compareSecret = async (value, configuredSecret) => {
  if (configuredSecret.startsWith('$2')) {
    return bcrypt.compare(value, configuredSecret);
  }
  return value === configuredSecret;
};

export const ownerLogin = async ({ email, password }) => {
  const emailMatches = email.toLowerCase() === env.ownerEmail.toLowerCase();
  const passwordMatches = await compareSecret(password, env.ownerPasswordHash);

  if (!emailMatches || !passwordMatches) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  return jwt.sign({ role: 'owner' }, env.jwtSecret, { expiresIn: '12h' });
};

export const kitchenLogin = async ({ password }) => {
  const passwordMatches = await compareSecret(password, env.kitchenPasswordHash);

  if (!passwordMatches) {
    const error = new Error('Wrong password. Try again.');
    error.statusCode = 401;
    throw error;
  }

  return jwt.sign({ role: 'kitchen' }, env.jwtSecret, { expiresIn: '12h' });
};
