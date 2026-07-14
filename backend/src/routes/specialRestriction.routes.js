// ════════════════════════════════════════════════════════════
//  Routes: /api/special-restrictions  (Sekatan Khas Relief)
//  SUPER_ADMIN SAHAJA. Admin biasa TIDAK boleh melihat atau mengubah
//  (berbeza daripada /api/special-settings yang benarkan SUPER_ADMIN+ADMIN).
// ════════════════════════════════════════════════════════════

import { Router } from 'express';
import { options, list, create, update, activate, deactivate, remove } from '../controllers/specialRestriction.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

router.use(authenticate, authorize('SUPER_ADMIN'));

router.get('/options', options); // sebelum '/'
router.get('/', list);
router.post('/', create);
router.patch('/:id/activate', activate); // sebelum '/:id' generik
router.patch('/:id/deactivate', deactivate);
router.patch('/:id', update);
router.delete('/:id', remove);

export default router;
