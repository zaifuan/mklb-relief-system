// ════════════════════════════════════════════════════════════
//  Controller: telegramCron (Fasa 9) — pencetus snapshot pagi.
//    POST /api/telegram/cron/snapshot  (dilindungi CRON_SECRET)
//  Untuk: host crontab luaran (sandaran) ATAU ujian manual aliran auto.
//  Tidak menyentuh snapshot manual Fasa 8.
// ════════════════════════════════════════════════════════════

import { runMorningSnapshot } from '../services/telegramNotify.service.js';

export async function cronSnapshot(req, res) {
  const force = req.query.force === 'true' || req.body?.force === true;
  try {
    const hasil = await runMorningSnapshot({ force });
    return res.json(hasil);
  } catch (err) {
    console.error('cronSnapshot ERROR:', err);
    return res.status(500).json({ status: 'ERROR', mesej: 'Ralat cron snapshot', error: err.message });
  }
}
