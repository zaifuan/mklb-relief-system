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

const BATCH_TERKUNCI = ['DIHANTAR', 'SELESAI'];

// Logik kongsi untuk confirm & cancel
async function transisi(req, res, { toStatus, action }) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ mesej: 'ID baris tidak sah' });
  }

  try {
    const baris = await prisma.reliefAssignment.findUnique({
      where: { id },
      include: { batch: true },
    });

    if (!baris) {
      return res.status(404).json({ mesej: 'Baris relief tidak dijumpai' });
    }

    // Kunci batch (selaras Fasa 6)
    if (baris.batch && BATCH_TERKUNCI.includes(baris.batch.status)) {
      return res.status(409).json({
        mesej: `Batch sudah ${baris.batch.status} — baris tidak boleh diubah.`,
        statusBatch: baris.batch.status,
      });
    }

    // Hanya sah dari CADANGAN
    if (baris.status !== 'CADANGAN') {
      return res.status(409).json({
        mesej: `Baris bukan CADANGAN (status sekarang: ${baris.status}).`,
        statusBaris: baris.status,
      });
    }

    const updatedBy = req.user?.username || null;
    const updated = await prisma.reliefAssignment.update({
      where: { id },
      data: { status: toStatus, updatedBy },
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
// Disekat jika batch DIHANTAR/SELESAI atau baris BATAL.
const teacherSchema = z.object({ guruGanti: z.string().trim().min(1, 'Nama guru ganti diperlukan') });

export async function updateTeacher(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ mesej: 'ID baris tidak sah' });

  const parsed = teacherSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ mesej: parsed.error.errors[0]?.message || 'Input tidak sah' });
  }

  try {
    const baris = await prisma.reliefAssignment.findUnique({ where: { id }, include: { batch: true } });
    if (!baris) return res.status(404).json({ mesej: 'Baris relief tidak dijumpai' });

    if (baris.batch && BATCH_TERKUNCI.includes(baris.batch.status)) {
      return res.status(409).json({
        mesej: `Batch sudah ${baris.batch.status} — baris tidak boleh diubah.`,
        statusBatch: baris.batch.status,
      });
    }
    if (baris.status === 'BATAL') {
      return res.status(409).json({ mesej: 'Baris telah dibatalkan — tidak boleh diubah.' });
    }

    const guruGanti = parsed.data.guruGanti.trim();
    const updated = await prisma.reliefAssignment.update({
      where: { id },
      data: { guruGanti, updatedBy: req.user?.username || null },
    });

    await writeAudit({
      userId: req.user?.id || null,
      action: 'RELIEF_EDIT_TEACHER',
      entity: `relief_assignment:${id}`,
      detail: { dari: baris.guruGanti, ke: guruGanti, kelas: baris.kelas, masa: baris.masa },
      ip: getClientIp(req),
    });

    res.json({ id: updated.id, guruGanti: updated.guruGanti, status: updated.status });
  } catch (err) {
    console.error('updateTeacher ERROR:', err);
    res.status(500).json({ mesej: 'Ralat menukar guru ganti', error: err.message });
  }
}
