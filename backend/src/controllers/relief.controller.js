// ════════════════════════════════════════════════════════════
//  Controller: relief (Fasa 6 — Relief Engine)
//    generateRelief    POST /api/relief/generate  { tarikh }
//    getReliefByTarikh GET  /api/relief/:tarikh
// ════════════════════════════════════════════════════════════

import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { writeAudit, getClientIp } from '../lib/audit.js';
import { janaJadualGanti, senaraiCalonSemua } from '../services/relief.service.js';
import { simpanReliefBatch } from '../services/assignment.service.js';
import { parseMasa } from '../lib/timeUtil.js';
import { hariDari } from '../lib/absenceUtil.js';
import { streamReliefPdf } from '../services/pdf.service.js';

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

// Susun ikut nama guru tidak hadir A–Z → masa mula → kelas
// (SAMA seperti paparan dashboard relief supaya PDF padan dengan pratonton)
function susunIkutNama(rows) {
  return [...rows].sort((a, b) => {
    const byNama = String(a.guruTakHadir).localeCompare(String(b.guruTakHadir), 'ms');
    if (byNama !== 0) return byNama;
    const sa = parseMasa(a.masa)[0] ?? 9999;
    const sb = parseMasa(b.masa)[0] ?? 9999;
    if (sa !== sb) return sa - sb;
    return String(a.kelas).localeCompare(String(b.kelas), 'ms');
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

    // Tiada guru perlu ganti — buang sebarang batch lama tarikh ini supaya
    // assignment lama TIDAK kekal selepas semua rekod ketidakhadiran dibatalkan.
    if (!hasilJana.adaPerluGanti) {
      await prisma.reliefBatch.deleteMany({ where: { tarikh: hasilJana.tarikhDate } });
      await writeAudit({
        userId: req.user?.id || null,
        action: 'RELIEF_CLEAR_EMPTY',
        entity: `relief:${tarikh}`,
        detail: { tarikh, sebab: hasilJana.adaAbsen ? 'tiada perlu ganti' : 'tiada ketidakhadiran' },
        ip: getClientIp(req),
      });
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

    // Calon guru ganti untuk dropdown (tidak dikira jika batch terkunci)
    let candById = {};
    if (!['DIHANTAR', 'SELESAI'].includes(batch.status)) {
      try {
        candById = await senaraiCalonSemua(tarikhDate);
      } catch (e) {
        console.error('senaraiCalonSemua ERROR:', e);
        candById = {};
      }
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
      candidates: candById[a.id] || [],
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

// ── PATCH /api/relief/:tarikh/confirm-all ─────────────────
// Sahkan SEMUA baris CADANGAN → DISAHKAN. DISAHKAN & BATAL tidak disentuh.
export async function confirmAllByTarikh(req, res) {
  const tarikhDate = parseTarikhParam(req.params.tarikh);
  if (!tarikhDate) return res.status(400).json({ mesej: 'Tarikh perlu format YYYY-MM-DD' });

  try {
    const batch = await prisma.reliefBatch.findUnique({ where: { tarikh: tarikhDate } });
    if (!batch) return res.status(404).json({ mesej: 'Tiada batch relief untuk tarikh ini.' });
    if (['DIHANTAR', 'SELESAI'].includes(batch.status)) {
      return res.status(409).json({ mesej: `Batch sudah ${batch.status} — tidak boleh disahkan.`, statusBatch: batch.status });
    }

    const r = await prisma.reliefAssignment.updateMany({
      where: { batchId: batch.id, status: 'CADANGAN' },
      data: { status: 'DISAHKAN', updatedBy: req.user?.username || null },
    });

    await writeAudit({
      userId: req.user?.id || null,
      action: 'RELIEF_CONFIRM_ALL',
      entity: `relief_batch:${batch.id}`,
      detail: { tarikh: req.params.tarikh, disahkan: r.count },
      ip: getClientIp(req),
    });

    res.json({ success: true, disahkan: r.count });
  } catch (err) {
    console.error('confirmAllByTarikh ERROR:', err);
    res.status(500).json({ mesej: 'Ralat mengesahkan semua cadangan', error: err.message });
  }
}

// Format masa "9.45-10.15" / "9.45 – 10.15" → "9.45 – 10.15"
function fmtMasaJulat(masa) {
  const clean = String(masa || '').replace(/[–—]/g, '-');
  const i = clean.indexOf('-');
  if (i < 0) return clean.trim();
  return `${clean.slice(0, i).trim()} – ${clean.slice(i + 1).trim()}`;
}

// ── GET /api/relief/:tarikh/pdf ───────────────────────────
// Jana PDF "JADUAL WAKTU GURU GANTI" (A4 Landscape) untuk batch tarikh ini.
export async function reliefPdf(req, res) {
  const tarikhDate = parseTarikhParam(req.params.tarikh);
  if (!tarikhDate) return res.status(400).json({ mesej: 'Tarikh perlu format YYYY-MM-DD' });

  try {
    const batch = await prisma.reliefBatch.findUnique({
      where: { tarikh: tarikhDate },
      include: { assignments: true },
    });
    if (!batch) return res.status(404).json({ mesej: 'Tiada batch relief untuk tarikh ini.' });

    const baris = susunIkutNama(batch.assignments).map((a) => ({
      guruTakHadir: a.guruTakHadir,
      kelas: a.kelas,
      subjek: a.subjek || '-',
      masa: fmtMasaJulat(a.masa),
      guruGanti: a.guruGanti,
    }));

    // DEBUG sementara — sahkan susunan baris masuk PDF (nama A–Z → masa → kelas)
    console.log(
      '[reliefPdf] SUSUNAN PDF =>',
      baris.map((b, i) => `${i + 1}. ${b.guruTakHadir} | ${b.kelas} | ${b.masa}`).join('  ||  ')
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="jadual-ganti-${req.params.tarikh}.pdf"`);

    await writeAudit({
      userId: req.user?.id || null,
      action: 'RELIEF_PDF',
      entity: `relief_batch:${batch.id}`,
      detail: { tarikh: req.params.tarikh, slot: baris.length },
      ip: getClientIp(req),
    });

    streamReliefPdf(res, {
      tarikhDate,
      hari: hariDari(tarikhDate).toUpperCase(),
      namaSekolah: 'SABK MAAHAD AL KHAIR LIL BANAT',
      baris,
      dijanaOleh: batch.generatedBy,
      masaJana: batch.generatedAt,
    });
  } catch (err) {
    console.error('reliefPdf ERROR:', err);
    if (!res.headersSent) res.status(500).json({ mesej: 'Ralat menjana PDF', error: err.message });
  }
}
