// ════════════════════════════════════════════════════════════
//  Controller: sync
//  runSync (POST /api/sync/run) · syncStatus (GET /api/sync/status)
// ════════════════════════════════════════════════════════════

import { runSync as runSyncService } from '../services/sync.service.js';
import { latestSync } from '../lib/syncAudit.js';
import { getClientIp } from '../lib/audit.js';

const STATUS_LABEL = { OK: 'SUCCESS', FAIL: 'FAILED', RUNNING: 'RUNNING' };

export async function runSync(req, res) {
  try {
    const stats = await runSyncService({ userId: req.user?.id ?? null, ip: getClientIp(req) });
    res.json({ success: true, ...stats });
  } catch (err) {
    if (err.code === 'SYNC_RUNNING') {
      return res.status(409).json({ success: false, mesej: err.message });
    }
    res.status(500).json({ success: false, mesej: err.message });
  }
}

export async function syncStatus(req, res) {
  try {
    const last = await latestSync();
    if (!last) {
      return res.json({ lastSyncAt: null, lastSyncStatus: 'NEVER', durationMs: null });
    }

    const stats = last.recordsSynced || {};
    res.json({
      lastSyncAt: last.finishedAt || last.startedAt,
      lastSyncStatus: STATUS_LABEL[last.status] || last.status,
      durationMs: stats.durationMs ?? null,
      counts: {
        guru: stats.guru ?? null,
        jadual: stats.jadual ?? null,
        jadualKelas: stats.jadualKelas ?? null,
        pengecualian: stats.pengecualian ?? null,
      },
      error: last.error || null,
    });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}
