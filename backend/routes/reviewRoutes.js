import express from 'express';
import { fetchPublicReviews } from '../controllers/reviewController.js';

const router = express.Router();

router.get('/public', fetchPublicReviews);

export default router;
