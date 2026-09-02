// ════════════════════════════════════════════════════════════
//  Ujian: helper format tempoh/tarikh dlm snapshot.service.js.
//  Fungsi TULEN sahaja (tiada Prisma/DB) → selaras dgn corak ujian sedia
//  ada dlm folder ini.
//
//  Patch v1/v2 (format PANJANG — formatTarikhPenuh/formatJulatTarikh/
//  statusTempohLabel): ujian sedia ada DIKEKALKAN tidak berubah. Fungsi
//  ini tidak lagi dipanggil oleh laluan render aktif sejak Patch v3
//  (digantikan versi ringkas di bawah), tetapi kekal wujud & dieksport,
//  jadi ujian ini kekal sah & berguna (regresi + reuse masa depan).
//
//  Patch v3 (format RINGKAS/MINIMAL — hariTitleCase/
//  formatTarikhHeaderPendek/formatJulatTarikhPendek/masaJulatPendek):
//  ujian BAHARU ditambah di bahagian bawah fail ini.
//
//  NOTA: buildSnapshot()/hitungTempohRekod() sendiri bergantung pada
//  Prisma (query DB) jadi tidak diuji di sini secara langsung (sama
//  spt fungsi servis lain dlm projek ini — tiada ujian integrasi DB
//  sedia ada). Ia disahkan berasingan melalui harness mock-Prisma
//  (lihat laporan patch v1/v2/v3) merangkumi kes penuh sebelum setiap
//  patch dihantar; laporan tersebut menerangkan kaedah & keputusan.
// ════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTarikhPenuh, formatJulatTarikh, statusTempohLabel,
  hariTitleCase, formatTarikhHeaderPendek, formatJulatTarikhPendek, masaJulatPendek,
  semuaMetadataSama, binaBlokKumpulanCatatan,
} from '../services/snapshot.service.js';

const d = (s) => {
  const [y, m, day] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};

const entryUji = (nama, overrides = {}) => ({
  nama,
  jenis: 'SEPANJANG_HARI',
  masaMula: null,
  masaTamat: null,
  tarikhMula: d('2026-09-02'),
  tarikhTamat: d('2026-09-02'),
  isMultiDay: false,
  ...overrides,
});

// ── formatTarikhPenuh ──────────────────────────────────────
test('formatTarikhPenuh — "1 OGOS 2026"', () => {
  assert.equal(formatTarikhPenuh(d('2026-08-01')), '1 OGOS 2026');
});

test('formatTarikhPenuh — tiada sifar awalan pd hari', () => {
  assert.equal(formatTarikhPenuh(d('2026-01-05')), '5 JANUARI 2026');
});

test('formatTarikhPenuh — semua 12 nama bulan BM huruf besar', () => {
  const expected = [
    'JANUARI', 'FEBRUARI', 'MAC', 'APRIL', 'MEI', 'JUN',
    'JULAI', 'OGOS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DISEMBER',
  ];
  for (let m = 1; m <= 12; m++) {
    assert.equal(formatTarikhPenuh(d(`2026-${String(m).padStart(2, '0')}-15`)), `15 ${expected[m - 1]} 2026`);
  }
});

// ── formatJulatTarikh ──────────────────────────────────────
test('formatJulatTarikh — dalam bulan sama', () => {
  assert.equal(formatJulatTarikh(d('2026-08-01'), d('2026-08-04')), '1 OGOS 2026 - 4 OGOS 2026');
});

test('formatJulatTarikh — merentas bulan', () => {
  assert.equal(formatJulatTarikh(d('2026-08-30'), d('2026-09-02')), '30 OGOS 2026 - 2 SEPTEMBER 2026');
});

test('formatJulatTarikh — merentas tahun', () => {
  assert.equal(formatJulatTarikh(d('2026-12-30'), d('2027-01-02')), '30 DISEMBER 2026 - 2 JANUARI 2027');
});

// ── statusTempohLabel — format BAHARU (huruf besar, AM/PM) ─
test('statusTempohLabel — SEPANJANG_HARI', () => {
  assert.equal(statusTempohLabel('SEPANJANG_HARI', null, null), 'SEPANJANG HARI');
});

test('statusTempohLabel — SEPARUH_HARI, masaTamat kosong → TAMAT SEKOLAH', () => {
  assert.equal(statusTempohLabel('SEPARUH_HARI', '10:45', null), 'SEPARUH HARI (10:45 AM - TAMAT SEKOLAH)');
});

