// ════════════════════════════════════════════════════════════
//  sync.service — orchestrator penyegerakan Google Sheet → PostgreSQL
//  Aliran: kunci → baca 3 tab MASTER → validasi → tulis (1 transaction)
//          → kemaskini sync_logs + audit_logs → pulang statistik.
//
//  SKOP (keputusan): server mini PC hanya import DATA MASTER JADUAL:
//    • KATEGORI GURU  → teachers / teacher_categories
//    • JADUAL GURU    → teacher_schedule
//    • JADUAL KELAS   → class_schedule
//
//  Tab OPERASI GAS TIDAK disync (diurus dalam PostgreSQL):
//    pengecualian_relief, ketidakhadiran, penggantian, log, dsb.
//  → 'pengecualian_relief' SENGAJA tidak dibaca; relief_exclusions
//    TIDAK disentuh semasa sync (data PostgreSQL kekal).
// ════════════════════════════════════════════════════════════

import prisma from '../lib/prisma.js';
import { startSync, finishSyncOk, finishSyncFail, findRunningSync } from '../lib/syncAudit.js';
import { writeAudit } from '../lib/audit.js';
import { TABS } from './sheetConfig.js';
import { fetchTab } from './googleSheet.service.js';
import { prepareGuru, writeGuru } from './syncGuru.service.js';
import { prepareJadual, writeJadual } from './syncJadual.service.js';
import { prepareJadualKelas, writeJadualKelas } from './syncJadualKelas.service.js';

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
    // 2) Baca HANYA 3 tab master (tab operasi GAS tidak dibaca langsung)
    const [rawGuru, rawJadual, rawKelas] = await Promise.all([
      fetchTab(TABS.guru),
      fetchTab(TABS.jadual),
      fetchTab(TABS.jadualKelas),
    ]);

    // 3) Validasi + sediakan (baling jika ralat struktur — sebelum sebarang tulisan)
    const pGuru = prepareGuru(rawGuru);
    const pJadual = prepareJadual(rawJadual);
    const pKelas = prepareJadualKelas(rawKelas);

    // 4) Tulis dalam SATU transaction (all-or-nothing) — master sahaja.
    //    Tiada sentuhan ke relief_exclusions / absence_records / relief_*.
    const result = await prisma.$transaction(
      async (tx) => {
        const guru = await writeGuru(tx, pGuru);
        const jadual = await writeJadual(tx, pJadual);
        const jadualKelas = await writeJadualKelas(tx, pKelas);
        return { guru, jadual, jadualKelas };
      },
      { timeout: 120000, maxWait: 20000 }
    );

    const durationMs = Date.now() - started;

    const stats = {
      guru: result.guru.upserted,
      guruDinyahaktif: result.guru.deactivated,
      jadual: result.jadual,
      jadualKelas: result.jadualKelas,
      pengecualian: 0, // tidak disync
      durationMs,
      dilangkau: {
        guru: pGuru.skipped,
        jadual: pJadual.skipped,
        jadualKelas: pKelas.skipped,
        pengecualian: true, // tab pengecualian_relief sengaja dilangkau (diurus dalam PostgreSQL)
      },
      isu: [],
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
