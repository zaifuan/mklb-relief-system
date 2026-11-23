// ════════════════════════════════════════════════════════════
//  Controller: reliefAssignment (Fasa 7 — semakan cadangan relief)
//    confirmAssignment  PATCH /api/relief/assignment/:id/confirm
//    cancelAssignment   PATCH /api/relief/assignment/:id/cancel
//
//  Peraturan (keputusan Fasa 7):
//    • Transisi hanya sah dari CADANGAN. Jika sudah DISAHKAN/BATAL → 409.
//    • Jika batch induk DIHANTAR/SELESAI → 409 (kekal kunci Fasa 6).
//    • Batch KEKAL status DIJANA (tiada auto-transisi).
//    • TIDAK menyentuh Relief Engine — hanya kemas kini status satu baris.
// ════════════════════════════════════════════════════════════

import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { writeAudit, getClientIp } from '../lib/audit.js';
import { kunciBatch } from '../services/assignment.service.js';
import { bacaKonteksHari, TIADA_PENGGANTI } from '../services/relief.service.js';
import { semakGuruManual } from '../services/candidate.service.js';
import { parseMasa } from '../lib/timeUtil.js';

const normN = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');

// K05 — ralat terkawal di dalam transaksi → respons HTTP
class Tolak extends Error {
  constructor(status, body) {
    super(body.mesej);
    this.status = status;
    this.body = body;
  }
}

const BATCH_TERKUNCI = ['DIHANTAR', 'SELESAI'];

// Logik kongsi untuk confirm & cancel
async function transisi(req, res, { toStatus, action }) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ mesej: 'ID baris tidak sah' });
  }

  try {
    const b0 = await prisma.reliefAssignment.findUnique({ where: { id } });
    if (!b0) {
      return res.status(404).json({ mesej: 'Baris relief tidak dijumpai' });
    }

    // K05: transaksi + kunci batch — bersiri dengan Jana Semula / tukar guru
    const { baris, updated } = await prisma.$transaction(async (tx) => {
      const batch = await kunciBatch(tx, b0.batchId);
      const baris = await tx.reliefAssignment.findUnique({ where: { id } });
      if (!baris) throw new Tolak(404, { mesej: 'Baris relief tidak dijumpai' });

      // Kunci batch (selaras Fasa 6)
      if (batch && BATCH_TERKUNCI.includes(batch.status)) {
        throw new Tolak(409, { mesej: `Batch sudah ${batch.status} — baris tidak boleh diubah.`, statusBatch: batch.status });
      }

      // Hanya sah dari CADANGAN
      if (baris.status !== 'CADANGAN') {
        throw new Tolak(409, { mesej: `Baris bukan CADANGAN (status sekarang: ${baris.status}).`, statusBaris: baris.status });
      }

      const updated = await tx.reliefAssignment.update({
        where: { id },
        data: { status: toStatus, updatedBy: req.user?.username || null },
      });
      return { baris, updated };
    });

    await writeAudit({
      userId: req.user?.id || null,
      action,
      entity: `relief_assignment:${id}`,
      detail: {
        batchId: baris.batchId,
        tarikh: baris.tarikh,
        guruTakHadir: baris.guruTakHadir,
        kelas: baris.kelas,
        masa: baris.masa,
        guruGanti: baris.guruGanti,
        dari: 'CADANGAN',
        ke: toStatus,
      },
      ip: getClientIp(req),
    });

    res.json({ id: updated.id, status: updated.status, updatedBy: updated.updatedBy });
  } catch (err) {
    if (err instanceof Tolak) return res.status(err.status).json(err.body);
    console.error(`${action} ERROR:`, err);
    res.status(500).json({ mesej: 'Ralat mengemas kini baris relief', error: err.message });
  }
}

// ── PATCH /api/relief/assignment/:id/confirm ──
export function confirmAssignment(req, res) {
  return transisi(req, res, { toStatus: 'DISAHKAN', action: 'RELIEF_CONFIRM' });
}

// ── PATCH /api/relief/assignment/:id/cancel ──
export function cancelAssignment(req, res) {
  return transisi(req, res, { toStatus: 'BATAL', action: 'RELIEF_CANCEL' });
}

