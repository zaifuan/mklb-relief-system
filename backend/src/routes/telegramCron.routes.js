// ════════════════════════════════════════════════════════════
//  Routes: /api/telegram/cron  (Fasa 9)
//  Dilindungi header x-cron-secret (CRON_SECRET) — BUKAN JWT,
//  kerana dipanggil oleh cron/host, bukan pengguna.
// ════════════════════════════════════════════════════════════

import { Router } from 'express';
import { cronSnapshot } from '../controllers/telegramCron.controller.js';

function verifyCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ mesej: 'CRON_SECRET belum diset pada server.' });
  }
  if (req.get('x-cron-secret') !== secret) {
    return res.status(401).json({ mesej: 'Cron secret tidak sah.' });
  }
  next();
}

const router = Router();

router.post('/snapshot', verifyCronSecret, cronSnapshot);

export default router;
