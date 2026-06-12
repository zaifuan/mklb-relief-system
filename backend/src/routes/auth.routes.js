// ════════════════════════════════════════════════════════════
//  Routes: /api/auth
// ════════════════════════════════════════════════════════════

import { Router } from 'express';
import { login, logout, me } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

router.post('/login', login);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, me);

// Contoh gating peranan untuk uji authorize — Super Admin sahaja.
// (Endpoint sebenar pengurusan sistem dibina pada fasa kemudian.)
router.get('/admin-check', authenticate, authorize('SUPER_ADMIN'), (req, res) => {
  res.json({ ok: true, mesej: 'Akses Super Admin disahkan', role: req.userRole });
});

export default router;
