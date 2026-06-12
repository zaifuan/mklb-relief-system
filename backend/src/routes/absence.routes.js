// ════════════════════════════════════════════════════════════
//  Routes: /api/absence
// ════════════════════════════════════════════════════════════

import { Router } from 'express';
import { getPublicOptions, createAbsence, getAbsence } from '../controllers/absence.controller.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

// Awam (tiada login)
router.get('/public/options', getPublicOptions);
router.post('/', createAbsence);

// Admin (perlu login)
router.get('/:id', authenticate, getAbsence);

export default router;
