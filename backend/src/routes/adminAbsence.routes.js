// ════════════════════════════════════════════════════════════
//  Routes: /api/admin/absence  (Fasa 5)
//  Semua perlu login admin. Padam (DELETE) = SUPER_ADMIN sahaja.
// ════════════════════════════════════════════════════════════

import { Router } from 'express';
import {
  listAbsence,
  summary,
  getAbsence,
  updateStatus,
  cancelGroup,
  removeAbsence,
} from '../controllers/adminAbsence.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

// Semua endpoint: SUPER_ADMIN atau ADMIN_RELIEF
router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN_RELIEF'));

router.get('/', listAbsence);
router.get('/summary', summary); // sebelum /:id
router.patch('/group/:groupReference/cancel', cancelGroup); // batal kumpulan (sebelum /:id)
router.get('/:id', getAbsence);
router.patch('/:id/status', updateStatus);

// Padam: SUPER_ADMIN sahaja
router.delete('/:id', authorize('SUPER_ADMIN'), removeAbsence);

export default router;
