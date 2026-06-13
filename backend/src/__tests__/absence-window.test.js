// ════════════════════════════════════════════════════════════
//  Ujian: separuh hari sebagai JULAT MASA TIDAK HADIR.
//   • julatTidakHadir / slotDalamJulat (tulen)
//   • cariBestCalon — guru separuh hari LAYAK jadi guru ganti di LUAR
//     julat, dan DIKECUALIKAN dalam julat.
// ════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { masaKeMinit } from '../lib/timeUtil.js';
import { julatTidakHadir, slotDalamJulat, masaKeMinitAuto } from '../lib/absenceWindow.js';
import { cariBestCalon } from '../services/candidate.service.js';

const mm = masaKeMinit;

// ── julatTidakHadir ───────────────────────────────────────
test('julatTidakHadir — SEPANJANG_HARI = sepanjang hari', () => {
  assert.deepEqual(julatTidakHadir('SEPANJANG_HARI', null, null), { masaMula: 0, masaTamat: 1440 });
});

test('julatTidakHadir — SEPARUH_HARI tanpa tamat = hingga Tamat sekolah (1440)', () => {
  assert.deepEqual(julatTidakHadir('SEPARUH_HARI', '12.30', null), { masaMula: 750, masaTamat: 1440 });
});

test('julatTidakHadir — SEPARUH_HARI dengan julat 8.00–10.00', () => {
  assert.deepEqual(julatTidakHadir('SEPARUH_HARI', '8.00', '10.00'), { masaMula: 480, masaTamat: 600 });
});

test('julatTidakHadir — kuirk petang: 2.30 = 14:30 (870)', () => {
  assert.deepEqual(julatTidakHadir('SEPARUH_HARI', '12.30', '2.30'), { masaMula: 750, masaTamat: 870 });
});

test('julatTidakHadir — masaMula tidak sah → fallback sepanjang hari', () => {
  assert.deepEqual(julatTidakHadir('SEPARUH_HARI', '', null), { masaMula: 0, masaTamat: 1440 });
});

test('julatTidakHadir — tamat <= mula diabai → hingga hujung hari', () => {
  assert.deepEqual(julatTidakHadir('SEPARUH_HARI', '10.00', '9.00'), { masaMula: 600, masaTamat: 1440 });
});

// ── masaKeMinitAuto: 24-jam (borang baharu) + keserasian format sekolah ──
test('masaKeMinitAuto — 24-jam "07:00" = 420, "15:00" = 900, "12:30" = 750', () => {
  assert.equal(masaKeMinitAuto('07:00'), 420);
  assert.equal(masaKeMinitAuto('15:00'), 900);
  assert.equal(masaKeMinitAuto('12:30'), 750);
});

test('masaKeMinitAuto — keserasian rekod lama (format sekolah, kuirk petang)', () => {
  assert.equal(masaKeMinitAuto('8.00'), 480); // 8 pagi
  assert.equal(masaKeMinitAuto('1.00'), 780); // 1 petang
});

test('masaKeMinitAuto — "15:00" (24j) = "3.00" (sekolah) = 900 (minit sama)', () => {
  assert.equal(masaKeMinitAuto('15:00'), masaKeMinit('3.00'));
});

test('masaKeMinitAuto — tidak sah → null', () => {
  assert.equal(masaKeMinitAuto('25:00'), null);
  assert.equal(masaKeMinitAuto('08:60'), null);
  assert.equal(masaKeMinitAuto(''), null);
});

test('julatTidakHadir — input 24-jam "08:00"–"10:00" = {480,600}', () => {
  assert.deepEqual(julatTidakHadir('SEPARUH_HARI', '08:00', '10:00'), { masaMula: 480, masaTamat: 600 });
});

test('julatTidakHadir — 24-jam "15:00" tanpa tamat = {900,1440}', () => {
  assert.deepEqual(julatTidakHadir('SEPARUH_HARI', '15:00', null), { masaMula: 900, masaTamat: 1440 });
});

