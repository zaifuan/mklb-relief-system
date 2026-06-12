// ════════════════════════════════════════════════════════════
//  Controller: absence (borang ketidakhadiran)
//  getPublicOptions · createAbsence · getAbsence
// ════════════════════════════════════════════════════════════

import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { writeAudit, getClientIp } from '../lib/audit.js';
import {
  SEBAB,
  SEBAB_PERLU_DETAIL,
  JENIS,
  SEBAB_LABEL,
  JENIS_LABEL,
} from '../lib/absenceConstants.js';
import { hariDari, generateReference } from '../lib/absenceUtil.js';
import { sendRealtime } from '../services/telegramNotify.service.js';

const createSchema = z
  .object({
    guruNama: z.string().min(1, 'Nama guru diperlukan'),
    tarikh: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarikh tidak sah'),
    sebab: z.enum(SEBAB, { errorMap: () => ({ message: 'Sebab tidak sah' }) }),
    jenis: z.enum(JENIS, { errorMap: () => ({ message: 'Jenis tidak sah' }) }),
    masaMula: z.string().optional(),
    catatan: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.jenis === 'SEPARUH_HARI' && !val.masaMula?.trim()) {
      ctx.addIssue({ path: ['masaMula'], code: 'custom', message: 'Masa mula diperlukan untuk separuh hari' });
    }
    if (SEBAB_PERLU_DETAIL.includes(val.sebab) && !val.catatan?.trim()) {
      ctx.addIssue({ path: ['catatan'], code: 'custom', message: 'Catatan diperlukan untuk sebab ini' });
    }
  });

// GET /api/absence/public/options  (awam)
export async function getPublicOptions(req, res) {
  try {
    const teachers = await prisma.teacher.findMany({
      where: { isActive: true },
      select: { id: true, nama: true },
      orderBy: { nama: 'asc' },
    });
    res.json({
      teachers,
      sebab: SEBAB.map((v) => ({ value: v, label: SEBAB_LABEL[v] })),
      jenis: JENIS.map((v) => ({ value: v, label: JENIS_LABEL[v] })),
      sebabPerluDetail: SEBAB_PERLU_DETAIL,
    });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}

// POST /api/absence  (awam)
export async function createAbsence(req, res) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      mesej: 'Borang tidak lengkap',
      isu: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const { guruNama, tarikh, sebab, jenis, masaMula, catatan } = parsed.data;

    const guru = await prisma.teacher.findUnique({ where: { nama: guruNama.trim() } });
    if (!guru || !guru.isActive) {
      return res.status(400).json({ success: false, mesej: 'Guru tidak wujud atau tidak aktif' });
    }

    const [yy, mm, dd] = tarikh.split('-').map(Number);
    const tarikhDate = new Date(Date.UTC(yy, mm - 1, dd));
    const hari = hariDari(tarikh);

    // Jana reference + simpan dalam transaction; cuba semula sekali jika reference bertembung
    let record;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        record = await prisma.$transaction(async (tx) => {
          const reference = await generateReference(tx, tarikhDate);
          return tx.absenceRecord.create({
            data: {
              guruNama: guru.nama,
              hari,
              tarikh: tarikhDate,
              sebabKategori: sebab,
              sebabDetail: catatan?.trim() || null,
              jenis,
              masaMula: jenis === 'SEPARUH_HARI' ? masaMula.trim() : null,
              statusBorang: 'AKTIF',
              submittedBy: guru.nama,
              reference,
            },
          });
        });
        break;
      } catch (e) {
        if (e.code === 'P2002' && attempt === 0) continue; // konflik reference → cuba lagi
        throw e;
      }
    }

    await writeAudit({
      userId: null,
      action: 'ABSENCE_CREATE',
      entity: 'ABSENCE',
      detail: { guru: guru.nama, tarikh, sebab },
      ip: getClientIp(req),
    });

    // ── Telegram realtime (Fasa 9) — tidak blok borang jika gagal ──
    try {
      await sendRealtime(record, { ip: getClientIp(req) });
    } catch (e) {
      console.error('sendRealtime (createAbsence) ERROR:', e.message);
    }

    res.status(201).json({ success: true, reference: record.reference });
  } catch (err) {
    res.status(500).json({ success: false, mesej: err.message });
  }
}

// GET /api/absence/:id  (perlu login admin)
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
