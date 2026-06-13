// ════════════════════════════════════════════════════════════
//  relief.service.js — orchestrator jana jadual ganti.
//  PORT TEPAT aliran janaJadualGanti() dari reliefEngine.gs (two-pass).
//
//  ADAPTASI BORANG FASA 4 (penting):
//    Borang ketidakhadiran Fasa 4 menyimpan kelas = "-" dan perluGanti = true
//    (kad kelas/sub-kelas ditangguh). Maka enjin menganggap setiap rekod
//    AKTIF + perluGanti sebagai "SEMUA" → ganti SEMUA slot mengajar guru itu
//    pada hari berkenaan (laluan SEMUA enjin asal). SEPARUH_HARI menapis slot
//    bermula masaMula. Pemilihan sub-kelas tertentu (#8) belum diimplement —
//    struktur disediakan (pengecualianKelas / fokusKelas) tetapi tidak aktif.
//
//  Persediaan modul akan datang (TIDAK aktif di Fasa 6):
//    • pengecualianKelas / fokusKelas — Tetapan Khas admin
//    • Suka Sama Suka (#7) — hook sebelum cariBestCalon
// ════════════════════════════════════════════════════════════

import prisma from '../lib/prisma.js';
import { hariDari } from '../lib/absenceUtil.js';
import { loadReliefConfig } from '../lib/reliefConfig.js';
import { cariBestCalon } from './candidate.service.js';
import { parseMasa, masaBertindih } from '../lib/timeUtil.js';
import { julatTidakHadir, slotDalamJulat, masaKeMinitAuto } from '../lib/absenceWindow.js';

const norm = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
const isFreeKelas = (k) => String(k || '').trim().toUpperCase() === 'FREE';

