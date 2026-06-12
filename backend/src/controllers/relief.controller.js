// ════════════════════════════════════════════════════════════
//  Controller: relief (Fasa 6 — Relief Engine)
//    generateRelief    POST /api/relief/generate  { tarikh }
//    getReliefByTarikh GET  /api/relief/:tarikh
// ════════════════════════════════════════════════════════════

import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { writeAudit, getClientIp } from '../lib/audit.js';
import { janaJadualGanti } from '../services/relief.service.js';
import { simpanReliefBatch } from '../services/assignment.service.js';
import { parseMasa } from '../lib/timeUtil.js';

const bodySchema = z.object({
  tarikh: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Tarikh perlu format YYYY-MM-DD' }),
});

function parseTarikhParam(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

// Susun assignment ikut waktu (mula) kemudian kelas
function susunIkutMasa(rows) {
  return [...rows].sort((a, b) => {
    const ma = parseMasa(a.masa)[0] ?? 9999;
    const mb = parseMasa(b.masa)[0] ?? 9999;
    if (ma !== mb) return ma - mb;
    return String(a.kelas).localeCompare(String(b.kelas));
  });
}

// ── POST /api/relief/generate ─────────────────────────────
export async function generateRelief(req, res) {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ mesej: parsed.error.errors[0]?.message || 'Input tidak sah' });
  }
  const { tarikh } = parsed.data;

  try {
    const hasilJana = await janaJadualGanti({ tarikh });

    // Tiada guru perlu ganti — tidak cipta batch
    if (!hasilJana.adaPerluGanti) {
      return res.json({
        tarikh,
        hari: hasilJana.hari,
        batchId: null,
        ringkasan: { slot: 0, terisi: 0, kosong: 0, tier2: 0 },
        generated: [],
        mesej: hasilJana.adaAbsen
          ? 'Ada guru tidak hadir tetapi tiada yang ditanda perlu ganti.'
          : 'Tiada guru tidak hadir untuk tarikh ini.',
      });
    }

    const simpan = await simpanReliefBatch({
      tarikhDate: hasilJana.tarikhDate,
      hari: hasilJana.hari,
      hasil: hasilJana.hasil,
      generatedBy: req.user?.username || null,
    });

    await writeAudit({
      userId: req.user?.id || null,
      action: 'RELIEF_GENERATE',
      entity: `relief_batch:${simpan.batchId}`,
      detail: { tarikh, ringkasan: hasilJana.ringkasan, dibuang: simpan.dibuang, dicipta: simpan.dicipta },
      ip: getClientIp(req),
    });

    res.json({
      tarikh,
      hari: hasilJana.hari,
      batchId: simpan.batchId,
      status: simpan.status,
      ringkasan: hasilJana.ringkasan,
      generated: hasilJana.hasil.map((r) => ({
        guruTakHadir: r.guruTakHadir,
        hari: r.hari,
        kelas: r.kelas,
        masa: r.masa,
        subjek: r.subjek,
        guruGanti: r.guruGanti,
        kategori: r.kategori,
        isTier2: r.isTier2,
        status: r.status,
        auditNote: r.auditNote,
      })),
    });
  } catch (err) {
    if (err.code === 'LOCKED') {
      return res.status(409).json({ mesej: err.message, statusBatch: err.statusBatch });
    }
    if (err.code === 'BAD_DATE') {
      return res.status(400).json({ mesej: err.message });
    }
    console.error('generateRelief ERROR:', err);
    res.status(500).json({ mesej: 'Ralat menjana jadual ganti', error: err.message });
  }
}

// ── GET /api/relief/:tarikh ───────────────────────────────
export async function getReliefByTarikh(req, res) {
  const tarikhDate = parseTarikhParam(req.params.tarikh);
  if (!tarikhDate) return res.status(400).json({ mesej: 'Tarikh perlu format YYYY-MM-DD' });

  try {
    const batch = await prisma.reliefBatch.findUnique({
      where: { tarikh: tarikhDate },
      include: { assignments: true },
    });

    if (!batch) {
      return res.status(404).json({ mesej: 'Tiada batch relief untuk tarikh ini.', tarikh: req.params.tarikh });
    }

    const assignments = susunIkutMasa(batch.assignments).map((a) => ({
      id: a.id,
      guruTakHadir: a.guruTakHadir,
      hari: a.hari,
      kelas: a.kelas,
      masa: a.masa,
      subjek: a.subjek,
      guruGanti: a.guruGanti,
      kategori: a.kategori,
      status: a.status,
      isTier2: a.isTier2,
      auditNote: a.auditNote,
    }));

    const terisi = assignments.filter((a) => a.guruGanti).length;
    res.json({
      tarikh: req.params.tarikh,
      status: batch.status,
      generatedBy: batch.generatedBy,
      generatedAt: batch.generatedAt,
      confirmedBy: batch.confirmedBy,
      confirmedAt: batch.confirmedAt,
      jumlah: assignments.length,
      ringkasan: {
        slot: assignments.length,
        terisi,
        kosong: assignments.length - terisi,
        tier2: assignments.filter((a) => a.isTier2).length,
      },
      assignments,
    });
  } catch (err) {
    console.error('getReliefByTarikh ERROR:', err);
    res.status(500).json({ mesej: 'Ralat membaca batch relief', error: err.message });
  }
}