// ── PATCH /api/relief/assignment/:id/teacher ──────────────
// Tukar guru ganti (tanpa perlu sahkan baris). Status kekal.
// K05 (Isu C): backend MENGESAHKAN kelayakan penuh (tidak bergantung pada
//  senarai calon frontend) di dalam transaksi + kunci batch:
//   wujud dalam jadual hari ini, tidak hadir, tidak mengajar, tiada relief
//   bertindih/berderet, pengecualian & sekatan khas, pertukaran suka sama suka,
//   had maksimum 2 relief sehari, status batch/baris.
//  "TIADA_PENGGANTI" sentiasa dibenarkan (keputusan admin: tiada pengganti).
//  `guruGantiSemasa` (pilihan): nilai yang dilihat admin — jika baris sudah
//  diubah oleh admin lain → 409 (tiada perubahan ditimpa secara senyap).
//  Baris ditanda diubahManual → DIKEKALKAN semasa Jana Semula.
const teacherSchema = z.object({
  guruGanti: z.string().trim().min(1, 'Nama guru ganti diperlukan'),
  guruGantiSemasa: z.string().nullable().optional(),
});

export async function updateTeacher(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ mesej: 'ID baris tidak sah' });

  const parsed = teacherSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ mesej: parsed.error.errors[0]?.message || 'Input tidak sah' });
  }

  try {
    const b0 = await prisma.reliefAssignment.findUnique({ where: { id } });
    if (!b0) return res.status(404).json({ mesej: 'Baris relief tidak dijumpai' });

    const guruDiminta = parsed.data.guruGanti.trim();
    const tiada = guruDiminta === TIADA_PENGGANTI;
    // Konteks hari (jadual, absen, sekatan, pengecualian, pertukaran) — baca sahaja
    const ctx = tiada ? null : await bacaKonteksHari(b0.tarikh);

    const { baris, updated } = await prisma.$transaction(async (tx) => {
      const batch = await kunciBatch(tx, b0.batchId);
      const baris = await tx.reliefAssignment.findUnique({ where: { id } });
      if (!baris) throw new Tolak(404, { mesej: 'Baris relief tidak dijumpai' });
      if (batch && BATCH_TERKUNCI.includes(batch.status)) {
        throw new Tolak(409, { mesej: `Batch sudah ${batch.status} — baris tidak boleh diubah.`, statusBatch: batch.status });
      }
      if (baris.status === 'BATAL') throw new Tolak(409, { mesej: 'Baris telah dibatalkan — tidak boleh diubah.' });
      if (parsed.data.guruGantiSemasa !== undefined && (parsed.data.guruGantiSemasa ?? null) !== (baris.guruGanti ?? null)) {
        throw new Tolak(409, {
          mesej: 'Baris ini telah diubah oleh pengguna lain. Paparan dimuat semula — sila semak dan cuba lagi.',
          berubah: true,
          guruGantiSemasa: baris.guruGanti,
        });
      }

      let isTier2 = false;
      let guruGanti = guruDiminta;
      if (!tiada) {
        const [mula, tamat] = parseMasa(baris.masa);
        if (mula === null) throw new Tolak(422, { mesej: 'Masa slot tidak sah.', sebab: 'MASA_TIDAK_SAH' });
        // Beban SEMASA (dibaca di bawah kunci) — semua baris lain bukan BATAL
        const lain = await tx.reliefAssignment.findMany({ where: { batchId: baris.batchId } });
        const gantiGlobal = {};
        for (const x of lain) {
          if (x.id === id || x.status === 'BATAL' || !x.guruGanti || x.guruGanti === TIADA_PENGGANTI) continue;
          (gantiGlobal[normN(x.guruGanti)] = gantiGlobal[normN(x.guruGanti)] || []).push({ kelas: x.kelas, masa: x.masa });
        }
        const semak = semakGuruManual({ guru: guruDiminta, hari: ctx.hUpper, masaMula: mula, masaTamat: tamat, ...ctx, gantiGlobal });
        if (!semak.layak) {
          throw new Tolak(422, { mesej: `${guruDiminta}: ${semak.mesej}`, sebab: semak.sebab });
        }
        isTier2 = semak.isTier2;
        guruGanti = ctx.semuaGuruHari.find((g) => normN(g) === normN(guruDiminta)) || guruDiminta;
      }

      const updated = await tx.reliefAssignment.update({
        where: { id },
        data: { guruGanti, isTier2, diubahManual: true, updatedBy: req.user?.username || null },
      });
      return { baris, updated };
    });

    await writeAudit({
      userId: req.user?.id || null,
      action: 'RELIEF_EDIT_TEACHER',
      entity: `relief_assignment:${id}`,
      detail: { dari: baris.guruGanti, ke: updated.guruGanti, kelas: baris.kelas, masa: baris.masa },
      ip: getClientIp(req),
    });

    res.json({ id: updated.id, guruGanti: updated.guruGanti, status: updated.status, isTier2: updated.isTier2, diubahManual: true });
  } catch (err) {
    if (err instanceof Tolak) return res.status(err.status).json(err.body);
    console.error('updateTeacher ERROR:', err);
    res.status(500).json({ mesej: 'Ralat menukar guru ganti', error: err.message });
  }
}
