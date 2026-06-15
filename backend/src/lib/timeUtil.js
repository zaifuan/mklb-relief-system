// ════════════════════════════════════════════════════════════
//  timeUtil.js — utiliti masa (PORT TEPAT daripada helpers.gs GAS)
//
//  KUIRK PENTING — Format masa sekolah Malaysia (12-jam tanpa AM/PM):
//    • Jam 1.00–6.59  = PETANG  → tambah 12 jam  (1.00 = 780 minit)
//    • Jam 7.00–12.59 = pagi/tengahari → kekal   (7.40 = 460, 12.30 = 750)
//
//  masaKeMinit pulangkan null (bukan 0) untuk input tidak sah supaya
//  pengesanan pertindihan boleh bezakan "tiada data" vs "00:00".
//  Logik ini DIKEKALKAN 100% dari sistem GAS asal — lihat ujian golden
//  di src/__tests__/timeUtil.test.js.
// ════════════════════════════════════════════════════════════

// ── MASA KE MINIT ─────────────────────────────────────────
// "9.10" → 550, "1.00" → 780 (1 petang), "12.30" → 750, "7.40" → 460
export function masaKeMinit(masa) {
  if (!masa) return null;

  masa = String(masa).trim().replace(/\s/g, '');
  if (!masa) return null;

  const m = masa.match(/^(\d{1,2})(?:\.(\d{1,2}))?$/);
  if (!m) return null;

  let jam = parseInt(m[1], 10);
  const minit = parseInt(m[2] || '0', 10);

  // 1.00–6.59 = petang (PM) → +12 jam ; 7.00–12.59 = kekal
  if (jam >= 1 && jam <= 6) {
    jam += 12;
  }

  return jam * 60 + minit;
}

// ── PARSE MASA ────────────────────────────────────────────
// "9.10-10.10" → [550, 610], "12.30-1.00" → [750, 780], gagal → [null, null]
export function parseMasa(masa) {
  if (!masa) return [null, null];

  try {
    const clean = String(masa)
      .replace(/[–—]/g, '-') // en/em dash → dash biasa
      .replace(/\s+/g, '');

    if (!clean) return [null, null];

    const match = clean.match(/^(\d{1,2}(?:\.\d{1,2})?)-(\d{1,2}(?:\.\d{1,2})?)$/);
    if (!match) return [null, null];

    return [masaKeMinit(match[1]), masaKeMinit(match[2])];
  } catch {
    return [null, null];
  }
}

// ── NORMALKAN MASA (untuk PADANAN SLOT yang konsisten) ────
// Hasilkan bentuk kanonik rentetan masa supaya padanan slot pertukaran kelas
// kekal sepadan walaupun format berbeza sedikit antara simpan & jana relief
// (cth selepas re-sync Google Sheet). Diguna SAMA di kedua-dua tempat:
// semasa simpan class_swaps DAN semasa matching dalam enjin relief.
//   "8.40 – 9.10"  → "8.40-9.10"   (en/em dash → hyphen)
//   "8:40-9:10"    → "8.40-9.10"   (":" → ".")
//   " 8.40 - 9.10 "→ "8.40-9.10"   (buang ruang)
export function normalkanMasa(masa) {
  return String(masa || '')
    .replace(/[–—]/g, '-') // en/em dash → dash biasa
    .replace(/:/g, '.') // ":" → "." (seragam format sekolah)
    .replace(/\s+/g, ''); // buang semua ruang
}

// ── PARSE KELAS ───────────────────────────────────────────
// "4A (9.10-10.10), 4B (11.00-12.00)" → [{ kelas, masa }, ...]
// "SEMUA" → []  (caller mengembang ke semua slot mengajar)
export function parseKelas(kelasStr) {
  if (!kelasStr || String(kelasStr).trim().toUpperCase() === 'SEMUA') return [];
  const result = [];
  for (const item of String(kelasStr).split(',')) {
    const match = item.trim().match(/^(.+?)\s*\((.+?)\)$/);
    if (match) result.push({ kelas: match[1].trim(), masa: match[2].trim() });
  }
  return result;
}

// ── FORMAT MASA DISPLAY ───────────────────────────────────
// "9.40" → "9:40 AM", "1.00" → "1:00 PM", "12.30" → "12:30 PM"
// (untuk paparan / PDF fasa kemudian — disediakan awal)
export function formatMasaDisplay(masaStr) {
  const parts = String(masaStr).replace(/\s/g, '').split('.');
  let jam = parseInt(parts[0]) || 0;
  const minit = String(parseInt(parts[1]) || 0).padStart(2, '0');

  if (jam >= 1 && jam <= 6) jam += 12; // sama dengan masaKeMinit

  const period = jam >= 12 ? 'PM' : 'AM';
  if (jam > 12) jam -= 12;
  if (jam === 0) jam = 12;
  return `${jam}:${minit} ${period}`;
}

// "9.40-10.10" → { mula: "9:40 AM", tamat: "10:10 AM" }
export function splitMasaDisplay(masaStr) {
  const clean = String(masaStr).replace(/\s/g, '');
  const dashIdx = clean.indexOf('-');
  if (dashIdx < 1) return { mula: masaStr, tamat: '' };
  return {
    mula: formatMasaDisplay(clean.substring(0, dashIdx)),
    tamat: formatMasaDisplay(clean.substring(dashIdx + 1)),
  };
}

// ── PERTINDIHAN MASA ──────────────────────────────────────
// true jika [aMula,aTamat) bertindih [bMula,bTamat). null-safe.
export function masaBertindih(aMula, aTamat, bMula, bTamat) {
  if (aMula === null || bMula === null) return false;
  return aMula < bTamat && aTamat > bMula;
}
