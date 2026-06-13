// ════════════════════════════════════════════════════════════
//  Routes: /api/absence
// ════════════════════════════════════════════════════════════

import { Router } from 'express';
import { getPublicOptions, createAbsence, checkPublic, cancelPublic, getAbsence } from '../controllers/absence.controller.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

// Awam (tiada login)
router.get('/public/options', getPublicOptions);
router.get('/public/check', checkPublic); // semak rekod guru ikut nama + tarikh
router.post('/', createAbsence);
router.patch('/public/:id/cancel', cancelPublic); // guru batal rekod sendiri

// Admin (perlu login)
router.get('/:id', authenticate, getAbsence);

export default router;
