import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const compareSecret = async (value, configuredSecret) => {
  if (configuredSecret.startsWith('$2')) {
    return bcrypt.compare(value, configuredSecret);
  }
  return value === configuredSecret;
};

const signAuthToken = (role) =>
  jwt.sign({ role }, env.jwtSecret, {
    expiresIn: '12h',
    issuer: env.jwtIssuer,
    audience: env.jwtAudience,
    subject: role,
  });

export const ownerLogin = async ({ email, password }) => {
  const emailMatches = email.toLowerCase() === env.ownerEmail.toLowerCase();
  const passwordMatches = await compareSecret(password, env.ownerPasswordHash);

  if (!emailMatches || !passwordMatches) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  return signAuthToken('owner');
};

export const kitchenLogin = async ({ loginId, password }) => {
  const loginIdMatches = loginId === env.kitchenLoginId;
  const passwordMatches = await compareSecret(password, env.kitchenPasswordHash);

  if (!loginIdMatches || !passwordMatches) {
    const error = new Error('Invalid kitchen ID or password');
    error.statusCode = 401;
    throw error;
  }

  return signAuthToken('kitchen');
};