test('statusTempohLabel — SEPARUH_HARI dgn masa mula & tamat sebenar (pagi)', () => {
  assert.equal(statusTempohLabel('SEPARUH_HARI', '08:00', '11:30'), 'SEPARUH HARI (8:00 AM - 11:30 AM)');
});

test('statusTempohLabel — SEPARUH_HARI merentas tengah hari (AM → PM)', () => {
  assert.equal(statusTempohLabel('SEPARUH_HARI', '11:30', '14:00'), 'SEPARUH HARI (11:30 AM - 2:00 PM)');
});

test('statusTempohLabel — keserasian format sekolah lama (bertitik, kuirk petang)', () => {
  // "1.00" (format sekolah) = 1 petang = 13:00 → sepadan masaKeMinitAuto sedia ada
  assert.equal(statusTempohLabel('SEPARUH_HARI', '1.00', null), 'SEPARUH HARI (1:00 PM - TAMAT SEKOLAH)');
});

test('statusTempohLabel — masaMula tidak sah → fallback SEPANJANG HARI (selamat)', () => {
  assert.equal(statusTempohLabel('SEPARUH_HARI', 'bukan-masa', null), 'SEPANJANG HARI');
  assert.equal(statusTempohLabel('SEPARUH_HARI', '', null), 'SEPANJANG HARI');
  assert.equal(statusTempohLabel('SEPARUH_HARI', null, null), 'SEPANJANG HARI');
});

test('statusTempohLabel — jenis null/tidak dikenali → fallback SEPANJANG HARI (data lama)', () => {
  assert.equal(statusTempohLabel(null, null, null), 'SEPANJANG HARI');
  assert.equal(statusTempohLabel('', null, null), 'SEPANJANG HARI');
});

test('statusTempohLabel — masaTamat <= masaMula (data tidak konsisten) → TAMAT SEKOLAH selamat', () => {
  assert.equal(statusTempohLabel('SEPARUH_HARI', '10:00', '09:00'), 'SEPARUH HARI (10:00 AM - TAMAT SEKOLAH)');
});

// ════════════════════════════════════════════════════════════
//  Patch v3 — format RINGKAS/MINIMAL (paparan sahaja)
// ════════════════════════════════════════════════════════════

// ── hariTitleCase ──────────────────────────────────────────
test('hariTitleCase — "RABU" → "Rabu"', () => {
  assert.equal(hariTitleCase('RABU'), 'Rabu');
});

test('hariTitleCase — semua 7 nama hari BM', () => {
  const kes = { AHAD: 'Ahad', ISNIN: 'Isnin', SELASA: 'Selasa', RABU: 'Rabu', KHAMIS: 'Khamis', JUMAAT: 'Jumaat', SABTU: 'Sabtu' };
  for (const [input, expected] of Object.entries(kes)) assert.equal(hariTitleCase(input), expected);
});

test('hariTitleCase — kosong/null → rentetan kosong (selamat)', () => {
  assert.equal(hariTitleCase(''), '');
  assert.equal(hariTitleCase(null), '');
  assert.equal(hariTitleCase(undefined), '');
});

// ── formatTarikhHeaderPendek ───────────────────────────────
test('formatTarikhHeaderPendek — "2 Sept. 2026" (contoh header dipersetujui)', () => {
  assert.equal(formatTarikhHeaderPendek(d('2026-09-02')), '2 Sept. 2026');
});

test('formatTarikhHeaderPendek — bulan tanpa noktah (Mac/Mei/Jun/Jul/Ogos)', () => {
  assert.equal(formatTarikhHeaderPendek(d('2026-03-01')), '1 Mac 2026');
  assert.equal(formatTarikhHeaderPendek(d('2026-05-01')), '1 Mei 2026');
  assert.equal(formatTarikhHeaderPendek(d('2026-06-01')), '1 Jun 2026');
  assert.equal(formatTarikhHeaderPendek(d('2026-07-01')), '1 Jul 2026');
  assert.equal(formatTarikhHeaderPendek(d('2026-08-01')), '1 Ogos 2026');
});

test('formatTarikhHeaderPendek — tahun SENTIASA dipapar (header ialah satu tarikh, bukan julat)', () => {
  assert.equal(formatTarikhHeaderPendek(d('2026-12-31')), '31 Dis. 2026');
});

