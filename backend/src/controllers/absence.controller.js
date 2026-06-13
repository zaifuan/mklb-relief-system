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
import { masaKeMinitAuto } from '../lib/absenceWindow.js';
import { sendRealtime, sendPembatalan } from '../services/telegramNotify.service.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    guruNama: z.string().min(1).optional(),
    guruNamaList: z.array(z.string().min(1)).optional(),
    tarikh: z.string().regex(DATE_RE, 'Tarikh tidak sah').optional(), // legacy (rekod lama / borang lama)
    tarikhMula: z.string().regex(DATE_RE, 'Tarikh mula tidak sah').optional(),
    tarikhTamat: z.string().regex(DATE_RE, 'Tarikh tamat tidak sah').optional(),
    sebab: z.enum(SEBAB, { errorMap: () => ({ message: 'Sebab tidak sah' }) }),
    jenis: z.enum(JENIS, { errorMap: () => ({ message: 'Jenis tidak sah' }) }),
    masaMula: z.string().optional(),
    masaTamat: z.string().optional(),
    catatan: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.guruNama && !(val.guruNamaList && val.guruNamaList.length)) {
      ctx.addIssue({ path: ['guruNama'], code: 'custom', message: 'Nama guru diperlukan' });
    }
    if (!val.tarikhMula && !val.tarikh) {
      ctx.addIssue({ path: ['tarikhMula'], code: 'custom', message: 'Tarikh diperlukan' });
    }
    if (val.jenis === 'SEPARUH_HARI') {
      if (!val.masaMula?.trim()) {
        ctx.addIssue({ path: ['masaMula'], code: 'custom', message: 'Masa mula diperlukan untuk separuh hari' });
      } else if (masaKeMinitAuto(val.masaMula) === null) {
        ctx.addIssue({ path: ['masaMula'], code: 'custom', message: 'Masa mula tidak sah' });
      }
      if (val.masaTamat?.trim()) {
        const m = masaKeMinitAuto(val.masaMula);
        const t = masaKeMinitAuto(val.masaTamat);
        if (t === null) {
          ctx.addIssue({ path: ['masaTamat'], code: 'custom', message: 'Masa tamat tidak sah' });
        } else if (m !== null && t <= m) {
          ctx.addIssue({ path: ['masaTamat'], code: 'custom', message: 'Masa tamat mesti selepas masa mula' });
        }
      }
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
    const { guruNama, guruNamaList, sebab, jenis, masaMula, masaTamat, catatan } = parsed.data;
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

    // ── Senarai guru (kumpulan atau individu), nyahduplikat dalam penghantaran ──
    const rawList = guruNamaList?.length ? guruNamaList : guruNama ? [guruNama] : [];
    const namaList = [...new Set(rawList.map((n) => String(n).trim()).filter(Boolean))];
    if (namaList.length === 0) {
      return res.status(400).json({ success: false, mesej: 'Sila pilih sekurang-kurangnya seorang guru.' });
    }

    // Had selamat: jumlah rekod (guru × hari) setiap penghantaran
    const MAX_REKOD = 300;
    if (namaList.length * jumlahHari > MAX_REKOD) {
      return res.status(400).json({
        success: false,
        mesej: `Terlalu banyak rekod (${namaList.length} guru × ${jumlahHari} hari). Maksimum ${MAX_REKOD} setiap penghantaran.`,
      });
    }

    // Sahkan semua guru wujud & aktif
    const guruRows = await prisma.teacher.findMany({ where: { nama: { in: namaList } } });
    const guruMap = new Map(guruRows.filter((g) => g.isActive).map((g) => [g.nama, g]));
    const tidakSah = namaList.filter((n) => !guruMap.has(n));
    if (tidakSah.length) {
      return res.status(400).json({ success: false, mesej: `Guru tidak wujud atau tidak aktif: ${tidakSah.join(', ')}` });
    }

    // ── Kumpulan (≥ 2 guru) → jana groupReference dikongsi semua rekod submit ini ──
    let groupReference = null;
    if (namaList.length >= 2) {
      const prefix = `GRP-${mulaStr.replace(/-/g, '')}-`;
      const existing = await prisma.absenceRecord.findMany({
        where: { groupReference: { startsWith: prefix } },
        select: { groupReference: true },
        distinct: ['groupReference'],
      });
      groupReference = `${prefix}${String(existing.length + 1).padStart(3, '0')}`;
    }

    const references = []; // reference setiap rekod baharu
    const rekodBaharu = []; // untuk hook Telegram realtime
    let dilangkau = 0; // (guru, tarikh) yang sudah ada rekod AKTIF

    // ── Untuk SETIAP guru × SETIAP tarikh → satu rekod ──
    for (const nama of namaList) {
      const guru = guruMap.get(nama);
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
                  masaTamat: jenis === 'SEPARUH_HARI' ? masaTamat?.trim() || null : null,
                  statusBorang: 'AKTIF',
                  submittedBy: guru.nama,
                  reference,
                  groupReference,
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
    }

    // Satu audit ringkas untuk keseluruhan penghantaran
    await writeAudit({
      userId: null,
      action: 'ABSENCE_CREATE',
      entity: 'ABSENCE',
      detail: {
        guru: namaList.length === 1 ? namaList[0] : namaList,
        tarikhMula: mulaStr,
        tarikhTamat: tamatStr,
        sebab,
        jumlahGuru: namaList.length,
        jumlahHari,
        dicipta: references.length,
        dilangkau,
      },
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
      // ── Ringkasan kumpulan ──
      jumlahGuru: namaList.length,
      jumlahHari,
      jumlahRekodBerjaya: dicipta,
      duplicateSkipped: dilangkau,
      groupReference,
      // ── Serasi-belakang (borang sedia ada baca medan ini) ──
      dicipta,
      dilangkau,
      tarikhMula: mulaStr,
      tarikhTamat: tamatStr,
      references,
      reference: references[0] || null,
      mesej: dicipta
        ? `${dicipta} rekod berjaya (${namaList.length} guru × ${jumlahHari} hari)${dilangkau ? `, ${dilangkau} dilangkau (sudah wujud)` : ''}.`
        : 'Semua rekod dalam penghantaran ini sudah wujud sebelum ini.',
    });
  } catch (err) {
    res.status(500).json({ success: false, mesej: err.message });
  }
}

