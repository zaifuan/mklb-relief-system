// ════════════════════════════════════════════════════════════
//  Routes: /api/telegram
//    GET  /snapshot/preview → SUPER_ADMIN + ADMIN
//    POST /snapshot/send    → SUPER_ADMIN sahaja
//    GET  /settings         → SUPER_ADMIN + ADMIN
//    PATCH /settings        → SUPER_ADMIN sahaja
//    GET  /status           → SUPER_ADMIN + ADMIN
// ════════════════════════════════════════════════════════════

import { Router } from 'express';
import {
  previewSnapshot,
  sendSnapshot,
  getSettings,
  updateSettings,
  getStatus,
} from '../controllers/telegram.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

router.use(authenticate);

router.get('/snapshot/preview', authorize('SUPER_ADMIN', 'ADMIN'), previewSnapshot);
router.post('/snapshot/send', authorize('SUPER_ADMIN'), sendSnapshot);

router.get('/settings', authorize('SUPER_ADMIN', 'ADMIN'), getSettings);
router.patch('/settings', authorize('SUPER_ADMIN'), updateSettings);
router.get('/status', authorize('SUPER_ADMIN', 'ADMIN'), getStatus);

export default router;