test('julatTidakHadir — slot jadual (sekolah) bertindih julat 24-jam', () => {
  // Guru tidak hadir 14:00–16:00 (24j); slot jadual "3.00-3.30" (sekolah = 15:00–15:30) → bertindih.
  const julat = julatTidakHadir('SEPARUH_HARI', '14:00', '16:00'); // {840,960}
  assert.equal(slotDalamJulat(masaKeMinit('3.00'), masaKeMinit('3.30'), julat), true);
  // slot "8.00-9.00" (08:00–09:00) → tidak bertindih
  assert.equal(slotDalamJulat(masaKeMinit('8.00'), masaKeMinit('9.00'), julat), false);
});
test('slotDalamJulat — slot sebelum julat = tidak bertindih', () => {
  assert.equal(slotDalamJulat(mm('8.00'), mm('8.30'), { masaMula: 750, masaTamat: 1440 }), false);
});

test('slotDalamJulat — slot dalam julat = bertindih', () => {
  assert.equal(slotDalamJulat(mm('1.00'), mm('1.30'), { masaMula: 750, masaTamat: 1440 }), true);
});

test('slotDalamJulat — slot straddle sempadan mula = bertindih', () => {
  // slot 12.00–1.00 (720–780) vs julat mula 12.30 (750) → bertindih
  assert.equal(slotDalamJulat(mm('12.00'), mm('1.00'), { masaMula: 750, masaTamat: 1440 }), true);
});

// ── cariBestCalon: guru separuh hari sebagai calon ────────
// GURU A tidak hadir 12.30–Tamat sekolah → [750,1440].
// Jadual: A free 8.00–8.30, A mengajar 1.00–1.30 (dalam julat); B mengajar 9.00–9.30.
const jadualData = [
  { hari: 'ISNIN', guru: 'GURU A', kelas: 'FREE', masa: '8.00-8.30' },
  { hari: 'ISNIN', guru: 'GURU A', kelas: '1A', masa: '1.00-1.30' },
  { hari: 'ISNIN', guru: 'GURU B', kelas: '2B', masa: '9.00-9.30' },
];
const baseArgs = {
  semuaGuruHari: ['GURU A', 'GURU B'],
  hari: 'ISNIN',
  semuaAbsenSet: new Set(['GURU A']),
  semuaAbsenMap: { 'GURU A': [{ masaMula: 750, masaTamat: 1440 }] },
  mapKategori: { 'GURU A': 'BIASA', 'GURU B': 'BIASA' },
  jadualData,
  gantiGlobal: {},
  cacheSlotFree: { 'GURU A': { ISNIN: 1 }, 'GURU B': { ISNIN: 0 } },
  cacheSlotMengajar: { 'GURU A': { ISNIN: 1 }, 'GURU B': { ISNIN: 1 } },
  hadSlotOverride: 1,
  pengecualianList: [],
  config: { hadDefault: 1, tier2MaxSlotMengajar: 2, KATEGORI_EXEMPT: [], NAMA_EXEMPT: [], SEKATAN_KHAS: [] },
};

test('cariBestCalon — guru separuh hari LAYAK jadi ganti SEBELUM julat tidak hadir', () => {
  const calon = cariBestCalon({ ...baseArgs, masaMula: mm('8.00'), masaTamat: mm('8.30') });
  const nama = calon.map((c) => c.nama);
  assert.ok(nama.includes('GURU A'), 'GURU A patut layak untuk slot 8.00 (di luar julat tidak hadir)');
});

test('cariBestCalon — guru separuh hari DIKECUALIKAN dalam julat tidak hadir', () => {
  const calon = cariBestCalon({ ...baseArgs, masaMula: mm('1.00'), masaTamat: mm('1.30') });
  const nama = calon.map((c) => c.nama);
  assert.ok(!nama.includes('GURU A'), 'GURU A TIDAK patut layak untuk slot 1.00 (dalam julat tidak hadir)');
});
