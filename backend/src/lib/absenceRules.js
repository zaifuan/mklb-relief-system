// ════════════════════════════════════════════════════════════
//  absenceRules.js — keputusan TULEN (tiada I/O) berkaitan borang
//  ketidakhadiran, diasingkan drpd absence.controller.js (yang import
//  `prisma` — lihat lib/prisma.js — dan akan instantiate PrismaClient
//  serta-merta apabila dimuatkan) supaya boleh diuji unit tanpa DB.
//  Lihat __tests__/absence-perlu-ganti.test.js.
// ════════════════════════════════════════════════════════════

// Keperluan relief kelas ("Sekatan Khas Relief" #2 — 2026-07-14):
//   • perluGanti=false → Suka Sama Suka SENTIASA false, walau pertukaran
//     dihantar secara paksa dalam payload (backend TIDAK percaya frontend
//     sahaja — lihat absence.controller.js createAbsence()).
//   • Had sedia ada dikekalkan: individu sahaja (jumlahGuru===1) dan mesti
//     ada sekurang-kurangnya satu item pertukaran.
export function resolveWantSwaps({ pertukaranLength, jumlahGuru, perluGanti }) {
  return !!(perluGanti === true && jumlahGuru === 1 && pertukaranLength > 0);
}
