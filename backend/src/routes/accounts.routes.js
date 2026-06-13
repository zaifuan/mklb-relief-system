// ════════════════════════════════════════════════════════════
//  Routes: /api/admin/accounts  (Tetapan Akaun)
//  SUPER_ADMIN sahaja. Admin biasa tidak boleh akses.
// ════════════════════════════════════════════════════════════

import { Router } from 'express';
import { getAccounts, updateAccounts } from '../controllers/accounts.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

router.use(authenticate, authorize('SUPER_ADMIN'));

router.get('/', getAccounts);
router.patch('/', updateAccounts);

export default router;