// ── formatJulatTarikhPendek ────────────────────────────────
test('formatJulatTarikhPendek — sama bulan+tahun → "2-4 Sept." (tiada tahun/bulan berulang)', () => {
  assert.equal(formatJulatTarikhPendek(d('2026-09-02'), d('2026-09-04')), '2-4 Sept.');
});

test('formatJulatTarikhPendek — sama bulan, bulan tanpa noktah → "1-3 Ogos"', () => {
  assert.equal(formatJulatTarikhPendek(d('2026-08-01'), d('2026-08-03')), '1-3 Ogos');
});

test('formatJulatTarikhPendek — merentas bulan, sama tahun → "30 Ogos-2 Sept." (tiada tahun)', () => {
  assert.equal(formatJulatTarikhPendek(d('2026-08-30'), d('2026-09-02')), '30 Ogos-2 Sept.');
});

test('formatJulatTarikhPendek — merentas tahun → "30 Dis. 2026-2 Jan. 2027" (tahun WAJIB kedua-dua pihak)', () => {
  assert.equal(formatJulatTarikhPendek(d('2026-12-30'), d('2027-01-02')), '30 Dis. 2026-2 Jan. 2027');
});

test('formatJulatTarikhPendek — tanda "-" sentiasa rapat (tiada ruang sekitar)', () => {
  const out = formatJulatTarikhPendek(d('2026-09-02'), d('2026-09-04'));
  assert.ok(!out.includes(' - '), `tidak patut ada " - " berjarak dlm: ${out}`);
  assert.ok(out.includes('-'), `patut ada "-" rapat dlm: ${out}`);
});

// ── masaJulatPendek ────────────────────────────────────────
test('masaJulatPendek — SEPANJANG_HARI → null (tiada apa dipapar)', () => {
  assert.equal(masaJulatPendek('SEPANJANG_HARI', null, null), null);
});

test('masaJulatPendek — SEPARUH_HARI, masaTamat kosong → "10:45 AM-Tamat"', () => {
  assert.equal(masaJulatPendek('SEPARUH_HARI', '10:45', null), '10:45 AM-Tamat');
});

test('masaJulatPendek — SEPARUH_HARI dgn masa tamat sebenar → "8:00 AM-12:00 PM"', () => {
  assert.equal(masaJulatPendek('SEPARUH_HARI', '08:00', '12:00'), '8:00 AM-12:00 PM');
});

test('masaJulatPendek — "Tamat" (bukan "TAMAT SEKOLAH") bila terbuka', () => {
  const out = masaJulatPendek('SEPARUH_HARI', '13:00', null);
  assert.equal(out, '1:00 PM-Tamat');
  assert.ok(!out.includes('TAMAT SEKOLAH'));
});

test('masaJulatPendek — tanda "-" rapat (tiada ruang sekitar), tiada ruang sekitar "-"', () => {
  const out = masaJulatPendek('SEPARUH_HARI', '08:00', '11:30');
  assert.ok(!out.includes(' - '), `tidak patut ada " - " berjarak dlm: ${out}`);
});

test('masaJulatPendek — masaMula tidak sah → null (fallback selamat, sama corak statusTempohLabel)', () => {
  assert.equal(masaJulatPendek('SEPARUH_HARI', 'bukan-masa', null), null);
  assert.equal(masaJulatPendek('SEPARUH_HARI', '', null), null);
});

test('masaJulatPendek — jenis null/tidak dikenali → null (data lama, selamat)', () => {
  assert.equal(masaJulatPendek(null, null, null), null);
});

// ════════════════════════════════════════════════════════════
//  Patch v3.1 — dedup metadata Program/Lain-lain (presentation-only)
// ════════════════════════════════════════════════════════════

// ── semuaMetadataSama ──────────────────────────────────────
test('semuaMetadataSama — metadata sama (bukan kosong) → true', () => {
  assert.equal(semuaMetadataSama(['8:00 AM-9:30 AM', '8:00 AM-9:30 AM']), true);
});

test('semuaMetadataSama — metadata sama-sama KOSONG → true', () => {
  assert.equal(semuaMetadataSama(['', '', '']), true);
});

test('semuaMetadataSama — metadata berbeza → false', () => {
  assert.equal(semuaMetadataSama(['8:00 AM-9:30 AM', '10:00 AM-12:00 PM']), false);
});

