// ════════════════════════════════════════════════════════════
//  restrictionExpansion.js — kembangkan SATU rekod SpecialRestriction
//  (3 jenis: FULL_WEEK / SPECIFIC_DAYS / SPECIFIC_TIME) kepada bentuk
//  SEKATAN_KHAS lama yang dijangka adaSekatanKhas() dlm candidate.service.js.
//
//  SENGAJA diasingkan daripada reliefConfig.js (yang import `prisma` — lihat
//  lib/prisma.js — dan akan instantiate PrismaClient serta-merta apabila
//  dimuatkan) supaya fungsi TULEN ini boleh diuji unit tanpa DB/tanpa perlu
//  `prisma generate` berjaya dahulu. Lihat __tests__/special-restriction-engine.test.js.
// ════════════════════════════════════════════════════════════

import { ALL_HARI } from './hariUtil.js';

// PURE (tiada I/O). Output: { nama, hari: [..], mulaDari, mulaHingga } —
// sepadan tepat struktur yang dijangka adaSekatanKhas(). `row.teacher?.nama`
// diutamakan berbanding `row.target` (snapshot) — lihat audit: nama Teacher
// tidak berubah selepas dicipta, jadi kedua-duanya sepatutnya sentiasa sama;
// fallback kepada `target` hanya untuk rekod warisan tanpa padanan teacherId.
export function expandRestriction(row) {
  const namaGuru = row.teacher?.nama || row.target;
  const hariList = (row.hariList || []).map((h) => String(h).trim().toUpperCase());

  if (row.restrictionType === 'FULL_WEEK') {
    return { nama: namaGuru, hari: ALL_HARI, mulaDari: '00.00', mulaHingga: '23.59' };
  }
  if (row.restrictionType === 'SPECIFIC_DAYS') {
    return { nama: namaGuru, hari: hariList, mulaDari: '00.00', mulaHingga: '23.59' };
  }
  // SPECIFIC_TIME
  return { nama: namaGuru, hari: hariList, mulaDari: row.masaDari, mulaHingga: row.masaHingga };
}
