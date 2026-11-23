// ════════════════════════════════════════════════════════════
//  assignment.service.js — simpan hasil jana ke pangkalan data.
//
//  Strategi:
//    • Satu relief_batches setiap tarikh (status → DIJANA).
//    • K05: Jana Semula MENGEKALKAN tugasan DISAHKAN, BATAL dan diubah manual
//      yang slotnya masih diperlukan (id/guru/kelas/masa/status tidak berubah);
//      baris CADANGAN enjin lain dibuang & ditulis semula.
//    • Jika batch sudah DIHANTAR/SELESAI → tolak (disemak semula di bawah kunci).
//  Semua dalam satu transaksi + kunci baris batch untuk integriti.
// ════════════════════════════════════════════════════════════

import prisma from '../lib/prisma.js';
import { ReliefLockedError, dikekalkan, capKekal } from './relief.service.js';

const TERKUNCI = ['DIHANTAR', 'SELESAI'];

// K05 — ralat: tugasan dikekalkan berubah semasa penjanaan (admin lain) → 409, cuba lagi
export class BatchBerubahError extends Error {
  constructor() {
    super('Jadual relief telah diubah oleh pengguna lain semasa penjanaan. Sila muat semula dan cuba lagi.');
    this.code = 'BERUBAH';
  }
}

// K05 — kunci baris batch (PostgreSQL SELECT … FOR UPDATE) dalam transaksi.
//  Semua penulis batch/tugasan (jana, kosongkan, tukar guru, sahkan, batal)
//  mengambil kunci ini → operasi pada TARIKH yang sama berlaku bersiri.
export async function kunciBatch(tx, batchId) {
  await tx.$queryRaw`SELECT id FROM relief_batches WHERE id = ${batchId} FOR UPDATE`;
  return tx.reliefBatch.findUnique({ where: { id: batchId } });
}

export async function simpanReliefBatch({ tarikhDate, hari, hasil, generatedBy = null, kekal = null }) {
  return prisma.$transaction(async (tx) => {
    let batch = await tx.reliefBatch.findUnique({ where: { tarikh: tarikhDate } });
    if (batch) batch = await kunciBatch(tx, batch.id);
    if (batch && TERKUNCI.includes(batch.status)) throw new ReliefLockedError(batch.status);

    const kekalIds = kekal?.ids || [];
    if (batch) {
      // Set tugasan dikekalkan mesti SAMA seperti yang digunakan enjin
      const semasa = await tx.reliefAssignment.findMany({ where: { batchId: batch.id } });
      if (capKekal(semasa) !== (kekal?.cap ?? '')) throw new BatchBerubahError();
    } else {
      if (kekalIds.length) throw new BatchBerubahError();
      batch = await tx.reliefBatch.create({
        data: { tarikh: tarikhDate, status: 'DIJANA', generatedBy, generatedAt: new Date() },
      });
    }

    // Buang semua baris KECUALI tugasan dikekalkan yang masih diperlukan
    //  (baris CADANGAN enjin + tugasan dikekalkan yang slotnya tidak lagi diperlukan)
    const dibuang = await tx.reliefAssignment.deleteMany({
      where: { batchId: batch.id, id: { notIn: kekalIds } },
    });

    let dicipta = 0;
    if (hasil.length) {
      const rows = hasil.map((r) => ({
        batchId: batch.id,
        guruTakHadir: r.guruTakHadir,
        tarikh: tarikhDate,
        kelas: r.kelas,
        masa: r.masa,
        hari: r.hari || hari,
        guruGanti: r.guruGanti,
        kategori: r.kategori,
        status: 'CADANGAN',
        isTier2: !!r.isTier2,
        auditNote: r.auditNote,
        subjek: r.subjek,
        updatedBy: generatedBy,
      }));
      const res = await tx.reliefAssignment.createMany({ data: rows });
      dicipta = res.count;
    }

    batch = await tx.reliefBatch.update({
      where: { id: batch.id },
      data: { status: 'DIJANA', generatedBy, generatedAt: new Date() },
    });

    return { batchId: batch.id, status: batch.status, dibuang: dibuang.count, dicipta, dikekalkan: kekalIds.length };
  });
}

// K05 — Isu A: kosongkan batch apabila tiada lagi slot perlu relief.
//  Di dalam transaksi + kunci; batch DIHANTAR/SELESAI TIDAK SEKALI-KALI dipadam.
export async function kosongkanBatch(tarikhDate) {
  return prisma.$transaction(async (tx) => {
    let batch = await tx.reliefBatch.findUnique({ where: { tarikh: tarikhDate } });
    if (!batch) return { batchDibuang: 0, tugasanKekalDibuang: [] };
    batch = await kunciBatch(tx, batch.id);
    if (TERKUNCI.includes(batch.status)) throw new ReliefLockedError(batch.status);
    const rows = await tx.reliefAssignment.findMany({ where: { batchId: batch.id } });
    const r = await tx.reliefBatch.deleteMany({ where: { id: batch.id, status: { notIn: TERKUNCI } } });
    return {
      batchDibuang: r.count,
      tugasanKekalDibuang: rows.filter(dikekalkan).map((a) => ({ id: a.id, kelas: a.kelas, masa: a.masa, guruGanti: a.guruGanti, status: a.status, diubahManual: !!a.diubahManual })),
    };
  });
}