test('semuaMetadataSama — satu entry sahaja → false (dedup tiada makna visual)', () => {
  assert.equal(semuaMetadataSama(['8:00 AM-9:30 AM']), false);
});

test('semuaMetadataSama — array kosong → false (selamat)', () => {
  assert.equal(semuaMetadataSama([]), false);
});

// ── binaBlokKumpulanCatatan — CASE 1-8 spesifikasi v3.1 ────
test('binaBlokKumpulanCatatan — CASE 1: metadata separuh-hari sama (3 guru) → dipaparkan SEKALI', () => {
  const entries = [
    entryUji('GURU A', { jenis: 'SEPARUH_HARI', masaMula: '08:00', masaTamat: '09:30' }),
    entryUji('GURU B', { jenis: 'SEPARUH_HARI', masaMula: '08:00', masaTamat: '09:30' }),
    entryUji('GURU C', { jenis: 'SEPARUH_HARI', masaMula: '08:00', masaTamat: '09:30' }),
  ];
  const { teks } = binaBlokKumpulanCatatan(entries, 'Urusan pelajar', 0);
  assert.equal(teks, '1. GURU A\n2. GURU B\n3. GURU C\n\n8:00 AM-9:30 AM\n<i>Urusan pelajar</i>');
  assert.equal((teks.match(/8:00 AM-9:30 AM/g) || []).length, 1, 'metadata mesti muncul TEPAT SEKALI, bukan 3 kali');
});

test('binaBlokKumpulanCatatan — CASE 2: multi-day sama (3 guru) → julat dipaparkan SEKALI', () => {
  const entries = [
    entryUji('GURU A', { tarikhMula: d('2026-09-02'), tarikhTamat: d('2026-09-04'), isMultiDay: true }),
    entryUji('GURU B', { tarikhMula: d('2026-09-02'), tarikhTamat: d('2026-09-04'), isMultiDay: true }),
    entryUji('GURU C', { tarikhMula: d('2026-09-02'), tarikhTamat: d('2026-09-04'), isMultiDay: true }),
  ];
  const { teks } = binaBlokKumpulanCatatan(entries, 'Urusan pelajar', 0);
  assert.equal(teks, '1. GURU A\n2. GURU B\n3. GURU C\n\n2-4 Sept.\n<i>Urusan pelajar</i>');
});

test('binaBlokKumpulanCatatan — CASE 3: multi-day + waktu sama (3 guru) → gabungan "·" dipaparkan SEKALI', () => {
  const entries = [
    entryUji('GURU A', { tarikhMula: d('2026-09-02'), tarikhTamat: d('2026-09-04'), isMultiDay: true, jenis: 'SEPARUH_HARI', masaMula: '08:00', masaTamat: '09:30' }),
    entryUji('GURU B', { tarikhMula: d('2026-09-02'), tarikhTamat: d('2026-09-04'), isMultiDay: true, jenis: 'SEPARUH_HARI', masaMula: '08:00', masaTamat: '09:30' }),
    entryUji('GURU C', { tarikhMula: d('2026-09-02'), tarikhTamat: d('2026-09-04'), isMultiDay: true, jenis: 'SEPARUH_HARI', masaMula: '08:00', masaTamat: '09:30' }),
  ];
  const { teks } = binaBlokKumpulanCatatan(entries, 'Urusan pelajar', 0);
  assert.equal(teks, '1. GURU A\n2. GURU B\n3. GURU C\n\n2-4 Sept. · 8:00 AM-9:30 AM\n<i>Urusan pelajar</i>');
});

test('binaBlokKumpulanCatatan — CASE 4: full-day single-day (metadata sama2 kosong) → nama rapat, TIADA baris metadata, SATU blank line sebelum catatan', () => {
  const entries = [entryUji('GURU A'), entryUji('GURU B'), entryUji('GURU C')];
  const { teks } = binaBlokKumpulanCatatan(entries, 'Urusan pelajar', 0);
  assert.equal(teks, '1. GURU A\n2. GURU B\n3. GURU C\n\n<i>Urusan pelajar</i>');
  assert.ok(teks.includes('3. GURU C\n\n<i>'), 'mesti ada SATU blank line antara nama terakhir dan catatan bila metadata dikongsi KOSONG');
  assert.ok(!teks.includes('3. GURU C\n\n\n<i>'), 'tidak lebih drpd SATU blank line');
});

