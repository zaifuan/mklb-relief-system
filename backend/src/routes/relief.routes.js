// ════════════════════════════════════════════════════════════
//  Routes: /api/relief  (Fasa 6 — Relief Engine)
//  Semua perlu login admin (SUPER_ADMIN atau ADMIN).
// ════════════════════════════════════════════════════════════

import { Router } from 'express';
import { generateRelief, getReliefByTarikh, confirmAllByTarikh, reliefPdf } from '../controllers/relief.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

router.post('/generate', generateRelief);
router.patch('/:tarikh/confirm-all', confirmAllByTarikh);
router.get('/:tarikh/pdf', reliefPdf);
router.get('/:tarikh', getReliefByTarikh);

export default router;
