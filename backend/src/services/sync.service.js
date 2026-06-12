// ════════════════════════════════════════════════════════════
//  sync.service — orchestrator penyegerakan Google Sheet → PostgreSQL
//  Aliran: kunci → baca semua tab → validasi → tulis (1 transaction)
//          → kemaskini sync_logs + audit_logs → pulang statistik.
// ════════════════════════════════════════════════════════════

import prisma from '../lib/prisma.js';
import { startSync, finishSyncOk, finishSyncFail, findRunningSync } from '../lib/syncAudit.js';
import { writeAudit } from '../lib/audit.js';
import { TABS, SYNC_PENGECUALIAN } from './sheetConfig.js';
import { fetchTab } from './googleSheet.service.js';
import { prepareGuru, writeGuru } from './syncGuru.service.js';
import { prepareJadual, writeJadual } from './syncJadual.service.js';
import { prepareJadualKelas, writeJadualKelas } from './syncJadualKelas.service.js';
import { preparePengecualian, writePengecualian } from './syncPengecualian.service.js';

const STALE_RUNNING_MS = 15 * 60 * 1000; // anggap RUNNING > 15 minit sebagai tersekat

export async function runSync({ userId = null, ip = null } = {}) {
  // 1) Kunci ringkas — elak dua sync serentak
  const running = await findRunningSync();
  if (running && Date.now() - new Date(running.startedAt).getTime() < STALE_RUNNING_MS) {
    const e = new Error('Sync sedang berjalan. Sila tunggu sehingga ia selesai.');
    e.code = 'SYNC_RUNNING';
    throw e;
  }

  const started = Date.now();
  const log = await startSync();

  try {
    // 2) Baca semua tab (panggilan luaran, belum sentuh DB)
    const fetches = [
      fetchTab(TABS.guru),
      fetchTab(TABS.jadual),
      fetchTab(TABS.jadualKelas),
    ];
    if (SYNC_PENGECUALIAN) fetches.push(fetchTab(TABS.pengecualian));

    const [rawGuru, rawJadual, rawKelas, rawPeng] = await Promise.all(fetches);

    // 3) Validasi + sediakan (baling jika ralat struktur — sebelum sebarang tulisan)
    const pGuru = prepareGuru(rawGuru);
    const pJadual = prepareJadual(rawJadual);
    const pKelas = prepareJadualKelas(rawKelas);
    const pPeng = SYNC_PENGECUALIAN ? preparePengecualian(rawPeng) : null;

    // 4) Tulis dalam SATU transaction (all-or-nothing)
    const result = await prisma.$transaction(
      async (tx) => {
        const guru = await writeGuru(tx, pGuru);
        const jadual = await writeJadual(tx, pJadual);
        const jadualKelas = await writeJadualKelas(tx, pKelas);
        const pengecualian = pPeng ? await writePengecualian(tx, pPeng) : 0;
        return { guru, jadual, jadualKelas, pengecualian };
      },
      { timeout: 120000, maxWait: 20000 }
    );

    const durationMs = Date.now() - started;

    const stats = {
      guru: result.guru.upserted,
      guruDinyahaktif: result.guru.deactivated,
      jadual: result.jadual,
      jadualKelas: result.jadualKelas,
      pengecualian: result.pengecualian,
      durationMs,
      dilangkau: {
        guru: pGuru.skipped,
        jadual: pJadual.skipped,
        jadualKelas: pKelas.skipped,
        pengecualian: pPeng ? pPeng.skipped : 0,
      },
      isu: pPeng ? pPeng.issues : [],
    };

    await finishSyncOk(log.id, stats);
    await writeAudit({ userId, action: 'SYNC_RUN', entity: 'SYNC', detail: stats, ip });

    return stats;
  } catch (err) {
    await finishSyncFail(log.id, err.message);
    await writeAudit({
      userId,
      action: 'SYNC_FAIL',
      entity: 'SYNC',
      detail: { error: err.message },
      ip,
    });
    throw err;
  }
}
