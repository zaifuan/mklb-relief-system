// ════════════════════════════════════════════════════════════
//  snapshot.service.js — bina teks snapshot ketidakhadiran guru.
//
//  Format selaras telegram.gs + penambahbaikan (FASA 7):
//    Susunan: MC / CRK / CTR → PROGRAM DI SEKOLAH → PROGRAM DI LUAR
//             SEKOLAH → LAIN-LAIN. Seksyen kosong DISEMBUNYIKAN.
//    • MC/CRK/CTR : "• Nama - JENIS" (tiada detail).
//    • Program/Lain-lain : rekod dgn (jenis+masa+catatan) SAMA dikumpul →
//        senarai nama bullet, baris (masa), baris "Catatan: …".
//
//  Format baharu (snapshot biasa/auto/realtime) — penambahbaikan grouping:
//    • Setiap kategori (termasuk MC/CRK/CTR) ada senarai nama BERNOMBOR,
//      nombor berterusan dalam kategori tersebut (mulai dari 1).
//    • Dalam kategori utama yang sama, nama guru dikumpulkan lagi ikut
//      catatan/sebabDetail yang SAMA.
//    • Catatan sama → semua nama bernombor dulu, kemudian catatan sekali
//      di bawah ("- <i>...</i>"). Tidak berulang.
//    • Catatan berbeza → kumpulan berbeza dalam kategori yang sama (nombor
//      tetap berterusan merentas kumpulan dalam kategori tersebut).
//    • Catatan kosong → nama bernombor sahaja, tanpa tanda dash/Catatan:.
//    • Masa : SEPANJANG_HARI → "(Sehari Penuh)";
//             SEPARUH_HARI   → "(7:30 pagi - tamat sekolah)".
//    • Header manual "KEMASKINI KETIDAKHADIRAN GURU" / auto "KETIDAKHADIRAN
//      GURU". Footer "Kemaskini terakhir: <masa>" (auto guna masa tetapan).
//    • Plain text — sendMessage sahaja, jangan edit/padam mesej lama.
//
//  Tempoh ketidakhadiran (Patch v1 + v2 — format & sumber julat tarikh):
//    • MC/CRK/CTR : TIDAK PERNAH papar SEPANJANG/SEPARUH HARI atau masa.
//        Satu hari → nama sahaja. Multi-day → nama + julat tarikh ASAL
//        submission ("1 OGOS 2026 - 3 OGOS 2026") pada baris berasingan.
//    • Program Sekolah/Luar/Lain-lain : SETIAP nama (walaupun dikumpul
//        sekali dgn guru lain ikut catatan sama) papar baris tempoh sendiri:
//        julat tarikh (jika multi-day) + status SEPANJANG HARI /
//        SEPARUH HARI (10:45 AM - TAMAT SEKOLAH) — guna masa SEBENAR dari
//        rekod, bukan reka.
//    • SUMBER julat tarikh (Patch v2 — diperketatkan):
//        (1) groupReference WUJUD — SOURCE OF TRUTH, tiada heuristic. Sejak
//            Patch v2, absence.controller.js jana groupReference bagi
//            MANA-MANA submission yang hasilkan >1 AbsenceRecord (bukan lagi
//            terhad kpd ≥2 guru serentak — kes UTAMA "1 guru × multi-day"
//            kini turut dapat identifier sebenar, lihat perluGroupReference()
//            dlm absence.controller.js). Julat = min/max tarikh rekod AKTIF
//            bagi GURU YANG SAMA + groupReference YANG SAMA sahaja (tidak
//            bercampur dgn guru lain dlm group multi-guru yang sama).
//        (2) groupReference KOSONG — LEGACY FALLBACK sahaja (rekod sebelum
//            Patch v2, atau submission 1-guru-1-hari yg sengaja kekal null).
//            Dikesan semula melalui rekod BERTURUTAN (tarikh bersebelahan)
//            bagi guru+kategori+catatan+jenis+masa yang SAMA, DITAMBAH
//            kekangan createdAt berdekatan (elak gabung dua submission
//            single-day BERASINGAN yang kebetulan serupa — lihat
//            LEGACY_HEURISTIC_TOLERANS_CREATED_AT_MS). BUKAN 100% tepat —
//            lihat laporan Patch v2, seksyen risiko.
//        SATU query batch sahaja setiap snapshot (elak N+1), tidak kira
//        laluan (1) atau (2) — lihat hitungTempohRekod.
//    • Laluan PEMBATALAN (renderKumpulan/masaLabel di bawah) SENGAJA tidak
//        disentuh — kekal format lama.
//
//  Patch v3.1 — dedup metadata Program/Lain-lain sahaja (presentation-only,
//  tiada logik tempoh/data disentuh): dlm SATU kumpulan catatan, jika SEMUA
//  guru (>1) berkongsi metadata string yang SAMA (termasuk sama2 kosong),
//  metadata dipaparkan SEKALI selepas senarai nama rapat (bukan per-guru).
//  Metadata berbeza, ATAU cuma 1 guru dlm kumpulan → format V3 asal kekal.
//  Lihat semuaMetadataSama()/binaBlokKumpulanCatatan() di bawah. MC/CRK/CTR,
//  header/footer/format tarikh/waktu, hitungTempohRekod() — semua FROZEN,
//  tidak disentuh.
//
//  Patch v3 — PAPARAN SAHAJA (tiada logik data/tempoh diubah; peraturan V1/V2
//  di atas kekal 100% BENAR dari segi ISI KANDUNGAN — cuma BENTUK teks
//  berubah):
//    • Header: "D Bulan. YYYY · Hari" (Title Case), TIADA label "Tarikh:"/
//        "Hari:" berasingan.
//    • Julat tarikh multi-day: format RINGKAS ("2-4 Sept.", "30 Ogos-2
//        Sept.", "30 Dis. 2026-2 Jan. 2027" — lihat formatJulatTarikhPendek)
//        gantikan format panjang ("1 OGOS 2026 - 4 OGOS 2026").
//    • Status sepanjang/separuh hari: baris metadata Program/Lain-lain kini
//        SATU baris ringkas — julat tarikh (jika multi-day) + waktu ringkas
//        "10:45 AM-Tamat" (jika separuh hari), digabung "·" bila kedua-dua
//        wujud — GANTIKAN "SEPANJANG HARI"/"SEPARUH HARI (...)" penuh.
//        Single-day + sepanjang hari → TIADA baris metadata langsung.
//    • Catatan: "<i>...</i>" (tanda "- " dibuang). Footer: "Kemaskini
//        <masa>" (tiada bold, tiada "terakhir:").
//    • Baris kosong antara SETIAP guru dlm kategori/kumpulan sama (bukan
//        hanya antara kumpulan catatan) — elak metadata bercantum visual dgn
//        nombor guru seterusnya.
//    • Helper format PANJANG V1/V2 (formatTarikhPenuh, formatJulatTarikh,
//        statusTempohLabel) DIKEKALKAN tidak berubah & kekal dieksport —
//        tidak lagi dipanggil laluan aktif, tapi masih diuji
//        (__tests__/snapshot-tempoh.test.js) & masih boleh reuse jika perlu.
//    • hitungTempohRekod(), groupReference, legacy fallback, ±31 hari,
//        createdAt tolerance, batch query — TIDAK disentuh langsung.
//    • Laluan PEMBATALAN — TIDAK disentuh (sama seperti v1/v2).
// ════════════════════════════════════════════════════════════

