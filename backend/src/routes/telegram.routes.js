// ════════════════════════════════════════════════════════════
//  Routes: /api/telegram  (Fasa 8 — snapshot ketidakhadiran)
//    GET  /snapshot/preview → SUPER_ADMIN + ADMIN_RELIEF
//    POST /snapshot/send    → SUPER_ADMIN sahaja
//  (Penghantaran snapshot ke group ialah tugas Super Admin.)
// ════════════════════════════════════════════════════════════

import { Router } from 'express';
import { previewSnapshot, sendSnapshot } from '../controllers/telegram.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

router.use(authenticate);

router.get('/snapshot/preview', authorize('SUPER_ADMIN', 'ADMIN_RELIEF'), previewSnapshot);
router.post('/snapshot/send', authorize('SUPER_ADMIN'), sendSnapshot);

export default router;
