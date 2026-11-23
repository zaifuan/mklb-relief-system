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
import { cariBestCalon, semakGuruManual } from './candidate.service.js';
import { parseMasa, masaBertindih, normalkanMasa } from '../lib/timeUtil.js';
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

// ── K05: tugasan yang DIKEKALKAN semasa Jana Semula ──
//  DISAHKAN (disahkan admin), BATAL (sengaja dibatalkan — slot TIDAK diisi semula)
//  dan baris yang guru gantinya ditetapkan secara manual (diubahManual).
export const TIADA_PENGGANTI = 'TIADA_PENGGANTI';
// K05 v2 — statistik jadual (SATU sumber; dikongsi enjin & GET → sentiasa sama).
//  terisi = baris bukan BATAL dengan guru ganti SEBENAR (bukan null / TIADA_PENGGANTI)
//  kosong = slot − terisi (termasuk null, TIADA_PENGGANTI dan BATAL)
//  tier2  = relief kedua yang terisi
//  Hanya MENGIRA — nilai TIADA_PENGGANTI/BATAL dalam DB tidak diubah.
export function adaGuruGanti(a) {
  return a.status !== 'BATAL' && !!a.guruGanti && a.guruGanti !== TIADA_PENGGANTI;
}
export function kiraRingkasan(rows = []) {
  const slot = rows.length;
  const terisi = rows.filter(adaGuruGanti).length;
  return { slot, terisi, kosong: slot - terisi, tier2: rows.filter((a) => adaGuruGanti(a) && a.isTier2).length };
}
export const SEBAB_KONFLIK_PENDUA = 'Lebih daripada satu tugasan untuk kelas & masa yang sama — sila semak dan betulkan.';
export function dikekalkan(a) {
  return a.status === 'DISAHKAN' || a.status === 'BATAL' || a.diubahManual === true;
}
//  Cap jari set tugasan dikekalkan — dibanding semula di dalam transaksi simpan
//  supaya perubahan serentak tidak hilang secara senyap.
export function capKekal(assignments = []) {
  return assignments
    .filter(dikekalkan)
    .map((a) => `${a.id}:${a.status}:${a.guruGanti ?? ''}:${a.diubahManual ? 1 : 0}`)
    .sort()
    .join('|');
}