import prisma from '../lib/prisma.js';
import { hariDari } from '../lib/absenceUtil.js';
import { masaKeMinitAuto, HUJUNG_HARI } from '../lib/absenceWindow.js';

const MC_KATEGORI = ['MC', 'CRK', 'CTR'];

// Escape HTML entities untuk teks dinamik (parse_mode HTML Telegram).
// Nama guru & catatan mungkin mengandungi &, <, >, " — mesti diescape.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function tarikhKeUtcDate(tarikhStr) {
  const m = String(tarikhStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

// "2026-06-10" → "10/6/2026" (tanpa sifar awalan, sama GAS)
function tarikhDisplay(tarikhStr) {
  const p = String(tarikhStr).split('-');
  return `${parseInt(p[2], 10)}/${parseInt(p[1], 10)}/${p[0]}`;
}

// Date (UTC-midnight, spt @db.Date) → "YYYY-MM-DD"
function tarikhKeIso(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

const BULAN_PENUH = [
  'JANUARI', 'FEBRUARI', 'MAC', 'APRIL', 'MEI', 'JUN',
  'JULAI', 'OGOS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DISEMBER',
];

// Date (UTC) → "1 OGOS 2026" (format BM, bulan huruf besar, tiada sifar awalan)
export function formatTarikhPenuh(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getUTCDate()} ${BULAN_PENUH[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

// mula, tamat (Date UTC) → "1 OGOS 2026 - 4 OGOS 2026" — julat TEMPOH ASAL
// submission (guna utk paparan multi-day; merentas bulan/tahun selamat
// kerana berasaskan aritmetik Date, bukan string).
export function formatJulatTarikh(mula, tamat) {
  return `${formatTarikhPenuh(mula)} - ${formatTarikhPenuh(tamat)}`;
}

// ── Patch v3 — format ringkas/minimal (paparan sahaja; TIDAK menyentuh
//    hitungTempohRekod()/logik tempoh V2 — lihat laporan patch v3). Helper
//    format panjang di atas (formatTarikhPenuh/formatJulatTarikh) DIKEKALKAN
//    tidak berubah — tidak lagi dipanggil oleh laluan aktif, tapi kekal
//    dieksport (diuji oleh __tests__/snapshot-tempoh.test.js sedia ada).
const BULAN_SINGKAT = [
  'Jan.', 'Feb.', 'Mac', 'Apr.', 'Mei', 'Jun',
  'Jul', 'Ogos', 'Sept.', 'Okt.', 'Nov.', 'Dis.',
];

// "RABU" → "Rabu" (Title Case; nama hari BM sepatah, huruf pertama besar sahaja)
export function hariTitleCase(hari) {
  const s = String(hari || '');
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Date (UTC) → "2 Sept. 2026" — utk baris header sahaja (SATU tarikh, tahun
// SENTIASA dipapar, tiada konsep "sama tahun dgn header" utk header itu
// sendiri). Guna BULAN_SINGKAT — lihat laporan patch v3 utk sebab singkatan
// ini dipilih berbanding convention sedia ada dlm pdf.service.js/borang
// (kedua-duanya tiada noktah & guna "Sep" bukan "Sept").
export function formatTarikhHeaderPendek(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getUTCDate()} ${BULAN_SINGKAT[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

// mula, tamat (Date UTC) → julat tarikh RINGKAS utk paparan multi-day:
//   sama bulan+tahun     → "2-4 Sept."
//   lain bulan, sama thn → "30 Ogos-2 Sept."
//   lain tahun           → "30 Dis. 2026-2 Jan. 2027"
// Tahun HANYA dipapar bila julat merentas tahun (elak ulang tahun yg sama
// dgn header, seperti diminta). Tanda "-" sentiasa rapat (tiada ruang).
// Sengaja fungsi BAHARU berasingan drpd formatJulatTarikh() (format panjang)
// — fungsi lama itu kekal, tidak diubah, tidak dipanggil laluan aktif lagi.
export function formatJulatTarikhPendek(mula, tamat) {
  const hariM = mula.getUTCDate();
  const hariT = tamat.getUTCDate();
  const bulanM = BULAN_SINGKAT[mula.getUTCMonth()];
  const bulanT = BULAN_SINGKAT[tamat.getUTCMonth()];
  const tahunM = mula.getUTCFullYear();
  const tahunT = tamat.getUTCFullYear();

  if (tahunM !== tahunT) return `${hariM} ${bulanM} ${tahunM}-${hariT} ${bulanT} ${tahunT}`;
  if (mula.getUTCMonth() !== tamat.getUTCMonth()) return `${hariM} ${bulanM}-${hariT} ${bulanT}`;
  return `${hariM}-${hariT} ${bulanT}`;
}

// Masa semasa Malaysia → "7:17 PM"
export function masaSekarangKL() {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date());
  } catch {
    return '';
  }
}

// minit mutlak → "7:30 pagi" / "12:00 tengah hari" / "2:30 petang"
function minitKeLabel(min) {
  const h = Math.floor(min / 60);
  const mm = String(min % 60).padStart(2, '0');
  let suffix, hh;
  if (h === 12) {
    suffix = 'tengah hari';
    hh = 12;
  } else if (h < 12) {
    suffix = 'pagi';
    hh = h === 0 ? 12 : h;
  } else {
    suffix = 'petang';
    hh = h - 12;
  }
  return `${hh}:${mm} ${suffix}`;
}

// jenis + masaMula + masaTamat → "(Sehari Penuh)" / "(7:30 pagi - tamat sekolah)"
// (Laluan PEMBATALAN sahaja — kekal, tidak disentuh oleh patch tempoh baharu.)
function masaLabel(jenis, masaMula, masaTamat) {
  if (jenis !== 'SEPARUH_HARI') return '(Sehari Penuh)';
  const m = masaKeMinitAuto(masaMula);
  if (m === null) return '(Sehari Penuh)'; // fallback selamat
  const mulaTxt = minitKeLabel(m);
  const t = masaTamat ? masaKeMinitAuto(masaTamat) : null;
  const tamatTxt = t === null || t === HUJUNG_HARI || t <= m ? 'tamat sekolah' : minitKeLabel(t);
  return `(${mulaTxt} - ${tamatTxt})`;
}

// minit mutlak → "10:45 AM" (format Inggeris 12-jam; corak penukaran sama
// spt snapshotTimeLabel() dlm lib/telegramSettings.js, tapi terima MINIT
// terus supaya serasi KEDUA-DUA format masaMula/masaTamat yang disimpan —
// "HH:MM" borang baharu & format sekolah bertitik rekod lama — melalui
// masaKeMinitAuto yang sedia diimport di atas.)
function minitKeLabelAmPm(min) {
  const h = Math.floor(min / 60) % 24;
  const mm = String(min % 60).padStart(2, '0');
  const ap = h < 12 ? 'AM' : 'PM';
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${mm} ${ap}`;
}

// jenis + masaMula + masaTamat → "SEPANJANG HARI" / "SEPARUH HARI (10:45 AM - TAMAT SEKOLAH)"
// Format BAHARU (huruf besar, AM/PM) — utk seksyen Program/Lain-lain pada
// laluan snapshot biasa/auto/realtime SAHAJA. BERASINGAN drpd masaLabel()
// di atas (yg kekal digunakan hanya oleh laluan PEMBATALAN, format lama).
export function statusTempohLabel(jenis, masaMula, masaTamat) {
  if (String(jenis || '').toUpperCase() !== 'SEPARUH_HARI') return 'SEPANJANG HARI';
  const m = masaKeMinitAuto(masaMula);
  if (m === null) return 'SEPANJANG HARI'; // fallback selamat (sama corak dgn masaLabel)
  const mulaTxt = minitKeLabelAmPm(m);
  const t = masaTamat ? masaKeMinitAuto(masaTamat) : null;
  const tamatTxt = t === null || t === HUJUNG_HARI || t <= m ? 'TAMAT SEKOLAH' : minitKeLabelAmPm(t);
  return `SEPARUH HARI (${mulaTxt} - ${tamatTxt})`;
}

// jenis + masaMula + masaTamat → "10:45 AM-Tamat" / "8:00 AM-11:30 AM" / null
// (sepanjang hari — tiada apa dipapar). Patch v3. Guna semula
// minitKeLabelAmPm() + masaKeMinitAuto()/HUJUNG_HARI sedia ada (SAMA fallback
// selamat spt statusTempohLabel di atas), hanya bentuk output berbeza:
// ringkas, tiada prefix "SEPARUH HARI", tanda "-" rapat, "Tamat" bkn
// "TAMAT SEKOLAH". statusTempohLabel() di atas DIKEKALKAN tidak berubah
// (tidak lagi dipanggil laluan aktif, tapi kekal dieksport/diuji).
export function masaJulatPendek(jenis, masaMula, masaTamat) {
  if (String(jenis || '').toUpperCase() !== 'SEPARUH_HARI') return null;
  const m = masaKeMinitAuto(masaMula);
  if (m === null) return null; // fallback selamat — sepanjang hari (tiada apa dipapar)
  const mulaTxt = minitKeLabelAmPm(m);
  const t = masaTamat ? masaKeMinitAuto(masaTamat) : null;
  const tamatTxt = t === null || t === HUJUNG_HARI || t <= m ? 'Tamat' : minitKeLabelAmPm(t);
  return `${mulaTxt}-${tamatTxt}`;
}

// Render seksyen Program/Lain-lain: kumpul ikut jenis+masa+catatan
function renderKumpulan(records) {
  const order = [];
  const map = new Map();
  for (const r of records) {
    const key = `${r.jenis}|${r.masaMula || ''}|${r.masaTamat || ''}|${r.catatan || ''}`;
    if (!map.has(key)) {
      map.set(key, { jenis: r.jenis, masaMula: r.masaMula, masaTamat: r.masaTamat, catatan: r.catatan, nama: [] });
      order.push(key);
    }
    const g = map.get(key);
    if (!g.nama.includes(r.nama)) g.nama.push(r.nama);
  }
  return order
    .map((key) => {
      const g = map.get(key);
      let b = g.nama.map((n) => `• ${esc(n)}`).join('\n');
      b += `\n\n${masaLabel(g.jenis, g.masaMula, g.masaTamat)}`;
      if (g.catatan) b += `\n\nCatatan: <i>${esc(g.catatan)}</i>`;
      return b;
    })
    .join('\n\n'); // pisah kumpulan berbeza dalam kategori sama
}

// Had selamat julat carian tetingkap tarikh (hari, SETIAP arah). Mencerminkan
// MAX_HARI_JULAT (had panjang submission, 31 hari) dlm absence.controller.js
// supaya tetingkap ini SENTIASA cukup merangkumi mana-mana submission sebenar
// (tidak import terus dari controller supaya servis ini kekal berdiri
// sendiri — lihat laporan patch utk justifikasi penuh).
const JULAT_TEMPOH_HARI_MAKS = 31;

// Toleransi createdAt — laluan LEGACY FALLBACK sahaja (Patch v2), TIDAK
// digunakan bila groupReference wujud. Rekod jiran hanya dianggap sebahagian
// submission BERTURUTAN yang SAMA jika dicipta dlm tempoh ini dari satu sama
// lain. Satu submission (walaupun 31 hari, had MAX_HARI_JULAT) mencipta
// semua rekodnya SECARA BERURUTAN dlm SATU panggilan createAbsence() —
// biasanya beberapa saat jumlahnya walaupun perlahan; dua PENGHANTARAN BORANG
// berasingan pada dunia sebenar hampir pasti lebih jauh drpd ini. Ini
// mengurangkan (bukan menghapuskan 100%) risiko dua submission single-day
// berasingan digabung salah kerana kebetulan serupa — lihat laporan Patch v2.
const LEGACY_HEURISTIC_TOLERANS_CREATED_AT_MS = 120000; // 120 saat

// Bina peta { id rekod hari ini → { tarikhMula, tarikhTamat, isMultiDay } }
// mewakili TEMPOH ASAL submission bagi setiap rekod snapshot hari ini.
//   • Ada groupReference (Patch v2: SEBARANG submission >1 rekod, bukan lagi
//     terhad ≥2 guru — lihat absence.controller.js) → SOURCE OF TRUTH, TIADA
//     heuristic. Julat = min/max tarikh rekod AKTIF bagi GURU YANG SAMA dgn
//     groupReference yang SAMA.
//   • Tiada groupReference → LEGACY FALLBACK sahaja (rekod sebelum Patch v2,
//     atau submission 1-guru-1-hari yg sengaja kekal null): julat dikesan
//     semula — jalan mundur/maju dari tarikh rekod semasa selagi hari
//     BERSEBELAHAN wujud & sepadan PENUH (guru + kategori + catatan + jenis +
//     masaMula + masaTamat + createdAt berdekatan, lihat
//     LEGACY_HEURISTIC_TOLERANS_CREATED_AT_MS). Gagal sepadan/gagal wujud →
//     berhenti di situ (fallback selamat: single-day).
// SATU query batch sahaja (semua guru hari ini, satu tetingkap tarikh) utk
// keseluruhan snapshot — elak N+1, tidak kira laluan. Sebarang kegagalan
// TIDAK menggagalkan snapshot — rekod berkenaan jatuh balik ke single-day
// di caller.
async function hitungTempohRekod(records, tarikhDate) {
  const peta = new Map();
  const namaSenarai = [...new Set(records.map((r) => String(r.guruNama || '').trim()).filter(Boolean))];
  if (!namaSenarai.length) return peta;

  const winMula = new Date(tarikhDate.getTime() - JULAT_TEMPOH_HARI_MAKS * 86400000);
  const winTamat = new Date(tarikhDate.getTime() + JULAT_TEMPOH_HARI_MAKS * 86400000);

  let jendela = [];
  try {
    jendela = await prisma.absenceRecord.findMany({
      where: {
        guruNama: { in: namaSenarai },
        statusBorang: 'AKTIF',
        deletedAt: null,
        tarikh: { gte: winMula, lte: winTamat },
      },
      select: {
        guruNama: true,
        tarikh: true,
        sebabKategori: true,
        sebabDetail: true,
        jenis: true,
        masaMula: true,
        masaTamat: true,
        groupReference: true,
        createdAt: true,
      },
    });
  } catch (e) {
    console.error('hitungTempohRekod: gagal ambil tetingkap tarikh —', e.message);
    return peta; // selamat: semua rekod jatuh balik ke single-day di caller
  }

  // indeks: nama guru → Map('YYYY-MM-DD' → rekod)
  const indeksGuru = new Map();
  for (const row of jendela) {
    const nama = String(row.guruNama || '').trim();
    if (!indeksGuru.has(nama)) indeksGuru.set(nama, new Map());
    indeksGuru.get(nama).set(tarikhKeIso(row.tarikh), row);
  }

  for (const r of records) {
    try {
      const nama = String(r.guruNama || '').trim();
      if (!nama) continue;
      const petaGuru = indeksGuru.get(nama);
      let mula = r.tarikh;
      let tamat = r.tarikh;

      if (r.groupReference && petaGuru) {
        // SOURCE OF TRUTH (Patch v2) — identifier submission sebenar, TIADA
        // heuristic. Skop KETAT: guru YANG SAMA + groupReference YANG SAMA
        // sahaja (elak bercampur dgn guru lain dlm submission ramai-guru).
        const samaGrup = [...petaGuru.values()].filter((row) => row.groupReference === r.groupReference);
        if (samaGrup.length) {
          const masaMs = samaGrup.map((row) => row.tarikh.getTime()).concat(r.tarikh.getTime());
          mula = new Date(Math.min(...masaMs));
          tamat = new Date(Math.max(...masaMs));
        }
      } else if (petaGuru) {
        // LEGACY FALLBACK — groupReference tiada (rekod lama, atau submission
        // 1-guru-1-hari). BUKAN source of truth; lihat komen fungsi di atas.
        const kat = String(r.sebabKategori || '').trim().toUpperCase();
        const catatan = r.sebabDetail || '';
        const jenis = String(r.jenis || '').toUpperCase();
        const mM = r.masaMula || '';
        const mT = r.masaTamat || '';
        const createdAtR = r.createdAt instanceof Date ? r.createdAt.getTime() : null;
        const sepadan = (row) =>
          row &&
          String(row.sebabKategori || '').trim().toUpperCase() === kat &&
          (row.sebabDetail || '') === catatan &&
          String(row.jenis || '').toUpperCase() === jenis &&
          (row.masaMula || '') === mM &&
          (row.masaTamat || '') === mT &&
          // createdAt berdekatan → kurangkan risiko gabung 2 submission
          // single-day BERASINGAN yang kebetulan serupa (lihat konstanta di
          // atas). createdAt tiada/tidak sah pada mana-mana pihak → JANGAN
          // sepadan (selamat: fallback single-day, bukan teka).
          createdAtR !== null &&
          row.createdAt instanceof Date &&
          Math.abs(row.createdAt.getTime() - createdAtR) <= LEGACY_HEURISTIC_TOLERANS_CREATED_AT_MS;

        let cur = new Date(r.tarikh.getTime() - 86400000);
        while (sepadan(petaGuru.get(tarikhKeIso(cur)))) {
          mula = cur;
          cur = new Date(cur.getTime() - 86400000);
        }
        cur = new Date(r.tarikh.getTime() + 86400000);
        while (sepadan(petaGuru.get(tarikhKeIso(cur)))) {
          tamat = cur;
          cur = new Date(cur.getTime() + 86400000);
        }
      }

      peta.set(r.id, { tarikhMula: mula, tarikhTamat: tamat, isMultiDay: tamat.getTime() !== mula.getTime() });
    } catch (e) {
      console.error('hitungTempohRekod: rekod dilangkau (ralat julat) —', e.message);
      // tiada entry utk rekod ini → caller fallback single-day (selamat)
    }
  }

  return peta;
}

// [v3.1] Tentukan sama ada SEMUA entry (>1) dlm satu kumpulan catatan
// berkongsi metadata STRING yang sama (termasuk sama2 kosong). Fungsi TULEN
// (tiada I/O), terima metadata yang SUDAH dikira (array of string) — tidak
// membina semula tempoh, tidak mengubah helper format tarikh/waktu sedia
// ada. 1 entry sahaja → false (dedup tiada makna visual utk 1 orang).
export function semuaMetadataSama(metadataList) {
  return metadataList.length > 1 && metadataList.every((m) => m === metadataList[0]);
}

// [v3.1] Bina teks satu blok kumpulan-catatan (nama bernombor + metadata +
// catatan) bagi renderer Program/Lain-lain. Fungsi TULEN — terima entries yg
// TEMPOHNYA SUDAH diselesaikan oleh hitungTempohRekod() (tarikhMula/
// tarikhTamat/isMultiDay/jenis/masaMula/masaTamat sedia ada padanya; fungsi
// ini TIDAK query DB / bina semula tempoh), guna semula formatJulatTarikhPendek
// & masaJulatPendek sedia ada (tidak diubah). Reka bentuk:
//   • SEMUA entry (>1) kongsi metadata sama → nama RAPAT (tiada blank line
//     antara nama), metadata (jika tidak kosong) SEKALI selepas satu blank
//     line, kemudian catatan TERUS di baris seterusnya (TIADA blank line
//     antara metadata/nama-rapat dgn catatan — pembetulan v3.1).
//   • Metadata berbeza ATAU cuma 1 entry → format V3 asal tidak berubah
//     (nama+metadata per-entry, blank line antara setiap guru, blank line
//     sebelum catatan).
export function binaBlokKumpulanCatatan(entries, catatan, nomborMula) {
  let no = nomborMula;
  const metaOf = (entry) => {
    const bahagian = [];
    if (entry.isMultiDay) bahagian.push(formatJulatTarikhPendek(entry.tarikhMula, entry.tarikhTamat));
    const masaTxt = masaJulatPendek(entry.jenis, entry.masaMula, entry.masaTamat);
    if (masaTxt) bahagian.push(masaTxt);
    return bahagian.join(' · '); // '' bila tiada apa2 (sepanjang hari, single-day)
  };

  const metaList = entries.map(metaOf);
  const dedup = semuaMetadataSama(metaList);

  let namaBlock;
  let sepCatatan = '\n\n'; // lalai (V3 tidak berubah) — cabang metadata berbeza/1 entry
  if (dedup) {
    const namaSahaja = entries.map((entry) => `${++no}. ${esc(entry.nama)}`).join('\n');
    if (metaList[0]) {
      // Metadata dikongsi WUJUD: nama rapat, blank line, metadata SEKALI,
      // kemudian catatan TERUS (satu newline sahaja, tiada blank line).
      namaBlock = `${namaSahaja}\n\n${metaList[0]}`;
      sepCatatan = '\n';
    } else {
      // Metadata dikongsi KOSONG (sepanjang hari, single-day): nama rapat
      // sahaja (tiada baris metadata), catatan mengikut blank line seperti
      // biasa — sepCatatan kekal lalai '\n\n' (pembetulan susulan semakan).
      namaBlock = namaSahaja;
    }
  } else {
    namaBlock = entries
      .map((entry) => {
        let b = `${++no}. ${esc(entry.nama)}`;
        const m = metaOf(entry);
        if (m) b += `\n${m}`;
        return b;
      })
      .join('\n\n');
  }

  const teks = catatan ? `${namaBlock}${sepCatatan}<i>${esc(catatan)}</i>` : namaBlock;
  return { teks, nomborSeterusnya: no };
}

export async function buildSnapshot({
  tarikh,
  isAutoSnapshot = false,
  pembatalan = false,
  autoLabel = '5:30 AM',
}) {
  const tarikhDate = tarikhKeUtcDate(tarikh);
  if (!tarikhDate) {
    const e = new Error('Format tarikh tidak sah (perlu YYYY-MM-DD).');
    e.code = 'BAD_DATE';
    throw e;
  }
  const hari = hariDari(tarikhDate);

  const records = await prisma.absenceRecord.findMany({
    where: { tarikh: tarikhDate, statusBorang: 'AKTIF', deletedAt: null },
    orderBy: { createdAt: 'asc' }, // susun ikut masa hantar
  });

  // Tempoh ASAL (julat tarikh multi-day) bagi setiap rekod hari ini — SATU
  // query batch, digunakan utk KEDUA-DUA MC/CRK/CTR & Program/Lain-lain.
  const tempohPeta = await hitungTempohRekod(records, tarikhDate);

  const mc = []; // { nama, kat } — untuk path pembatalan (format lama, digabung)
  const byKat = { MC: [], CRK: [], CTR: [] }; // untuk format baharu (berasingan)
  const progSekolah = []; // { nama, jenis, masaMula, masaTamat, catatan, tarikhMula, tarikhTamat, isMultiDay }
  const progLuar = [];
  const lainLain = [];

  for (const r of records) {
    const nama = String(r.guruNama || '').trim();
    const kat = String(r.sebabKategori || '').trim().toUpperCase();
    const catatan = String(r.sebabDetail || '').trim();
    if (!nama) continue;

    const tempoh = tempohPeta.get(r.id) || { tarikhMula: r.tarikh, tarikhTamat: r.tarikh, isMultiDay: false };

    if (MC_KATEGORI.includes(kat)) {
      if (!mc.some((x) => x.nama === nama && x.kat === kat)) mc.push({ nama, kat });
      if (!byKat[kat].some((x) => x.nama === nama)) {
        byKat[kat].push({
          nama,
          tarikhMula: tempoh.tarikhMula,
          tarikhTamat: tempoh.tarikhTamat,
          isMultiDay: tempoh.isMultiDay,
        });
      }
    } else {
      const item = {
        nama,
        jenis: r.jenis,
        masaMula: r.masaMula,
        masaTamat: r.masaTamat,
        catatan,
        tarikhMula: tempoh.tarikhMula,
        tarikhTamat: tempoh.tarikhTamat,
        isMultiDay: tempoh.isMultiDay,
      };
      if (kat === 'PROGRAM_SEKOLAH') progSekolah.push(item);
      else if (kat === 'PROGRAM_LUAR') progLuar.push(item);
      else lainLain.push(item);
    }
  }

  const jumlah = mc.length + progSekolah.length + progLuar.length + lainLain.length;

  // ── Kosong (cth selepas pembatalan) ──
  if (jumlah === 0) {
    let m = '';
    if (pembatalan) m += '⚠️ PEMBATALAN KETIDAKHADIRAN\n\n';
    m += pembatalan
      ? 'Tiada lagi rekod ketidakhadiran aktif untuk hari ini.'
      : 'Tiada rekod ketidakhadiran.';
    return { text: m, jumlahGuru: 0, hari, adaRekod: false };
  }

  // ════════════════════════════════════════════════════════
  //  PEMBATALAN — format LAMA, TIDAK diubah (kekal seperti asal).
  // ════════════════════════════════════════════════════════
  if (pembatalan) {
    let msg = '⚠️ PEMBATALAN KETIDAKHADIRAN\n\n';
    msg += '<b>KEMASKINI KETIDAKHADIRAN GURU</b>\n\n';
    msg += '<b>Tarikh:</b> ' + tarikhDisplay(tarikh) + '\n';
    msg += '<b>Hari:</b> ' + String(hari || '').toUpperCase();

    const sections = [];
    if (mc.length) sections.push(['MC / CRK / CTR', mc.map((x) => `• ${esc(x.nama)} - ${esc(x.kat)}`).join('\n')]);
    if (progSekolah.length) sections.push(['PROGRAM DI SEKOLAH', renderKumpulan(progSekolah)]);
    if (progLuar.length) sections.push(['PROGRAM DI LUAR SEKOLAH', renderKumpulan(progLuar)]);
    if (lainLain.length) sections.push(['LAIN-LAIN', renderKumpulan(lainLain)]);

    for (const [label, body] of sections) {
      msg += `\n\n\n<b>${label}</b>\n\n${body}`;
    }
    msg += '\n\n<b>Kemaskini terakhir:</b> ' + masaSekarangKL();
    return { text: msg, jumlahGuru: jumlah, hari, adaRekod: true };
  }

  // ════════════════════════════════════════════════════════
  //  FORMAT BAHARU (ringkas) — snapshot biasa/auto/realtime.
  //    • Header (Patch v3 — minimal): tajuk BOLD, baris kedua
  //      "D Bulan. YYYY · Hari" (Title Case), TIDAK bold, TIADA label
  //      "Tarikh:"/"Hari:" berasingan (dibuang).
  //    • MC / CRK / CTR berasingan, nama bernombor (tiada catatan, tiada
  //      status sepanjang/separuh hari — lihat "Tempoh ketidakhadiran" dlm
  //      komen header fail ini).
  //    • Program/Lain-lain: nama bernombor + catatan di baris bawah.
  //    • Tempoh (Patch v3 — minimal): julat tarikh RINGKAS ("2-4 Sept.")
  //      + waktu ringkas ("10:45 AM-Tamat") pada metadata SATU baris rapat
  //      (tiada indent 4-ruang, digabung "·" bila kedua-duanya wujud).
  //      Baris metadata DIBUANG SEPENUHNYA bila single-day + sepanjang hari
  //      (tiada apa nak dipapar — sebelum ini status "SEPANJANG HARI"
  //      sentiasa dipapar, kini dibuang). Format panjang/berlabel V1/V2
  //      (formatJulatTarikh/statusTempohLabel) tidak lagi dipanggil di sini
  //      — DIKEKALKAN tidak berubah, kekal dieksport (lihat laporan v3).
  //    • Satu baris kosong antara blok KATEGORI, DAN satu baris kosong
  //      antara SETIAP guru dalam kategori/kumpulan yang sama (Patch v3,
  //      supaya metadata tidak bercantum visual dgn nombor guru seterusnya).
  // ════════════════════════════════════════════════════════
  const blocks = [`<b>KEMASKINI KETIDAKHADIRAN GURU</b>\n${formatTarikhHeaderPendek(tarikhDate)} · ${hariTitleCase(hari)}`];

  // MC, CRK, CTR — setiap satu tajuk sendiri, nama bernombor. TIDAK PERNAH
  // papar SEPANJANG/SEPARUH HARI atau masa (dianggap sentiasa sepanjang
  // hari). Multi-day → julat tarikh RINGKAS pada baris di bawah nama sahaja
  // (tiada indent); satu hari → nama sahaja. Baris kosong antara guru.
  for (const kat of MC_KATEGORI) {
    const senarai = byKat[kat];
    if (!senarai.length) continue;
    const body = senarai
      .map((entry, i) => {
        let b = `${i + 1}. ${esc(entry.nama)}`;
        if (entry.isMultiDay) b += `\n${formatJulatTarikhPendek(entry.tarikhMula, entry.tarikhTamat)}`;
        return b;
      })
      .join('\n\n');
    blocks.push(`<b>${kat}</b>` + '\n\n' + body);
  }

  // Program/Lain-lain — nama BERNOMBOR dikumpulkan ikut catatan yang SAMA.
  //    • Nombor berterusan dalam sesebuah kategori (1, 2, 3 …) merentas
  //      kumpulan catatan.
  //    • Catatan sama  → nama bernombor dulu, kemudian catatan sekali:
  //        1. NAMA
  //        2. NAMA
  //        - <i>catatan</i>
  //    • Catatan berbeza → kumpulan berasingan dalam kategori sama, nombor
  //      disambung dari kumpulan sebelumnya.
  //    • Catatan kosong  → nama bernombor sahaja, tanpa dash/"Catatan:".
  const kumpulanBaharu = (label, arr) => {
    if (!arr.length) return;

    // Susun ikut catatan supaya kumpulan yang sama berdekatan. Catatan kosong
    // diletakkan dahulu agar nama tanpa catatan muncul sebelum kumpulan
    // berlabel dalam kategori yang sama.
    const susun = [...arr].sort((a, b) => {
      const ca = a.catatan || '';
      const cb = b.catatan || '';
      if (ca === cb) return a.nama.localeCompare(b.nama);
      if (!ca) return -1;
      if (!cb) return 1;
      return ca.localeCompare(cb);
    });

    // Kumpulkan ikut catatan (dedup nama dalam kumpulan sama), tapi KEKALKAN
    // metadata tempoh (jenis/masa/julat tarikh) bagi SETIAP guru — grouping
    // catatan tidak boleh menyebabkan maklumat tempoh individu hilang.
    const orderCat = [];
    const mapCat = new Map();
    for (const e of susun) {
      const key = e.catatan || '';
      if (!mapCat.has(key)) {
        mapCat.set(key, { catatan: e.catatan, entries: [] });
        orderCat.push(key);
      }
      const g = mapCat.get(key);
      if (!g.entries.some((x) => x.nama === e.nama)) {
        g.entries.push({
          nama: e.nama,
          jenis: e.jenis,
          masaMula: e.masaMula,
          masaTamat: e.masaTamat,
          tarikhMula: e.tarikhMula,
          tarikhTamat: e.tarikhTamat,
          isMultiDay: e.isMultiDay,
        });
      }
    }

    // Bina blok setiap kumpulan catatan via binaBlokKumpulanCatatan() (v3.1
    // — dedup metadata bila semua entry >1 kongsi metadata sama; lihat
    // definisi fungsi itu di atas). Nombor berterusan merentas kumpulan
    // dlm kategori ini (mulai dari 1) — dikekalkan melalui nomborSeterusnya.
    let no = 0;
    const body = orderCat
      .map((key) => {
        const g = mapCat.get(key);
        const { teks, nomborSeterusnya } = binaBlokKumpulanCatatan(g.entries, g.catatan, no);
        no = nomborSeterusnya;
        return teks;
      })
      .join('\n\n');

    blocks.push(`<b>${label}</b>` + '\n\n' + body);
  };
  kumpulanBaharu('PROGRAM DI SEKOLAH', progSekolah);
  kumpulanBaharu('PROGRAM DI LUAR SEKOLAH', progLuar);
  kumpulanBaharu('LAIN-LAIN', lainLain);

  blocks.push('Kemaskini ' + (isAutoSnapshot ? autoLabel : masaSekarangKL()));

  return { text: blocks.join('\n\n'), jumlahGuru: jumlah, hari, adaRekod: true };
}
