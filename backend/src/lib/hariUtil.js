// ════════════════════════════════════════════════════════════
//  hariUtil.js — util hari persekolahan (ISNIN..JUMAAT) kongsi bersama
//  antara specialRestriction.controller.js dan migrateSpecialRestrictions.js
//  (Sekatan Khas Relief) supaya turutan/kanonik hari konsisten di kedua-dua
//  tempat (elak pendua definisi & risiko drift).
// ════════════════════════════════════════════════════════════

export const ALL_HARI = ['ISNIN', 'SELASA', 'RABU', 'KHAMIS', 'JUMAAT'];

// Susun & buang pendua ikut turutan ISNIN..JUMAAT — guna untuk SIMPAN (supaya
// hariList konsisten dlm DB) & untuk BANDING (padanan pendua/idempotensi).
export function sortHari(list) {
  return [...new Set((list || []).map((h) => String(h).trim().toUpperCase()))].sort(
    (a, b) => ALL_HARI.indexOf(a) - ALL_HARI.indexOf(b)
  );
}

// true jika dua senarai hari mengandungi HARI YANG SAMA (order-independent).
export function sameHariSet(a, b) {
  const sa = sortHari(a);
  const sb = sortHari(b);
  return sa.length === sb.length && sa.every((h, i) => h === sb[i]);
}
