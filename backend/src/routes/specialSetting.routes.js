// ════════════════════════════════════════════════════════════
//  Routes: /api/special-settings  (Tetapan Khas Jadual)
//  SUPER_ADMIN + ADMIN (sama hak seperti jana relief).
// ════════════════════════════════════════════════════════════

import { Router } from 'express';
import { options, list, add, remove } from '../controllers/specialSetting.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

router.get('/options', options); // sebelum '/'
router.get('/', list);
router.post('/', add);
router.delete('/:id', remove);

export default router;
