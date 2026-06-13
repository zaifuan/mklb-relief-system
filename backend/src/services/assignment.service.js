// ════════════════════════════════════════════════════════════
//  assignment.service.js — simpan hasil jana ke pangkalan data.
//
//  Strategi:
//    • Satu relief_batches setiap tarikh (status → DIJANA).
//    • Jana Semula GANTI PENUH: SEMUA baris lama tarikh itu dibuang, kemudian
//      ditulis semula daripada rekod ketidakhadiran AKTIF semasa.
//    • Tiada konsep DISAHKAN/lock — jadual relief ialah draf/cadangan.
//    • Jika batch sudah DIHANTAR/SELESAI → tolak (pengaman; tidak berlaku
//      dalam aliran semasa).
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

    // Jana Semula = GANTI PENUH: buang SEMUA baris lama batch ini, kemudian
    // tulis semula berdasarkan rekod ketidakhadiran AKTIF semasa sahaja.
    // (Tiada lagi konsep "kekalkan DISAHKAN" — jadual dianggap draf/cadangan.)
    const dibuang = await tx.reliefAssignment.deleteMany({
      where: { batchId: batch.id },
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
