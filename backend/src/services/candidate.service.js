// ════════════════════════════════════════════════════════════
//  candidate.service.js — pemilihan calon guru ganti.
//  PORT TEPAT daripada reliefEngine.gs:
//    cariBestCalon · adaSekatanKhas · isFreepadaWaktu · semakRehat
//
//  Semua fungsi TULEN (tiada I/O) → mudah diuji unit. Data jadual
//  dihantar sebagai array objek { hari, guru, kelas, masa } di mana
//  `hari` dan `guru` sudah UPPERCASE; `kelas` ialah teks asal (trim).
//
//  Turutan keutamaan kekal seperti GAS asal:
//    slotMengajar menaik → kemudian gantiDapat menaik.
//  (Keputusan ZAI #3: ikut GAS, BUKAN prompt ringkas.)
// ════════════════════════════════════════════════════════════

import { masaKeMinit, parseMasa, masaBertindih } from '../lib/timeUtil.js';

const norm = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
const isFree = (kelas) => String(kelas || '').trim().toUpperCase() === 'FREE';

// ── SEKATAN KHAS ──────────────────────────────────────────
// SEKATAN_KHAS: [{ nama | "LELAKI", hari: [..], mulaDari, mulaHingga }]
export function adaSekatanKhas(namaGuru, hari, mula, tamat, SEKATAN_KHAS = []) {
  const g = norm(namaGuru);
  const h = String(hari).toUpperCase();
  for (const s of SEKATAN_KHAS) {
    if (s.nama === 'LELAKI') {
      if (!g.includes(' BIN ')) continue; // hanya guru lelaki
    } else if (norm(s.nama) !== g) {
      continue;
    }
    if (!(s.hari || []).includes(h)) continue;
    const sm = masaKeMinit(s.mulaDari);
    const st = masaKeMinit(s.mulaHingga);
    if (sm === null || st === null) continue;
    if (mula < st && tamat > sm) return true;
  }
  return false;
}

// ── FREE PADA WAKTU ───────────────────────────────────────
// true jika guru TIADA slot mengajar (kelas != FREE) yang bertindih.
export function isFreepadaWaktu(namaGuru, hari, mula, tamat, jadualData) {
  const g = norm(namaGuru);
  const h = String(hari).toUpperCase();
  for (const row of jadualData) {
    if (row.hari !== h || norm(row.guru) !== g || isFree(row.kelas)) continue;
    const [m, t] = parseMasa(row.masa);
    if (m !== null && masaBertindih(m, t, mula, tamat)) return false;
  }
  return true;
}

// ── SEMAK REHAT ───────────────────────────────────────────
// Mesti ada jurang: relief baru TIDAK boleh bersambung terus dengan
// mana-mana slot mengajar ATAU relief sedia ada (tamat==mula / mula==tamat).
export function semakRehat(namaGuru, hari, mula, tamat, jadualData, gantiSession) {
  const g = norm(namaGuru);
  const h = String(hari).toUpperCase();
  const sibuk = [];

  for (const row of jadualData) {
    if (row.hari !== h || norm(row.guru) !== g || isFree(row.kelas)) continue;
    const [m, t] = parseMasa(row.masa);
    if (m !== null) sibuk.push({ mula: m, tamat: t });
  }

  const sesi = gantiSession[namaGuru] || gantiSession[g];
  if (sesi) {
    for (const x of sesi) {
      const [m, t] = parseMasa(x.masa);
      if (m !== null) sibuk.push({ mula: m, tamat: t });
    }
  }

  for (const s of sibuk) {
    if (mula === s.tamat) return false; // relief terus selepas slot sibuk
    if (tamat === s.mula) return false; // slot sibuk terus selepas relief
  }
  return true;
}

