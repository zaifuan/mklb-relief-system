// ════════════════════════════════════════════════════════════
//  Controller: adminAbsence (Fasa 5 — dashboard ketidakhadiran)
//  list · summary · getOne · updateStatus · remove (soft delete)
// ════════════════════════════════════════════════════════════

import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { writeAudit, getClientIp } from '../lib/audit.js';
import { SEBAB } from '../lib/absenceConstants.js';
import { sendPembatalan } from '../services/telegramNotify.service.js';

const STATUS = ['AKTIF', 'DIBATALKAN', 'SELESAI'];

const statusSchema = z.object({
  status: z.enum(STATUS, { errorMap: () => ({ message: 'Status tidak sah' }) }),
});

// Tarikh hari ini (kalendar Asia/Kuala_Lumpur) → Date UTC-midnight
function todayKL() {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// Julat minggu (Isnin–Ahad) yang mengandungi tarikh diberi
function weekRange(dateUtc) {
  const dow = dateUtc.getUTCDay(); // 0=Ahad..6=Sabtu
  const sejakIsnin = (dow + 6) % 7; // Isnin=0
  const start = new Date(dateUtc);
  start.setUTCDate(start.getUTCDate() - sejakIsnin);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start, end };
}

function parseTarikh(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

// GET /api/admin/absence
export async function listAbsence(req, res) {
  try {
    const { tarikh, status, sebab, guru, q } = req.query;
    const where = { deletedAt: null };

    if (status && STATUS.includes(status)) where.statusBorang = status;
    if (sebab && SEBAB.includes(sebab)) where.sebabKategori = sebab;
    if (guru) where.guruNama = guru;

    const t = parseTarikh(tarikh);
    if (t) where.tarikh = t;

    if (q && q.trim()) {
      where.guruNama = { contains: q.trim(), mode: 'insensitive' };
    }

    const records = await prisma.absenceRecord.findMany({
      where,
      orderBy: [{ tarikh: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        reference: true,
        groupReference: true,
        tarikh: true,
        hari: true,
        guruNama: true,
        sebabKategori: true,
        sebabDetail: true,
        jenis: true,
        masaMula: true,
        masaTamat: true,
        statusBorang: true,
        createdAt: true,
      },
    });

    res.json({ records, jumlah: records.length });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}

// GET /api/admin/absence/summary
export async function summary(req, res) {
  try {
    const today = todayKL();
    const { start, end } = weekRange(today);

    const [hariIni, mingguIni, aktif, dibatalkan] = await Promise.all([
      prisma.absenceRecord.count({ where: { deletedAt: null, statusBorang: 'AKTIF', tarikh: today } }),
      prisma.absenceRecord.count({
        where: { deletedAt: null, statusBorang: 'AKTIF', tarikh: { gte: start, lte: end } },
      }),
      prisma.absenceRecord.count({ where: { deletedAt: null, statusBorang: 'AKTIF' } }),
      prisma.absenceRecord.count({ where: { deletedAt: null, statusBorang: 'DIBATALKAN' } }),
    ]);

    res.json({ hariIni, mingguIni, aktif, dibatalkan });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}

// GET /api/admin/absence/:id
export async function getAbsence(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ mesej: 'ID tidak sah' });

    const record = await prisma.absenceRecord.findUnique({ where: { id } });
    if (!record) return res.status(404).json({ mesej: 'Rekod tidak dijumpai' });

    res.json(record);
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}

// PATCH /api/admin/absence/:id/status
export async function updateStatus(req, res) {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ mesej: 'Status tidak sah', isu: parsed.error.flatten().fieldErrors });
  }

  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ mesej: 'ID tidak sah' });

    const existing = await prisma.absenceRecord.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return res.status(404).json({ mesej: 'Rekod tidak dijumpai' });

    const statusBaru = parsed.data.status;
    const statusLama = existing.statusBorang;

    const updated = await prisma.absenceRecord.update({
      where: { id },
      data: { statusBorang: statusBaru },
    });

    await writeAudit({
      userId: req.user?.id ?? null,
      action: statusBaru === 'DIBATALKAN' ? 'ABSENCE_CANCEL' : 'ABSENCE_STATUS_UPDATE',
      entity: 'ABSENCE',
      detail: { reference: existing.reference, statusLama, statusBaru },
      ip: getClientIp(req),
    });

    // ── Telegram pembatalan (Fasa 9) — hanya bila status → DIBATALKAN ──
    if (statusBaru === 'DIBATALKAN' && statusLama !== 'DIBATALKAN') {
      try {
        await sendPembatalan(existing, { userId: req.user?.id ?? null, ip: getClientIp(req) });
      } catch (e) {
        console.error('sendPembatalan (updateStatus) ERROR:', e.message);
      }
    }

    res.json({ success: true, record: updated });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}

// PATCH /api/admin/absence/group/:groupReference/cancel
// Batalkan SEMUA rekod AKTIF yang berkongsi groupReference (satu submit kumpulan).
export async function cancelGroup(req, res) {
  try {
    const groupReference = String(req.params.groupReference || '').trim();
    if (!groupReference) return res.status(400).json({ mesej: 'groupReference diperlukan' });

    const records = await prisma.absenceRecord.findMany({
      where: { groupReference, statusBorang: 'AKTIF', deletedAt: null },
    });
    if (records.length === 0) {
      return res.status(404).json({ mesej: 'Tiada rekod AKTIF dalam kumpulan ini.' });
    }

    await prisma.absenceRecord.updateMany({
      where: { groupReference, statusBorang: 'AKTIF', deletedAt: null },
      data: { statusBorang: 'DIBATALKAN' },
    });

    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'ABSENCE_CANCEL_GROUP',
      entity: 'ABSENCE',
      detail: { groupReference, dibatalkan: records.length, references: records.map((r) => r.reference) },
      ip: getClientIp(req),
    });

    // Telegram pembatalan — resend snapshot PENUH; sekali sahaja per tarikh
    const _seenTarikhPB = new Set();
    for (const rec of records) {
      const key = rec.tarikh instanceof Date ? rec.tarikh.toISOString().slice(0, 10) : String(rec.tarikh);
      if (_seenTarikhPB.has(key)) continue;
      _seenTarikhPB.add(key);
      try {
        await sendPembatalan(rec, { userId: req.user?.id ?? null, ip: getClientIp(req) });
      } catch (e) {
        console.error('sendPembatalan (cancelGroup) ERROR:', e.message);
      }
    }

    res.json({ success: true, dibatalkan: records.length, groupReference });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}

// DELETE /api/admin/absence/:id  (SUPER_ADMIN sahaja) — soft delete
export async function removeAbsence(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ mesej: 'ID tidak sah' });

    const existing = await prisma.absenceRecord.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return res.status(404).json({ mesej: 'Rekod tidak dijumpai' });

    await prisma.absenceRecord.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'ABSENCE_DELETE',
      entity: 'ABSENCE',
      detail: { reference: existing.reference, statusLama: existing.statusBorang },
      ip: getClientIp(req),
    });

    res.json({ success: true, mesej: 'Rekod dipadam (soft delete)' });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}
