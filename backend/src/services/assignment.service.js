// ════════════════════════════════════════════════════════════
//  assignment.service.js — simpan hasil jana ke pangkalan data.
//
//  Strategi (keputusan #4):
//    • Satu relief_batches setiap tarikh (status → DIJANA).
//    • Baris status DISAHKAN DIKEKALKAN (tidak disentuh).
//    • Baris status CADANGAN sedia ada DIBUANG, kemudian ditulis semula.
//    • Baris BATAL dibiarkan (tiada aliran batal di Fasa 6).
//    • Jika batch sudah DIHANTAR/SELESAI → tolak (disemak juga di sini).
//  Semua dalam satu transaksi untuk integriti.
// ════════════════════════════════════════════════════════════

import prisma from '../lib/prisma.js';
import { ReliefLockedError } from './relief.service.js';

export async function simpanReliefBatch({ tarikhDate, hari, hasil, generatedBy = null }) {
  return prisma.$transaction(async (tx) => {
    // Semak semula di dalam transaksi (elak perlumbaan)
    const sedia = await tx.reliefBatch.findUnique({ where: { tarikh: tarikhDate } });
    if (sedia && ['DIHANTAR', 'SELESAI'].includes(sedia.status)) {
      throw new ReliefLockedError(sedia.status);
    }

    // Cipta / guna batch
    let batch = sedia;
    if (!batch) {
      batch = await tx.reliefBatch.create({
        data: {
          tarikh: tarikhDate,
          status: 'DIJANA',
          generatedBy,
          generatedAt: new Date(),
        },
      });
    }

    // Buang hanya baris CADANGAN (kekalkan DISAHKAN & BATAL)
    const dibuang = await tx.reliefAssignment.deleteMany({
      where: { batchId: batch.id, status: 'CADANGAN' },
    });

    // Tulis semula baris CADANGAN baharu
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

    // Kemas kini status batch
    batch = await tx.reliefBatch.update({
      where: { id: batch.id },
      data: { status: 'DIJANA', generatedBy, generatedAt: new Date() },
    });

    return { batchId: batch.id, status: batch.status, dibuang: dibuang.count, dicipta };
  });
}