// ── ORCHESTRATOR ──────────────────────────────────────────
export async function janaJadualGanti({ tarikh, pengecualianKelas = [], fokusKelas = [], modReliefKecemasan = false }) {
  const kecemasan = modReliefKecemasan === true; // Kemaskini 03 — hanya true literal mengaktifkan mod
  const tarikhDate = tarikhKeUtcDate(tarikh);
  if (!tarikhDate) {
    const e = new Error('Format tarikh tidak sah (perlu YYYY-MM-DD).');
    e.code = 'BAD_DATE';
    throw e;
  }
  const hari = hariDari(tarikhDate); // ISNIN..JUMAAT
  const hUpper = hari.toUpperCase();

  // ── Muat semua data sekali gus ──
  const [jadualRows, absentAll, teachers, exclusions, config, existingBatch, specialSettings, classSwaps] = await Promise.all([
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
    // Hanya pertukaran yang terikat pada ketidakhadiran AKTIF (bukan dibatalkan/
    // dipadam) layak melangkau slot. Selaras penapis dashboard & PDF — sumber
    // kebenaran tunggal ialah status rekod ketidakhadiran.
    prisma.classSwap.findMany({
      where: { tarikh: tarikhDate, absenceRecord: { statusBorang: 'AKTIF', deletedAt: null } },
    }),
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

  // ── Pertukaran Kelas (Suka Sama Suka) — slot ini diambil alih guru lain
  //    secara persetujuan; ia BUKAN relief dan TIDAK perlu dijana relief.
  //    Bina set kunci (guru tidak hadir || kelas || masa) untuk dilangkau.
  //    Sistem berasaskan nama: padanan ikut norm(guruAsal) + kelas + masa
  //    (sama format seperti slot dalam jadualData).
  const swapSkip = new Set();
  for (const sw of classSwaps) {
    swapSkip.add(`${norm(sw.guruAsal)}||${String(sw.kelas || '').trim()}||${normalkanMasa(sw.masa)}`);
  }

  // Guru yang MENGAMBIL ALIH kelas (Suka Sama Suka) — sedang sibuk dengan kelas
  // yang diserahkan, jadi dikecualikan daripada SEMUA calon relief automatik pada
  // tarikh ini (sepanjang hari). classSwaps di atas sudah ditapis kepada
  // ketidakhadiran AKTIF sahaja → jika absence dibatalkan, guru ini kembali layak.
  const swapBuyers = new Set(classSwaps.map((sw) => norm(sw.guruGanti)));

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
      .filter((s) => !kelasKecualiPadaSlot(s.kelas, s.mula, s.tamat)) // CLASS_EXCLUSION (peka masa)
      .filter((s) => !swapSkip.has(`${n}||${s.kelas}||${normalkanMasa(s.masa)}`)); // Pertukaran kelas → langkau (BUKAN relief)

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

  // ── K05: tugasan dikekalkan → tuntut slot + kira sebagai beban guru SEBELUM
  //  calon baharu dipilih. Tanpa tugasan dikekalkan, blok ini tidak berbuat
  //  apa-apa (laluan enjin sama seperti asal).
  const kekalDalamSlot = [];
  const pendua = []; // tugasan terlindung kedua+ bagi slot sama — DIKEKALKAN & dilaporkan (tidak dipadam senyap)
  const tidakDiperlukan = [];
  const konflik = [];
  const tugasanKekal = (existingBatch?.assignments || []).filter(dikekalkan);
  if (tugasanKekal.length) {
    const kunciSlot = new Set(slotTasksTersusun.map((t) => `${norm(t.guruNama)}||${t.slot.kelas}||${t.slot.masa}`));
    for (const a of [...tugasanKekal].sort((x, y) => x.id - y.id)) {
      const k = `${norm(a.guruTakHadir)}||${a.kelas}||${a.masa}`;
      if (!kunciSlot.has(k)) {
        tidakDiperlukan.push({ id: a.id, guruTakHadir: a.guruTakHadir, kelas: a.kelas, masa: a.masa, guruGanti: a.guruGanti, status: a.status, diubahManual: !!a.diubahManual, sebab: 'SLOT_TIDAK_DIPERLUKAN' });
        continue;
      }
      if (diproses.has(k)) {
        pendua.push(a);
        konflik.push({ id: a.id, guruTakHadir: a.guruTakHadir, kelas: a.kelas, masa: a.masa, guruGanti: a.guruGanti, status: a.status, diubahManual: !!a.diubahManual, sebab: 'PENDUA', mesej: SEBAB_KONFLIK_PENDUA });
        continue;
      }
      diproses.add(k);
      kekalDalamSlot.push(a);
    }
    const bebanKekal = (a) => a.status !== 'BATAL' && a.guruGanti && a.guruGanti !== TIADA_PENGGANTI;
    for (const a of [...kekalDalamSlot, ...pendua]) {
      if (!bebanKekal(a)) continue;
      const g = norm(a.guruGanti);
      (gantiGlobal[g] = gantiGlobal[g] || []).push({ kelas: a.kelas, masa: a.masa, _kekalId: a.id });
    }
    // Sahkan setiap tugasan dikekalkan terhadap keadaan SEMASA (beban lain = tugasan dikekalkan lain)
    for (const a of kekalDalamSlot) {
      if (!bebanKekal(a)) continue;
      const [m, t] = parseMasa(a.masa);
      const lain = {};
      for (const [g, arr] of Object.entries(gantiGlobal)) lain[g] = arr.filter((x) => x._kekalId !== a.id);
      const s = semakGuruManual({
        guru: a.guruGanti, hari: hUpper, masaMula: m, masaTamat: t, semuaGuruHari, semuaAbsenSet, semuaAbsenMap,
        mapKategori, jadualData, gantiGlobal: lain, cacheSlotFree, cacheSlotMengajar, pengecualianList, guruKecualiList, swapBuyers, config,
      });
      if (!s.layak) konflik.push({ id: a.id, guruTakHadir: a.guruTakHadir, kelas: a.kelas, masa: a.masa, guruGanti: a.guruGanti, status: a.status, diubahManual: !!a.diubahManual, sebab: s.sebab, mesej: s.mesej });
    }
  }

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
      swapBuyers,
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
  //  Kemaskini 03 — Mod Relief Kecemasan: ambang thresholdPass2 diabaikan, dan
  //  relief kedua dibuka kepada SEMUA guru yang sudah ada TEPAT 1 relief (tanpa
  //  syarat tier2MaxSlotMengajar). Had keras 2 kekal kerana cariBestCalon hanya
  //  menerima Tier 2 jika bilanganGanti === 1. Calon relief pertama (Tier 1)
  //  tetap didahulukan; susunan slotMengajar menaik. Mod OFF → configP2 === config.
  const slotKosong = semuaHasilCadangan.filter((r) => r.guruGanti === null).length;
  const configP2 = kecemasan ? { ...config, hadDefault: 1, tier2MaxSlotMengajar: Number.POSITIVE_INFINITY } : config;
  const notaTier2 = kecemasan ? 'Relief kedua (2x) — Mod Kecemasan' : 'Relief kedua (2x)';
  // K05: ambang dikira atas SEMUA slot diperlukan (termasuk slot tugasan dikekalkan) — sama seperti asal
  if ((kecemasan || semuaHasilCadangan.length + kekalDalamSlot.length >= config.thresholdPass2) && slotKosong > 0) {
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
        swapBuyers,
        config: configP2,
      });
      const pP2 = calonP2[0] || null;
      if (pP2) {
        row.guruGanti = pP2.nama;
        row.kategori = pP2.kategori;
        row.isTier2 = !!pP2.isTier2;
        row.auditNote = pP2.isTier2 ? notaTier2 : null;
        const k = norm(pP2.nama);
        (gantiGlobal[k] = gantiGlobal[k] || []).push({ kelas: row.kelas, masa: row.masa });
      }
    }
  }

  // Buang medan dalaman
  const hasil = semuaHasilCadangan.map(({ _mula, ...r }) => r);

  // Ringkasan = jadual AKHIR (baris baharu + tugasan dikekalkan) — selaras dashboard
  const akhir = [...hasil, ...kekalDalamSlot, ...pendua];
  const ringkasan = kiraRingkasan(akhir); // K05 v2 — sama seperti GET

  return {
    tarikhDate,
    hari: hUpper,
    hasil,
    ringkasan,
    existingBatch,
    modReliefKecemasan: kecemasan,
    kekal: {
      ids: [...kekalDalamSlot, ...pendua].map((a) => a.id),
      cap: capKekal(existingBatch?.assignments || []),
      dikekalkan: kekalDalamSlot.length + pendua.length,
      tidakDiperlukan,
      konflik,
    },
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
// K05 — konteks harian dikongsi (dropdown calon, tukar guru manual, semakan konflik).
//  Diekstrak tanpa perubahan logik daripada senaraiCalonSemua asal.
export async function bacaKonteksHari(tarikhDate) {
  if (!tarikhDate) return null;
  const hUpper = hariDari(tarikhDate).toUpperCase();

  const [jadualRows, absentAll, teachers, exclusions, config, batch, specialSettings, classSwaps] = await Promise.all([
    prisma.teacherSchedule.findMany({ where: { hari: hUpper } }),
    prisma.absenceRecord.findMany({ where: { tarikh: tarikhDate, statusBorang: 'AKTIF', deletedAt: null } }),
    prisma.teacher.findMany(),
    prisma.reliefExclusion.findMany({ where: { tarikh: tarikhDate } }),
    loadReliefConfig(),
    prisma.reliefBatch.findUnique({ where: { tarikh: tarikhDate }, include: { assignments: true } }),
    prisma.dailySpecialSetting.findMany({ where: { tarikh: tarikhDate } }),
    prisma.classSwap.findMany({
      where: { tarikh: tarikhDate, absenceRecord: { statusBorang: 'AKTIF', deletedAt: null } },
    }),
  ]);

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

  // Guru yang MENGAMBIL ALIH kelas (Suka Sama Suka) pada tarikh ini — sibuk
  // sepanjang hari, jadi dikecualikan daripada senarai calon (selaras enjin auto).
  const swapBuyers = new Set(classSwaps.map((sw) => norm(sw.guruGanti)));

  return { hUpper, jadualData, semuaGuruHari, semuaAbsenSet, semuaAbsenMap, mapKategori, pengecualianList, guruKecualiList, cacheSlotFree, cacheSlotMengajar, swapBuyers, config, batch, bebanFlat };
}

export async function senaraiCalonSemua(tarikhDate, konteks = null) {
  if (!tarikhDate) return {};
  const ctx = konteks || (await bacaKonteksHari(tarikhDate));
  const { hUpper, jadualData, semuaGuruHari, semuaAbsenSet, semuaAbsenMap, mapKategori, pengecualianList, guruKecualiList, cacheSlotFree, cacheSlotMengajar, swapBuyers, config, batch, bebanFlat } = ctx;
  if (!batch) return {};

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
      swapBuyers,
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

// ════════════════════════════════════════════════════════════
//  K05 — semakKonflikBatch: sahkan setiap tugasan bergurur (bukan BATAL /
//  TIADA_PENGGANTI) terhadap keadaan SEMASA. Dikira semasa baca (tiada lajur
//  disimpan) → sentiasa tepat selepas absen/sekatan/jadual berubah.
// ════════════════════════════════════════════════════════════
export function semakKonflikBatch(ctx) {
  const out = {};
  if (!ctx?.batch) return out;
  // Pendua slot (sebarang status) — yang kedua dan seterusnya (id menaik) ditanda
  const dilihat = new Set();
  for (const a of [...ctx.batch.assignments].sort((x, y) => x.id - y.id)) {
    const k = `${norm(a.guruTakHadir)}||${a.kelas}||${a.masa}`;
    if (dilihat.has(k)) out[a.id] = { sebab: 'PENDUA', mesej: SEBAB_KONFLIK_PENDUA };
    dilihat.add(k);
  }
  for (const a of ctx.batch.assignments) {
    if (out[a.id]) continue;
    if (a.status === 'BATAL' || !a.guruGanti || a.guruGanti === TIADA_PENGGANTI) continue;
    const [m, t] = parseMasa(a.masa);
    if (m === null) continue;
    const lain = {};
    for (const x of ctx.bebanFlat) {
      if (x.fromId === a.id) continue;
      (lain[x.nama] = lain[x.nama] || []).push({ kelas: x.kelas, masa: x.masa });
    }
    const r = semakGuruManual({ guru: a.guruGanti, hari: ctx.hUpper, masaMula: m, masaTamat: t, ...ctx, gantiGlobal: lain });
    if (!r.layak) out[a.id] = { sebab: r.sebab, mesej: r.mesej };
  }
  return out;
}
