// ════════════════════════════════════════════════════════════
//  Routes: /api/relief/assignment  (Fasa 7)
//  Sahkan / batal satu baris cadangan relief.
//  Akses: SUPER_ADMIN + ADMIN (hak sama).
// ════════════════════════════════════════════════════════════

import { Router } from 'express';
import { confirmAssignment, cancelAssignment, updateTeacher } from '../controllers/reliefAssignment.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

router.patch('/:id/confirm', confirmAssignment);
router.patch('/:id/cancel', cancelAssignment);
router.patch('/:id/teacher', updateTeacher);

export default router;
