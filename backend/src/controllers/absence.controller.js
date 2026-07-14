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
import { normalkanMasa } from '../lib/timeUtil.js';
import { resolveWantSwaps } from '../lib/absenceRules.js';
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
    // Keperluan relief kelas — BAHARU. Optional + default(true) supaya payload
    // lama (tanpa medan ini) terus tersimpan perluGanti=true seperti sebelum ini.
    perluGanti: z.boolean().default(true),
    // Pertukaran Kelas (Suka Sama Suka) — hanya diproses untuk hantar SATU guru
    // individu. Boleh merentasi >1 hari; setiap item boleh bawa `tarikh` sendiri
    // untuk menentukan rekod ketidakhadiran mana ia tergolong.
    pertukaran: z
      .array(
        z.object({
          scheduleId: z.number().int().optional(),
          slot: z.string().optional(),
          tarikh: z.string().regex(DATE_RE, 'Tarikh pertukaran tidak sah').optional(),
          kelas: z.string().min(1),
          masa: z.string().min(1),
          subjek: z.string().optional(),
          guruGanti: z.string().min(1),
        })
      )
      .optional(),
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

// GET /api/absence/public/schedule?guruNama=...&tarikh=YYYY-MM-DD  (awam)
// Pulangkan slot MENGAJAR guru pada hari tarikh tersebut — untuk pilih kelas
// yang ingin diserahkan (Pertukaran Kelas / Suka Sama Suka). Slot FREE dibuang.
export async function getPublicSchedule(req, res) {
  try {
    const guruNama = String(req.query.guruNama || '').trim();
    const tarikhStr = String(req.query.tarikh || '').trim();
    if (!guruNama) return res.status(400).json({ success: false, mesej: 'Nama guru diperlukan' });
    if (!DATE_RE.test(tarikhStr)) return res.status(400).json({ success: false, mesej: 'Tarikh tidak sah' });

    const [y, m, d] = tarikhStr.split('-').map(Number);
    const tarikhDate = new Date(Date.UTC(y, m - 1, d));
    const hari = hariDari(tarikhDate).toUpperCase();

    const rows = await prisma.teacherSchedule.findMany({
      where: { hari, guru: { equals: guruNama, mode: 'insensitive' } },
      select: { id: true, slot: true, kelas: true, masa: true, subjek: true },
    });

    const isFree = (k) => String(k || '').trim().toUpperCase() === 'FREE';
    const startMin = (masa) => masaKeMinitAuto(String(masa || '').split('-')[0]) ?? 9999;
    const slots = rows
      .filter((r) => r.kelas && !isFree(r.kelas))
      .map((r) => ({
        scheduleId: r.id,
        slot: r.slot || null,
        kelas: String(r.kelas).trim(),
        masa: String(r.masa || '').trim(),
        subjek: r.subjek ? String(r.subjek).trim() : null,
      }))
      .sort((a, b) => startMin(a.masa) - startMin(b.masa));

    res.json({ success: true, hari, slots, jumlah: slots.length });
  } catch (err) {
    res.status(500).json({ success: false, mesej: err.message });
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
    const { guruNama, guruNamaList, sebab, jenis, masaMula, masaTamat, catatan, perluGanti } = parsed.data;
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

    // ── Pertukaran Kelas (Suka Sama Suka) — disediakan untuk simpanan ATOMIK ──
    // Hanya untuk hantar SATU guru individu (selaras UI borang); kini boleh
    // merentasi >1 hari. Setiap item pertukaran ditapis mengikut tarikh rekod
    // ketidakhadiran semasa di dalam gelung di bawah (lihat swapForTarikh).
    // Resolusi ID guru ganti dibuat sekali di sini; baris class_swaps dicipta
    // DALAM transaksi yang SAMA dengan absenceRecord supaya kedua-duanya atomik
    // (semua-atau-tiada).
    const wantSwaps = resolveWantSwaps({
      pertukaranLength: parsed.data.pertukaran?.length || 0,
      jumlahGuru: namaList.length,
      perluGanti,
    });
    let gantiIdMap = new Map();
    let swapInput = [];
    if (wantSwaps) {
      swapInput = parsed.data.pertukaran.filter((p) => p.guruGanti && p.kelas && p.masa);
      const namaGanti = [...new Set(swapInput.map((p) => String(p.guruGanti).trim()).filter(Boolean))];
      if (namaGanti.length) {
        const gantiRows = await prisma.teacher.findMany({
          where: { nama: { in: namaGanti } },
          select: { id: true, nama: true },
        });
        gantiIdMap = new Map(gantiRows.map((g) => [g.nama, g.id]));
      }
    }

    // ── Untuk SETIAP guru × SETIAP tarikh → satu rekod ──
    for (const nama of namaList) {
      const guru = guruMap.get(nama);
      for (let cur = startMs; cur <= endMs; cur += MS_HARI) {
        const tarikhDate = new Date(cur);
        const hari = hariDari(tarikhDate);
        const tarikhKey = tarikhDate.toISOString().slice(0, 10); // YYYY-MM-DD (UTC, sepadan mulaStr/tamatStr)

        // Dedup: guru sama + tarikh sama + masih AKTIF (belum dipadam) → langkau
        const sediaAda = await prisma.absenceRecord.findFirst({
          where: { guruNama: guru.nama, tarikh: tarikhDate, statusBorang: 'AKTIF', deletedAt: null },
          select: { id: true },
        });
        if (sediaAda) {
          dilangkau++;
          continue;
        }

        // Pertukaran khusus untuk tarikh rekod SEMASA sahaja — elak cipta swap sama
        // untuk semua hari dalam julat. `p.tarikh` diutamakan; jika tiada (borang
        // lama / kes satu hari), anggap ia tarikh mula (serasi-belakang).
        const swapForTarikh = wantSwaps
          ? swapInput.filter((p) => (p.tarikh ? p.tarikh === tarikhKey : jumlahHari === 1 && tarikhKey === mulaStr))
          : [];

        // Jana reference + simpan dalam transaction; cuba semula sekali jika reference bertembung.
        // Pertukaran kelas dicipta DALAM transaksi yang SAMA → atomik dengan rekod.
        let record;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            record = await prisma.$transaction(async (tx) => {
              const reference = await generateReference(tx, tarikhDate);
              const rec = await tx.absenceRecord.create({
                data: {
                  guruNama: guru.nama,
                  hari,
                  tarikh: tarikhDate,
                  sebabKategori: sebab,
                  sebabDetail: catatan?.trim() || null,
                  jenis,
                  masaMula: jenis === 'SEPARUH_HARI' ? masaMula.trim() : null,
                  masaTamat: jenis === 'SEPARUH_HARI' ? masaTamat?.trim() || null : null,
                  perluGanti,
                  statusBorang: 'AKTIF',
                  submittedBy: guru.nama,
                  reference,
                  groupReference,
                },
              });

              // Pertukaran kelas — ATOMIK (rollback bersama rekod jika gagal).
              if (swapForTarikh.length) {
                await tx.classSwap.createMany({
                  data: swapForTarikh.map((p) => ({
                    absenceRecordId: rec.id,
                    guruAsal: rec.guruNama,
                    guruGanti: String(p.guruGanti).trim(),
                    teacherIdAsal: guru.id ?? null,
                    teacherIdGanti: gantiIdMap.get(String(p.guruGanti).trim()) ?? null,
                    scheduleId: p.scheduleId ?? null,
                    slot: p.slot ?? null,
                    hari: rec.hari,
                    tarikh: rec.tarikh,
                    kelas: String(p.kelas).trim(),
                    masa: normalkanMasa(p.masa), // normalisasi konsisten (sama spt enjin)
                    subjek: p.subjek ? String(p.subjek).trim() : null,
                    catatan: null,
                  })),
                });
              }
              return rec;
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

    // ── Telegram realtime — HANYA untuk tarikh AKTIF TERAWAL dalam submit ini ──
    //  Satu submit (walau banyak tarikh) → SATU snapshot PENUH sahaja, iaitu tarikh
    //  paling awal yang berada dalam window realtimenya sekarang. Tarikh lain akan
    //  dihantar oleh AUTO_EARLY/AUTO_MORNING pada giliran tarikh masing-masing.
    //  Cuba tarikh menaik: yang di luar window dilangkau gerbang (skipped:'GATE')
    //  → teruskan; tarikh PERTAMA yang lulus gerbang → hantar & berhenti.
    const _rtKey = (r) =>
      r.tarikh instanceof Date ? r.tarikh.toISOString().slice(0, 10) : String(r.tarikh);
    const tarikhUnikMenaik = [...new Set(rekodBaharu.map(_rtKey))].sort(); // "YYYY-MM-DD" menaik

    for (const key of tarikhUnikMenaik) {
      const rec = rekodBaharu.find((r) => _rtKey(r) === key);
      let res;
      try {
        res = await sendRealtime(rec, { ip: getClientIp(req) });
      } catch (e) {
        console.error('sendRealtime (createAbsence) ERROR:', e.message);
        break; // ralat tak dijangka → jangan cuba tarikh lain
      }
      // Lulus window (cuba dihantar) → berhenti. Di luar window (GATE) → cuba tarikh seterusnya.
      if (!(res && res.skipped && res.reason === 'GATE')) break;
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
