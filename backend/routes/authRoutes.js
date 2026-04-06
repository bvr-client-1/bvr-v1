import express from 'express';
import Joi from 'joi';
import { loginKitchen, loginOwner } from '../controllers/authController.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();

router.post(
  '/owner/login',
  validate(
    Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().min(3).required(),
    }),
  ),
  loginOwner,
);

router.post(
  '/kitchen/login',
  validate(
    Joi.object({
      loginId: Joi.string().min(3).required(),
      password: Joi.string().min(3).required(),
    }),
  ),
  loginKitchen,
);

export default router;
