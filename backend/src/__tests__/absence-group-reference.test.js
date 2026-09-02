// ════════════════════════════════════════════════════════════
//  Ujian: perluGroupReference() — keputusan sama ada submission WAJIB
//  mendapat groupReference (Patch v2). Fungsi TULEN (tiada I/O) → selaras
//  dgn corak ujian sedia ada dlm folder ini.
//
//  NOTA: createAbsence() sendiri (penulisan DB sebenar — jana groupReference,
//  cipta AbsenceRecord, pembersihan tepi single-record) bergantung pada
//  Prisma ($transaction, create, findFirst, dll.) dan tiada controller lain
//  dlm repo ini mempunyai ujian automatik (tiada corak sedia ada utk diikuti
//  bagi ujian controller). Ia disahkan berasingan melalui harness mock-Prisma
//  khas (bukan sebahagian ZIP — lihat laporan patch v2 utk kaedah &
//  keputusan CASE A1–A5 penuh) dan semakan kod baris-demi-baris.
// ════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perluGroupReference } from '../controllers/absence.controller.js';

// ── CASE A1: 1 guru × 1 hari → 1 rekod → TIADA groupReference ──
test('perluGroupReference — CASE A1: 1 guru × 1 hari (1 rekod) → false', () => {
  assert.equal(perluGroupReference(1, 1), false);
});

// ── CASE A2: 1 guru × 2 hari → 2 rekod → WAJIB groupReference ──
test('perluGroupReference — CASE A2: 1 guru × 2 hari (2 rekod) → true', () => {
  assert.equal(perluGroupReference(1, 2), true);
});

// ── CASE A3: 1 guru × 4 hari → 4 rekod → WAJIB groupReference ──
test('perluGroupReference — CASE A3: 1 guru × 4 hari (4 rekod) → true', () => {
  assert.equal(perluGroupReference(1, 4), true);
});

// ── CASE A4: 2 guru × 1 hari → 2 rekod → WAJIB groupReference ──
test('perluGroupReference — CASE A4: 2 guru × 1 hari (2 rekod) → true', () => {
  assert.equal(perluGroupReference(2, 1), true);
});

// ── CASE A5: 3 guru × 4 hari → 12 rekod → WAJIB groupReference ──
test('perluGroupReference — CASE A5: 3 guru × 4 hari (12 rekod) → true', () => {
  assert.equal(perluGroupReference(3, 4), true);
});

// ── Sempadan tambahan ──
test('perluGroupReference — 0 hari/guru (input tidak sah) → false (selamat)', () => {
  assert.equal(perluGroupReference(0, 5), false);
  assert.equal(perluGroupReference(5, 0), false);
});

test('perluGroupReference — julat maksimum (1 guru × 31 hari, MAX_HARI_JULAT) → true', () => {
  assert.equal(perluGroupReference(1, 31), true);
});
