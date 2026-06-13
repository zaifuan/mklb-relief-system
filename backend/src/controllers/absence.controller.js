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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    guruNama: z.string().min(1, 'Nama guru diperlukan'),
    tarikh: z.string().regex(DATE_RE, 'Tarikh tidak sah').optional(), // legacy (rekod lama / borang lama)
    tarikhMula: z.string().regex(DATE_RE, 'Tarikh mula tidak sah').optional(),
    tarikhTamat: z.string().regex(DATE_RE, 'Tarikh tamat tidak sah').optional(),
    sebab: z.enum(SEBAB, { errorMap: () => ({ message: 'Sebab tidak sah' }) }),
    jenis: z.enum(JENIS, { errorMap: () => ({ message: 'Jenis tidak sah' }) }),
    masaMula: z.string().optional(),
    catatan: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.tarikhMula && !val.tarikh) {
      ctx.addIssue({ path: ['tarikhMula'], code: 'custom', message: 'Tarikh diperlukan' });
    }
    if (val.jenis === 'SEPARUH_HARI' && !val.masaMula?.trim()) {
      ctx.addIssue({ path: ['masaMula'], code: 'custom', message: 'Masa mula diperlukan untuk separuh hari' });
    }
    if (SEBAB_PERLU_DETAIL.includes(val.sebab) && !val.catatan?.trim()) {
      ctx.addIssue({ path: ['catatan'], code: 'custom', message: 'Catatan diperlukan untuk sebab ini' });
    }
  });

const MAX_HARI_JULAT = 31; // had selamat: maksimum hari setiap penghantaran

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
    const { guruNama, sebab, jenis, masaMula, catatan } = parsed.data;
    const mulaStr = parsed.data.tarikhMula || parsed.data.tarikh;
    const tamatStr = parsed.data.tarikhTamat || mulaStr;

    // Susunan tarikh (rentetan YYYY-MM-DD selamat dibandingkan secara leksikografi)
    if (tamatStr < mulaStr) {
      return res.status(400).json({ success: false, mesej: 'Tarikh tamat tidak boleh sebelum tarikh mula.' });
    }

    const MS_HARI = 86400000;
    const [y1, m1, d1] = mulaStr.split('-').map(Number);
    const [y2, m2, d2] = tamatStr.split('-').map(Number);
    const startMs = Date.UTC(y1, m1 - 1, d1);
    const endMs = Date.UTC(y2, m2 - 1, d2);
    const jumlahHari = Math.round((endMs - startMs) / MS_HARI) + 1;

    if (jumlahHari > MAX_HARI_JULAT) {
      return res.status(400).json({
        success: false,
        mesej: `Julat terlalu panjang (maksimum ${MAX_HARI_JULAT} hari setiap penghantaran).`,
      });
    }

    const guru = await prisma.teacher.findUnique({ where: { nama: guruNama.trim() } });
    if (!guru || !guru.isActive) {
      return res.status(400).json({ success: false, mesej: 'Guru tidak wujud atau tidak aktif' });
    }

    const references = []; // reference setiap rekod baharu
    const rekodBaharu = []; // untuk hook Telegram realtime
    let dilangkau = 0; // tarikh yang sudah ada rekod AKTIF

    for (let cur = startMs; cur <= endMs; cur += MS_HARI) {
      const tarikhDate = new Date(cur);
      const hari = hariDari(tarikhDate);

      // Dedup: guru sama + tarikh sama + masih AKTIF (belum dipadam) → langkau
      const sediaAda = await prisma.absenceRecord.findFirst({
        where: { guruNama: guru.nama, tarikh: tarikhDate, statusBorang: 'AKTIF', deletedAt: null },
        select: { id: true },
      });
      if (sediaAda) {
        dilangkau++;
        continue;
      }

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

      references.push(record.reference);
      rekodBaharu.push(record);
    }

    // Satu audit ringkas untuk keseluruhan penghantaran
    await writeAudit({
      userId: null,
      action: 'ABSENCE_CREATE',
      entity: 'ABSENCE',
      detail: { guru: guru.nama, tarikhMula: mulaStr, tarikhTamat: tamatStr, sebab, dicipta: references.length, dilangkau },
      ip: getClientIp(req),
    });

    // ── Telegram realtime (Fasa 9) — tiap rekod baharu; gate kendali "hari ini" ──
    for (const rec of rekodBaharu) {
      try {
        await sendRealtime(rec, { ip: getClientIp(req) });
      } catch (e) {
        console.error('sendRealtime (createAbsence) ERROR:', e.message);
      }
    }

    const dicipta = references.length;
    return res.status(dicipta ? 201 : 200).json({
      success: true,
      dicipta,
      dilangkau,
      jumlahHari,
      tarikhMula: mulaStr,
      tarikhTamat: tamatStr,
      references,
      reference: references[0] || null, // serasi ke belakang (borang lama baca medan ini)
      mesej: dicipta
        ? `${dicipta} hari berjaya direkod${dilangkau ? `, ${dilangkau} hari dilangkau (sudah wujud)` : ''}.`
        : 'Semua tarikh dalam julat sudah direkod sebelum ini.',
    });
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