// ── CARI CALON TERBAIK ────────────────────────────────────
// Pulangkan array calon terurut. Tier 1 (belum dapat relief) diutamakan;
// jika tiada, pulangkan Tier 2 (relief kedua) — hanya untuk PASS 2.
export function cariBestCalon({
  semuaGuruHari,
  hari,
  masaMula,
  masaTamat,
  semuaAbsenSet,
  semuaAbsenMap,
  mapKategori,
  jadualData,
  gantiGlobal,
  cacheSlotFree,
  cacheSlotMengajar,
  hadSlotOverride, // null = PASS 2 (benarkan Tier 2)
  pengecualianList = [],
  guruKecualiList = [],
  swapBuyers, // Set<normNama>: guru yang MENGAMBIL ALIH kelas (class_swaps) — sibuk sepanjang hari
  config,
}) {
  const calon = []; // Tier 1
  const calonTier2 = []; // Tier 2
  const hUpper = String(hari).toUpperCase();
  const hadDefault = config?.hadDefault ?? 1;
  const tier2Max = config?.tier2MaxSlotMengajar ?? 2;
  const KATEGORI_EXEMPT = config?.KATEGORI_EXEMPT ?? [];
  const NAMA_EXEMPT = config?.NAMA_EXEMPT ?? [];
  const SEKATAN_KHAS = config?.SEKATAN_KHAS ?? [];

  for (const namaGuru of semuaGuruHari) {
    const n = norm(namaGuru);

    // 0) Pertukaran Kelas (Suka Sama Suka): guru yang MENGAMBIL ALIH mana-mana
    //    kelas pada hari ini sedang sibuk → TIDAK boleh jadi calon relief untuk
    //    mana-mana slot pada hari yang SAMA. (Guru tidak hadir asal sudah
    //    dikecualikan melalui semuaAbsenSet/semuaAbsenMap.)
    if (swapBuyers && swapBuyers.has(n)) continue;

    // 1) Absen peka masa
    if (semuaAbsenMap && semuaAbsenMap[n]) {
      let absen = false;
      for (const ab of semuaAbsenMap[n]) {
        if (masaBertindih(masaMula, masaTamat, ab.masaMula, ab.masaTamat)) {
          absen = true;
          break;
        }
      }
      if (absen) continue;
    } else if (semuaAbsenSet && semuaAbsenSet.has(n)) {
      continue;
    }

    // 2) Pengecualian relief khas (harian)
    if (pengecualianList && pengecualianList.length) {
      let dikecualikan = false;
      for (const p of pengecualianList) {
        if (norm(p.nama) !== n) continue;
        if (p.mod === 'SEPANJANG_HARI') {
          dikecualikan = true;
          break;
        }
        if (p.mod === 'SLOT') {
          const pMula = masaKeMinit(p.masaDari);
          const pTamat = masaKeMinit(p.masaHingga);
          if (masaBertindih(masaMula, masaTamat, pMula, pTamat)) {
            dikecualikan = true;
            break;
          }
        }
      }
      if (dikecualikan) continue;
    }

    // 2b) Tetapan Khas Jadual — TEACHER_EXCLUSION (FULL_DAY atau TIME_RANGE)
    if (guruKecualiList && guruKecualiList.length) {
      let blok = false;
      for (const g of guruKecualiList) {
        if (g.n !== n) continue;
        if (g.full || masaBertindih(masaMula, masaTamat, g.mula, g.tamat)) {
          blok = true;
          break;
        }
      }
      if (blok) continue;
    }

    // 3) Kategori & nama exempt
    const kategori = mapKategori[n] || 'BIASA';
    if (KATEGORI_EXEMPT.includes(kategori)) continue;
    if (NAMA_EXEMPT.includes(n)) continue;

    // 4) Sekatan khas + free + rehat
    if (adaSekatanKhas(namaGuru, hUpper, masaMula, masaTamat, SEKATAN_KHAS)) continue;
    if (!isFreepadaWaktu(namaGuru, hUpper, masaMula, masaTamat, jadualData)) continue;
    if (!semakRehat(namaGuru, hUpper, masaMula, masaTamat, jadualData, gantiGlobal)) continue;

    const senaraiGanti = gantiGlobal[namaGuru] || gantiGlobal[n] || [];
    const bilanganGanti = senaraiGanti.length;

    // 5) Elak relief bertindih (walaupun bilangan < had)
    if (bilanganGanti > 0) {
      let overlap = false;
      for (const x of senaraiGanti) {
        const [gMula, gTamat] = parseMasa(x.masa);
        if (gMula !== null && masaBertindih(masaMula, masaTamat, gMula, gTamat)) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;
    }

    const slotFree = cacheSlotFree[n]?.[hUpper] || 0;
    const slotMengajar = cacheSlotMengajar[n]?.[hUpper] || 0;

    // 6) Had relief sehari (default 1) — kecuali Tier 2 pada PASS 2
    const hadSlot = hadSlotOverride !== null ? hadSlotOverride : hadDefault;
    if (bilanganGanti >= hadSlot) {
      if (hadSlotOverride === null && bilanganGanti === 1 && slotMengajar <= tier2Max) {
        calonTier2.push({ nama: namaGuru, kategori, gantiDapat: bilanganGanti, slotMengajar, slotFree, isTier2: true });
      }
      continue;
    }
    calon.push({ nama: namaGuru, kategori, gantiDapat: bilanganGanti, slotMengajar, slotFree, isTier2: false });
  }

  // Susun: slotMengajar ↑ kemudian gantiDapat ↑  (ikut GAS asal)
  const sortKaedah = (a, b) =>
    a.slotMengajar !== b.slotMengajar ? a.slotMengajar - b.slotMengajar : a.gantiDapat - b.gantiDapat;

  calon.sort(sortKaedah);
  if (calon.length > 0) return calon;

  calonTier2.sort(sortKaedah);
  return calonTier2;
}