function tarikhKeUtcDate(tarikhStr) {
  const m = String(tarikhStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

class ReliefLockedError extends Error {
  constructor(status) {
    super(`Batch sudah berstatus ${status} — jana semula tidak dibenarkan.`);
    this.code = 'LOCKED';
    this.statusBatch = status;
  }
}
export { ReliefLockedError };

// ── ORCHESTRATOR ──────────────────────────────────────────
export async function janaJadualGanti({ tarikh, pengecualianKelas = [], fokusKelas = [] }) {
  const tarikhDate = tarikhKeUtcDate(tarikh);
  if (!tarikhDate) {
    const e = new Error('Format tarikh tidak sah (perlu YYYY-MM-DD).');
    e.code = 'BAD_DATE';
    throw e;
  }
  const hari = hariDari(tarikhDate); // ISNIN..JUMAAT
  const hUpper = hari.toUpperCase();

  // ── Muat semua data sekali gus ──
  const [jadualRows, absentAll, teachers, exclusions, config, existingBatch, specialSettings] = await Promise.all([
    prisma.teacherSchedule.findMany({ where: { hari: hUpper } }),
    prisma.absenceRecord.findMany({
      where: { tarikh: tarikhDate, statusBorang: 'AKTIF', deletedAt: null },
      orderBy: { id: 'asc' },
    }),
    prisma.teacher.findMany(),
    prisma.reliefExclusion.findMany({ where: { tarikh: tarikhDate } }),
    loadReliefConfig(),
    prisma.reliefBatch.findUnique({ where: { tarikh: tarikhDate }, include: { assignments: true } }),
    prisma.dailySpecialSetting.findMany({ where: { tarikh: tarikhDate } }),
  ]);

  // Halang jana semula jika sudah DIHANTAR / SELESAI (keputusan #4)
  if (existingBatch && ['DIHANTAR', 'SELESAI'].includes(existingBatch.status)) {
    throw new ReliefLockedError(existingBatch.status);
  }

  // ── Jadual hari ini (uppercase hari/guru) ──
  const jadualData = jadualRows.map((r) => ({
    hari: String(r.hari).trim().toUpperCase(),
    guru: norm(r.guru),
    kelas: String(r.kelas || '').trim(),
    masa: String(r.masa || '').trim(),
    subjek: r.subjek ? String(r.subjek).trim() : '',
  }));

  // ── Tetapan Khas Jadual (harian) — peka scope FULL_DAY / TIME_RANGE ──
  const normKelas = (k) => String(k || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const HUJUNG = 1440; // "Tamat sekolah" (hujung hari) dalam minit
  const buatJulat = (s) => {
    if (s.scope === 'TIME_RANGE') {
      const mula = masaKeMinitAuto(s.masaMula);
      const tamat = s.masaTamat ? masaKeMinitAuto(s.masaTamat) : HUJUNG; // null = Tamat sekolah
      return { full: false, mula: mula ?? 0, tamat: tamat ?? HUJUNG };
    }
    return { full: true, mula: 0, tamat: HUJUNG };
  };
  const guruKecualiList = []; // { n, full, mula, tamat } — TEACHER_EXCLUSION
  const kelasKecualiList = []; // { k, full, mula, tamat } — CLASS_EXCLUSION
  const kelasUtamaList = []; // { k, full, mula, tamat } — PRIORITY_CLASS
  for (const s of specialSettings) {
    const j = buatJulat(s);
    if (s.jenis === 'TEACHER_EXCLUSION') guruKecualiList.push({ n: norm(s.target), ...j });
    else if (s.jenis === 'CLASS_EXCLUSION') kelasKecualiList.push({ k: normKelas(s.target), ...j });
    else if (s.jenis === 'PRIORITY_CLASS') kelasUtamaList.push({ k: normKelas(s.target), ...j });
  }
  // Adakah kelas dikecualikan / keutamaan untuk slot [mula,tamat]?
  const kelasKecualiPadaSlot = (kelas, mula, tamat) => {
    const k = normKelas(kelas);
    return kelasKecualiList.some((e) => e.k === k && (e.full || masaBertindih(mula, tamat, e.mula, e.tamat)));
  };
  const kelasUtamaPadaSlot = (kelas, mula, tamat) => {
    const k = normKelas(kelas);
    return kelasUtamaList.some((e) => e.k === k && (e.full || masaBertindih(mula, tamat, e.mula, e.tamat)));
  };

  // Pool calon = guru yang ada slot pada hari ini.
  // Pengecualian guru (peka masa) dikendalikan dalam cariBestCalon via guruKecualiList.
  const semuaGuruHari = [...new Set(jadualData.map((r) => r.guru))].filter(Boolean);

  // mapKategori { NAMA: KATEGORI }
  const mapKategori = {};
  for (const t of teachers) mapKategori[norm(t.nama)] = norm(t.kategori);

  // Set/Map guru absen PEKA MASA untuk semak calon.
  //   SEPARUH_HARI → dikecualikan sebagai calon HANYA dalam julat tidak hadir;
  //   di luar julat, guru itu boleh dipilih sebagai guru ganti seperti biasa.
  const semuaAbsenSet = new Set();
  const semuaAbsenMap = {};
  for (const a of absentAll) {
    const n = norm(a.guruNama);
    semuaAbsenSet.add(n);
    (semuaAbsenMap[n] = semuaAbsenMap[n] || []).push(julatTidakHadir(a.jenis, a.masaMula, a.masaTamat));
  }

  // Senarai pengecualian relief (harian)
  const pengecualianList = exclusions.map((p) => ({
    nama: p.guruNama,
    mod: String(p.mod).toUpperCase(),
    masaDari: p.masaDari,
    masaHingga: p.masaHingga,
  }));

  // Cache slot FREE & MENGAJAR per guru / hari
  const cacheSlotFree = {};
  const cacheSlotMengajar = {};
  for (const r of jadualData) {
    const g = r.guru;
    if (!g) continue;
    cacheSlotFree[g] = cacheSlotFree[g] || {};
    cacheSlotMengajar[g] = cacheSlotMengajar[g] || {};
    cacheSlotFree[g][r.hari] = (cacheSlotFree[g][r.hari] || 0) + (isFreeKelas(r.kelas) ? 1 : 0);
    cacheSlotMengajar[g][r.hari] =
      (cacheSlotMengajar[g][r.hari] || 0) + (!isFreeKelas(r.kelas) && r.kelas ? 1 : 0);
  }

  // Jana SEPENUHNYA baharu berdasarkan rekod AKTIF semasa.
  // (Tiada konsep "kekalkan DISAHKAN" — baris lama telah dibuang oleh simpanReliefBatch.)
  const gantiGlobal = {};

  // ── Senarai guru tak hadir yang perlu ganti (layan sebagai SEMUA) ──
  const guruPerluGanti = absentAll.filter((a) => a.perluGanti === true);

  // Bina slot setiap guru + masa paling awal (untuk susunan)
  const tugasan = guruPerluGanti.map((a) => {
    const n = norm(a.guruNama);
    let slots = jadualData
      .filter((r) => r.guru === n && !isFreeKelas(r.kelas) && r.kelas)
      .map((r) => {
        const [mula, tamat] = parseMasa(r.masa);
        return { kelas: r.kelas, masa: r.masa, subjek: r.subjek, mula, tamat };
      })
      .filter((s) => s.mula !== null)
      .filter((s) => !kelasKecualiPadaSlot(s.kelas, s.mula, s.tamat)); // CLASS_EXCLUSION (peka masa)

    // SEPARUH_HARI → hanya slot yang BERTINDIH julat tidak hadir
    //   [masaMula, masaTamat || hujung hari]. Slot di luar julat: guru hadir,
    //   tidak perlu diganti (lihat absenceWindow.js).
    if (a.jenis === 'SEPARUH_HARI') {
      const julat = julatTidakHadir(a.jenis, a.masaMula, a.masaTamat);
      slots = slots.filter((s) => slotDalamJulat(s.mula, s.tamat, julat));
    }

    slots.sort((x, y) => (x.mula || 0) - (y.mula || 0));
    const awal = slots.length ? slots[0].mula : 999;
    return { guruNama: a.guruNama, jenis: a.jenis, slots, awal };
  });

  // Susun guru ikut waktu slot pertama (seperti GAS)
  tugasan.sort((a, b) => a.awal - b.awal);

  // ── Susun slot: PRIORITY_CLASS dahulu (PASS 0), kemudian kelas biasa (PASS 1) ──
  //  Stable partition (Array.sort di Node adalah stabil): tanpa kelas keutamaan,
  //  urutan kekal SAMA seperti asal (logik & golden tests sedia ada tidak terjejas).
  const slotTasksTersusun = [];
  for (const t of tugasan) {
    for (const slot of t.slots) {
      slotTasksTersusun.push({ guruNama: t.guruNama, slot, prio: kelasUtamaPadaSlot(slot.kelas, slot.mula, slot.tamat) ? 0 : 1 });
    }
  }
  slotTasksTersusun.sort((a, b) => a.prio - b.prio);

  // ── PASS 1 ────────────────────────────────────────────
  const semuaHasilCadangan = [];
  const diproses = new Set();

  for (const task of slotTasksTersusun) {
    const guruNama = task.guruNama;
    const slot = task.slot;
    const slotKey = `${norm(guruNama)}||${slot.kelas}||${slot.masa}`;
    if (diproses.has(slotKey)) continue;
    const masaMula = slot.mula;
    const masaTamat = slot.tamat;
    if (masaMula === null) continue;

    const calon = cariBestCalon({
      semuaGuruHari,
      hari: hUpper,
      masaMula,
      masaTamat,
      semuaAbsenSet,
      semuaAbsenMap,
      mapKategori,
      jadualData,
      gantiGlobal,
      cacheSlotFree,
      cacheSlotMengajar,
      hadSlotOverride: 1,
      pengecualianList,
      guruKecualiList,
      config,
    });
    const pilihan = calon[0] || null;

    semuaHasilCadangan.push({
      guruTakHadir: guruNama,
      tarikh: tarikhDate,
      kelas: slot.kelas,
      masa: slot.masa,
      hari: hUpper,
      guruGanti: pilihan ? pilihan.nama : null,
      kategori: pilihan ? pilihan.kategori : null,
      status: 'CADANGAN',
      isTier2: pilihan ? !!pilihan.isTier2 : false,
      auditNote: pilihan ? (pilihan.isTier2 ? 'Relief kedua (2x)' : null) : 'Tiada calon sesuai',
      subjek: slot.subjek || null,
      _mula: masaMula,
    });

    diproses.add(slotKey);
    if (pilihan) {
      const k = norm(pilihan.nama);
      (gantiGlobal[k] = gantiGlobal[k] || []).push({ kelas: slot.kelas, masa: slot.masa });
    }
  }

  // ── PASS 2: isi slot kosong jika banyak slot ──
  const slotKosong = semuaHasilCadangan.filter((r) => r.guruGanti === null).length;
  if (semuaHasilCadangan.length >= config.thresholdPass2 && slotKosong > 0) {
    for (const row of semuaHasilCadangan) {
      if (row.guruGanti !== null) continue;
      const [mP2, tP2] = parseMasa(row.masa);
      if (mP2 === null) continue;

      const calonP2 = cariBestCalon({
        semuaGuruHari,
        hari: hUpper,
        masaMula: mP2,
        masaTamat: tP2,
        semuaAbsenSet,
        semuaAbsenMap,
        mapKategori,
        jadualData,
        gantiGlobal,
        cacheSlotFree,
        cacheSlotMengajar,
        hadSlotOverride: null, // benarkan Tier 2
        pengecualianList,
        guruKecualiList,
        config,
      });
      const pP2 = calonP2[0] || null;
      if (pP2) {
        row.guruGanti = pP2.nama;
        row.kategori = pP2.kategori;
        row.isTier2 = !!pP2.isTier2;
        row.auditNote = pP2.isTier2 ? 'Relief kedua (2x)' : null;
        const k = norm(pP2.nama);
        (gantiGlobal[k] = gantiGlobal[k] || []).push({ kelas: row.kelas, masa: row.masa });
      }
    }
  }

  // Buang medan dalaman
  const hasil = semuaHasilCadangan.map(({ _mula, ...r }) => r);

  const ringkasan = {
    slot: hasil.length,
    terisi: hasil.filter((r) => r.guruGanti !== null).length,
    kosong: hasil.filter((r) => r.guruGanti === null).length,
    tier2: hasil.filter((r) => r.isTier2).length,
  };

  return {
    tarikhDate,
    hari: hUpper,
    hasil,
    ringkasan,
    existingBatch,
    adaAbsen: absentAll.length > 0,
    adaPerluGanti: guruPerluGanti.length > 0,
  };
}

// ════════════════════════════════════════════════════════════
//  senaraiCalonSemua(tarikhDate) — untuk dropdown "tukar guru ganti".
//  Bina konteks SAMA seperti janaJadualGanti, kemudian pulangkan SEMUA
//  calon sah (Tier 1, atau Tier 2 jika tiada Tier 1) bagi setiap
//  assignment BUKAN-BATAL dalam batch tarikh ini.
//  TIDAK menyentuh janaJadualGanti / cariBestCalon (enjin kekal terkunci).
//  Pulangan: { [assignmentId]: [{ nama, reason, reliefCountToday }] }
// ════════════════════════════════════════════════════════════
export async function senaraiCalonSemua(tarikhDate) {
  if (!tarikhDate) return {};
  const hUpper = hariDari(tarikhDate).toUpperCase();

  const [jadualRows, absentAll, teachers, exclusions, config, batch, specialSettings] = await Promise.all([
    prisma.teacherSchedule.findMany({ where: { hari: hUpper } }),
    prisma.absenceRecord.findMany({ where: { tarikh: tarikhDate, statusBorang: 'AKTIF', deletedAt: null } }),
    prisma.teacher.findMany(),
    prisma.reliefExclusion.findMany({ where: { tarikh: tarikhDate } }),
    loadReliefConfig(),
    prisma.reliefBatch.findUnique({ where: { tarikh: tarikhDate }, include: { assignments: true } }),
    prisma.dailySpecialSetting.findMany({ where: { tarikh: tarikhDate } }),
  ]);
  if (!batch) return {};

  const jadualData = jadualRows.map((r) => ({
    hari: String(r.hari).trim().toUpperCase(),
    guru: norm(r.guru),
    kelas: String(r.kelas || '').trim(),
    masa: String(r.masa || '').trim(),
    subjek: r.subjek ? String(r.subjek).trim() : '',
  }));

  // TEACHER_EXCLUSION (peka scope) — satu-satunya tetapan khas yang menapis CALON.
  // (CLASS_EXCLUSION & PRIORITY_CLASS menapis/menyusun SLOT semasa jana, bukan calon.)
  const HUJUNG = 1440;
  const guruKecualiList = [];
  for (const s of specialSettings) {
    if (s.jenis !== 'TEACHER_EXCLUSION') continue;
    if (s.scope === 'TIME_RANGE') {
      const mula = masaKeMinitAuto(s.masaMula);
      const tamat = s.masaTamat ? masaKeMinitAuto(s.masaTamat) : HUJUNG;
      guruKecualiList.push({ n: norm(s.target), full: false, mula: mula ?? 0, tamat: tamat ?? HUJUNG });
    } else {
      guruKecualiList.push({ n: norm(s.target), full: true, mula: 0, tamat: HUJUNG });
    }
  }

  const semuaGuruHari = [...new Set(jadualData.map((r) => r.guru))].filter(Boolean);
  const mapKategori = {};
  for (const t of teachers) mapKategori[norm(t.nama)] = norm(t.kategori);

  const semuaAbsenSet = new Set();
  const semuaAbsenMap = {};
  for (const a of absentAll) {
    const n = norm(a.guruNama);
    semuaAbsenSet.add(n);
    (semuaAbsenMap[n] = semuaAbsenMap[n] || []).push(julatTidakHadir(a.jenis, a.masaMula, a.masaTamat));
  }
  const pengecualianList = exclusions.map((p) => ({
    nama: p.guruNama,
    mod: String(p.mod).toUpperCase(),
    masaDari: p.masaDari,
    masaHingga: p.masaHingga,
  }));

  const cacheSlotFree = {};
  const cacheSlotMengajar = {};
  for (const r of jadualData) {
    const g = r.guru;
    if (!g) continue;
    cacheSlotFree[g] = cacheSlotFree[g] || {};
    cacheSlotMengajar[g] = cacheSlotMengajar[g] || {};
    cacheSlotFree[g][r.hari] = (cacheSlotFree[g][r.hari] || 0) + (isFreeKelas(r.kelas) ? 1 : 0);
    cacheSlotMengajar[g][r.hari] = (cacheSlotMengajar[g][r.hari] || 0) + (!isFreeKelas(r.kelas) && r.kelas ? 1 : 0);
  }

  // Beban relief sedia ada (semua assignment bukan-BATAL) → {nama,kelas,masa,fromId}
  // "TIADA_PENGGANTI" bukan guru sebenar — jangan kira sebagai beban.
  const bebanFlat = [];
  for (const a of batch.assignments) {
    if (a.status === 'BATAL' || !a.guruGanti || a.guruGanti === 'TIADA_PENGGANTI') continue;
    bebanFlat.push({ nama: norm(a.guruGanti), kelas: a.kelas, masa: a.masa, fromId: a.id });
  }

  const hasil = {};
  for (const a of batch.assignments) {
    if (a.status === 'BATAL') {
      hasil[a.id] = [];
      continue;
    }
    const [mula, tamat] = parseMasa(a.masa);
    if (mula === null) {
      hasil[a.id] = [];
      continue;
    }

    // gantiGlobal = beban SEMUA kecuali assignment ini sendiri
    const gantiGlobal = {};
    for (const x of bebanFlat) {
      if (x.fromId === a.id) continue;
      (gantiGlobal[x.nama] = gantiGlobal[x.nama] || []).push({ kelas: x.kelas, masa: x.masa });
    }

    const arr = cariBestCalon({
      semuaGuruHari,
      hari: hUpper,
      masaMula: mula,
      masaTamat: tamat,
      semuaAbsenSet,
      semuaAbsenMap,
      mapKategori,
      jadualData,
      gantiGlobal,
      cacheSlotFree,
      cacheSlotMengajar,
      hadSlotOverride: null, // senarai seluas mungkin (Tier 1, atau Tier 2 jika perlu)
      pengecualianList,
      guruKecualiList,
      config,
    });

    const calon = arr.map((c) => ({
      nama: c.nama,
      reason: c.isTier2 ? 'Relief kedua' : c.slotFree > 0 ? 'Free slot' : 'Layak',
      reliefCountToday: gantiGlobal[norm(c.nama)]?.length || 0,
    }));

    // Pastikan pilihan semasa sentiasa wujud (di atas senarai)
    if (a.guruGanti && !calon.some((c) => c.nama === a.guruGanti)) {
      calon.unshift({
        nama: a.guruGanti,
        reason: 'Pilihan semasa',
        reliefCountToday: gantiGlobal[norm(a.guruGanti)]?.length || 0,
      });
    }
    hasil[a.id] = calon;
  }
  return hasil;
}