// GET /api/absence/public/check?guruNama=...&tarikh=YYYY-MM-DD  (awam, tiada login)
// Pulangkan rekod (belum dipadam) bagi guru tersebut pada tarikh tersebut.
export async function checkPublic(req, res) {
  try {
    const guruNama = String(req.query.guruNama || '').trim();
    const tarikhStr = String(req.query.tarikh || '').trim();
    if (!guruNama) return res.status(400).json({ success: false, mesej: 'Nama guru diperlukan' });
    if (!DATE_RE.test(tarikhStr)) return res.status(400).json({ success: false, mesej: 'Tarikh tidak sah' });

    const [y, m, d] = tarikhStr.split('-').map(Number);
    const tarikhDate = new Date(Date.UTC(y, m - 1, d));

    const records = await prisma.absenceRecord.findMany({
      where: {
        guruNama: { equals: guruNama, mode: 'insensitive' },
        tarikh: tarikhDate,
        deletedAt: null,
      },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        tarikh: true,
        hari: true,
        guruNama: true,
        sebabKategori: true,
        sebabDetail: true,
        jenis: true,
        masaMula: true,
        masaTamat: true,
        statusBorang: true,
      },
    });

    res.json({ success: true, records, jumlah: records.length });
  } catch (err) {
    res.status(500).json({ success: false, mesej: err.message });
  }
}

// PATCH /api/absence/public/:id/cancel  (awam — guru batal rekod sendiri)
// Hanya rekod AKTIF. Tukar status → DIBATALKAN (TIDAK padam). Rekod tunggal sahaja
// walaupun ada groupReference (tidak menjejaskan rekod lain dalam kumpulan).
export async function cancelPublic(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, mesej: 'ID tidak sah' });

    const existing = await prisma.absenceRecord.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      return res.status(404).json({ success: false, mesej: 'Rekod tidak dijumpai' });
    }

    // Safeguard ringan (tiada login): jika nama dihantar, mesti sepadan dengan rekod.
    const guruNama = String(req.body?.guruNama || '').trim();
    if (guruNama && guruNama.toLowerCase() !== existing.guruNama.toLowerCase()) {
      return res.status(403).json({ success: false, mesej: 'Nama guru tidak sepadan dengan rekod ini.' });
    }

    if (existing.statusBorang !== 'AKTIF') {
      return res
        .status(409)
        .json({ success: false, mesej: `Rekod ini sudah ${existing.statusBorang.toLowerCase()}, tidak boleh dibatalkan.` });
    }

    const updated = await prisma.absenceRecord.update({
      where: { id },
      data: { statusBorang: 'DIBATALKAN' },
    });

    await writeAudit({
      userId: null,
      action: 'ABSENCE_CANCEL_PUBLIC',
      entity: 'ABSENCE',
      detail: { reference: existing.reference, guru: existing.guruNama, oleh: 'guru (awam)' },
      ip: getClientIp(req),
    });

    // Telegram pembatalan (servis sedia ada; gate kendali "hari ini") — tidak blok
    try {
      await sendPembatalan(existing, { userId: null, ip: getClientIp(req) });
    } catch (e) {
      console.error('sendPembatalan (cancelPublic) ERROR:', e.message);
    }

    res.json({ success: true, record: updated, mesej: 'Rekod telah dibatalkan.' });
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