test('binaBlokKumpulanCatatan — CASE 5: metadata berbeza sepenuhnya → kekal format V3 per-entry', () => {
  const entries = [
    entryUji('HANIZAN', { jenis: 'SEPARUH_HARI', masaMula: '08:00', masaTamat: '09:30' }),
    entryUji('AINUL', { jenis: 'SEPARUH_HARI', masaMula: '10:00', masaTamat: '12:00' }),
    entryUji('DAYANG', { tarikhMula: d('2026-09-02'), tarikhTamat: d('2026-09-04'), isMultiDay: true }),
  ];
  const { teks } = binaBlokKumpulanCatatan(entries, 'Urusan pelajar', 0);
  assert.equal(
    teks,
    '1. HANIZAN\n8:00 AM-9:30 AM\n\n2. AINUL\n10:00 AM-12:00 PM\n\n3. DAYANG\n2-4 Sept.\n\n<i>Urusan pelajar</i>'
  );
});

test('binaBlokKumpulanCatatan — CASE 6: 2 sama + 1 berbeza → JANGAN partial-dedup, semua kekal individu', () => {
  const entries = [
    entryUji('GURU A', { jenis: 'SEPARUH_HARI', masaMula: '08:00', masaTamat: '09:30' }),
    entryUji('GURU B', { jenis: 'SEPARUH_HARI', masaMula: '08:00', masaTamat: '09:30' }),
    entryUji('GURU C', { jenis: 'SEPARUH_HARI', masaMula: '10:00', masaTamat: '12:00' }),
  ];
  const { teks } = binaBlokKumpulanCatatan(entries, 'Catatan', 0);
  assert.equal(
    teks,
    '1. GURU A\n8:00 AM-9:30 AM\n\n2. GURU B\n8:00 AM-9:30 AM\n\n3. GURU C\n10:00 AM-12:00 PM\n\n<i>Catatan</i>'
  );
});

test('binaBlokKumpulanCatatan — CASE 7: satu entry sahaja dlm kumpulan → format V3 asal, tiada hoist pelik', () => {
  const entries = [entryUji('GURU A', { jenis: 'SEPARUH_HARI', masaMula: '08:00', masaTamat: '09:30' })];
  const { teks } = binaBlokKumpulanCatatan(entries, 'Catatan', 0);
  assert.equal(teks, '1. GURU A\n8:00 AM-9:30 AM\n\n<i>Catatan</i>');
});

test('binaBlokKumpulanCatatan — CASE 8: catatan kosong, metadata sama → tiada tag catatan, tiada baris/newline berlebihan di hujung', () => {
  const entries = [
    entryUji('GURU A', { jenis: 'SEPARUH_HARI', masaMula: '08:00', masaTamat: '09:30' }),
    entryUji('GURU B', { jenis: 'SEPARUH_HARI', masaMula: '08:00', masaTamat: '09:30' }),
  ];
  const { teks } = binaBlokKumpulanCatatan(entries, '', 0);
  assert.equal(teks, '1. GURU A\n2. GURU B\n\n8:00 AM-9:30 AM');
  assert.ok(!teks.endsWith('\n'), 'tiada newline tambahan di hujung');
  assert.ok(!teks.includes('<i>'), 'tiada tag catatan bila catatan kosong');
});

test('binaBlokKumpulanCatatan — pembetulan: catatan TERUS selepas metadata dikongsi (satu newline, BUKAN blank line)', () => {
  const entries = [
    entryUji('GURU A', { jenis: 'SEPARUH_HARI', masaMula: '08:00', masaTamat: '09:30' }),
    entryUji('GURU B', { jenis: 'SEPARUH_HARI', masaMula: '08:00', masaTamat: '09:30' }),
  ];
  const { teks } = binaBlokKumpulanCatatan(entries, 'Urusan pelajar', 0);
  assert.ok(teks.includes('9:30 AM\n<i>'), 'metadata->catatan mesti SATU newline sahaja');
  assert.ok(!teks.includes('9:30 AM\n\n<i>'), 'TIDAK patut ada blank line antara metadata dan catatan');
});

test('binaBlokKumpulanCatatan — nomborSeterusnya sambung nombor dgn betul merentas kumpulan', () => {
  const entries = [entryUji('GURU A'), entryUji('GURU B')];
  const { nomborSeterusnya } = binaBlokKumpulanCatatan(entries, 'Sebab', 5);
  assert.equal(nomborSeterusnya, 7);
});
