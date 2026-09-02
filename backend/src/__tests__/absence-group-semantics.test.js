// ════════════════════════════════════════════════════════════
//  Ujian: klasifikasiSubmission() — fix badge KUMPULAN (susulan Patch v2).
//  Fungsi TULEN (tiada I/O) → selaras corak ujian sedia ada dlm folder ini
//  (sama semangat spt absence-group-reference.test.js utk
//  perluGroupReference()).
//
//  NOTA: annotateGroupSemantics() sendiri (query batch DB sebenar) tidak
//  diuji di sini secara langsung — sama spt hitungTempohRekod() dlm
//  snapshot.service.js, ia bergantung pada Prisma. Disahkan berasingan
//  melalui harness mock-Prisma merangkumi CASE 1-8 penuh (listAbsence,
//  getAbsence, cancelGroup, N+1) — lihat laporan patch utk kaedah &
//  keputusan.
// ════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { klasifikasiSubmission } from '../controllers/adminAbsence.controller.js';

// ── CASE 1: 1 guru, 1 tarikh (individu single-day) ──
test('klasifikasiSubmission — CASE 1: 1 guru, 1 tarikh → individu single-day', () => {
  assert.deepEqual(klasifikasiSubmission(1, 1), { isGroupSubmission: false, isMultiDaySubmission: false });
});

// ── CASE 2/6: 1 guru, >1 tarikh (individu multi-day) ──
test('klasifikasiSubmission — CASE 2: 1 guru, 3 tarikh → individu multi-day', () => {
  assert.deepEqual(klasifikasiSubmission(1, 3), { isGroupSubmission: false, isMultiDaySubmission: true });
});

test('klasifikasiSubmission — CASE 6: 1 guru, 2 tarikh (selepas 1 hari dibatalkan drpd 3) → individu multi-day KEKAL', () => {
  assert.deepEqual(klasifikasiSubmission(1, 2), { isGroupSubmission: false, isMultiDaySubmission: true });
});

// ── CASE 3/4/7: >1 guru (kumpulan sebenar) ──
test('klasifikasiSubmission — CASE 3: 2 guru, 1 tarikh → kumpulan', () => {
  assert.deepEqual(klasifikasiSubmission(2, 1), { isGroupSubmission: true, isMultiDaySubmission: false });
});

test('klasifikasiSubmission — CASE 4: 3 guru, 4 tarikh → kumpulan', () => {
  assert.deepEqual(klasifikasiSubmission(3, 4), { isGroupSubmission: true, isMultiDaySubmission: false });
});

test('klasifikasiSubmission — CASE 7: 3 guru unik (walaupun 2 drpd 3 dibatalkan) → kumpulan KEKAL', () => {
  // uniqueTeachers dikira drpd SEMUA rekod (termasuk DIBATALKAN) — nilai 3
  // di sini mewakili itu; annotateGroupSemantics() yg jamin pengiraan
  // sebenar merangkumi rekod dibatalkan (diuji berasingan via mock-Prisma).
  assert.deepEqual(klasifikasiSubmission(3, 1), { isGroupSubmission: true, isMultiDaySubmission: false });
});

// ── CASE 8: anomali data (fallback selamat) ──
test('klasifikasiSubmission — CASE 8: fallback selamat (1,1) bila groupReference anomali/tiada rekod jiran', () => {
  assert.deepEqual(klasifikasiSubmission(1, 1), { isGroupSubmission: false, isMultiDaySubmission: false });
});

// ── Sempadan tambahan ──
test('klasifikasiSubmission — bilangan besar kedua-dua dimensi tetap kumpulan', () => {
  assert.deepEqual(klasifikasiSubmission(5, 10), { isGroupSubmission: true, isMultiDaySubmission: false });
});
