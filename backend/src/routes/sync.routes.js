// ════════════════════════════════════════════════════════════
//  Routes: /api/sync
// ════════════════════════════════════════════════════════════

import { Router } from 'express';
import { runSync, syncStatus } from '../controllers/sync.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

// Jalankan sync — SUPER_ADMIN sahaja
router.post('/run', authenticate, authorize('SUPER_ADMIN'), runSync);

// Status sync — mana-mana admin yang login
router.get('/status', authenticate, syncStatus);

export default router;
