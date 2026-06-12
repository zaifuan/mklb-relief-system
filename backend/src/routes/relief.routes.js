// ════════════════════════════════════════════════════════════
//  Routes: /api/relief  (Fasa 6 — Relief Engine)
//  Semua perlu login admin (SUPER_ADMIN atau ADMIN_RELIEF).
// ════════════════════════════════════════════════════════════

import { Router } from 'express';
import { generateRelief, getReliefByTarikh } from '../controllers/relief.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN_RELIEF'));

router.post('/generate', generateRelief);
router.get('/:tarikh', getReliefByTarikh);

export default router;
