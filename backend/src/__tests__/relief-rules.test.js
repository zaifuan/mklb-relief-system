// ════════════════════════════════════════════════════════════
//  Ujian UNIT — peraturan pemilihan calon (candidate.service).
//  Tulen, tiada pangkalan data (selaras keputusan #8: jangan import
//  penggantian; uji rule sahaja).
// ════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { masaKeMinit } from '../lib/timeUtil.js';
import {
  adaSekatanKhas,
  isFreepadaWaktu,
  semakRehat,
  cariBestCalon,
} from '../services/candidate.service.js';

const mm = masaKeMinit;

// ── adaSekatanKhas ──
test('adaSekatanKhas — LELAKI hanya kena guru " BIN "', () => {
  const SK = [{ nama: 'LELAKI', hari: ['JUMAAT'], mulaDari: '12.05', mulaHingga: '12.35' }];
  // Lelaki, Jumaat, dalam tetingkap → kena
  assert.equal(adaSekatanKhas('AHMAD BIN ALI', 'JUMAAT', mm('12.00'), mm('12.30'), SK), true);
  // Perempuan (BINTI) → tidak kena
  assert.equal(adaSekatanKhas('FATIMAH BINTI X', 'JUMAAT', mm('12.00'), mm('12.30'), SK), false);
  // Lelaki tapi hari lain → tidak kena
  assert.equal(adaSekatanKhas('AHMAD BIN ALI', 'ISNIN', mm('12.00'), mm('12.30'), SK), false);
  // Lelaki, Jumaat, luar tetingkap masa → tidak kena
  assert.equal(adaSekatanKhas('AHMAD BIN ALI', 'JUMAAT', mm('7.40'), mm('8.10'), SK), false);
});

test('adaSekatanKhas — sekatan nama penuh', () => {
  const SK = [{ nama: 'ZURAINI', hari: ['ISNIN'], mulaDari: '7.40', mulaHingga: '8.10' }];
  assert.equal(adaSekatanKhas('ZURAINI', 'ISNIN', mm('7.40'), mm('8.10'), SK), true);
  assert.equal(adaSekatanKhas('ZAINAB', 'ISNIN', mm('7.40'), mm('8.10'), SK), false);
});

// ── isFreepadaWaktu ──
const jadual = [
  { hari: 'ISNIN', guru: 'CIKGU B', kelas: '4A', masa: '7.40-8.10' },
  { hari: 'ISNIN', guru: 'CIKGU B', kelas: 'FREE', masa: '8.10-8.40' },
];

test('isFreepadaWaktu — mengajar = tidak free; FREE diabai', () => {
  assert.equal(isFreepadaWaktu('CIKGU B', 'ISNIN', mm('7.40'), mm('8.10'), jadual), false);
  assert.equal(isFreepadaWaktu('CIKGU B', 'ISNIN', mm('8.10'), mm('8.40'), jadual), true);
});

// ── semakRehat ──
test('semakRehat — tolak jika bersambung terus', () => {
  // relief 8.10-8.40 bersambung terus dengan mengajar 7.40-8.10 → tolak
  assert.equal(semakRehat('CIKGU B', 'ISNIN', mm('8.10'), mm('8.40'), jadual, {}), false);
  // relief 9.10-9.40 ada jurang → benarkan
  assert.equal(semakRehat('CIKGU B', 'ISNIN', mm('9.10'), mm('9.40'), jadual, {}), true);
});

test('semakRehat — kira relief sesi semasa juga', () => {
  const sesi = { 'CIKGU B': [{ masa: '9.10-9.40' }] };
  // relief baru 9.40-10.10 bersambung terus dgn relief sesi 9.10-9.40 → tolak
  assert.equal(semakRehat('CIKGU B', 'ISNIN', mm('9.40'), mm('10.10'), [], sesi), false);
});

// ── cariBestCalon ──
const configKosong = {
  KATEGORI_EXEMPT: [],
  NAMA_EXEMPT: [],
  SEKATAN_KHAS: [],
  hadDefault: 1,
  thresholdPass2: 10,
  tier2MaxSlotMengajar: 2,
};

function asasArgs(over = {}) {
  return {
    semuaGuruHari: ['CIKGU B', 'CIKGU C'],
    hari: 'ISNIN',
    masaMula: mm('9.10'),
    masaTamat: mm('9.40'),
    semuaAbsenSet: new Set(),
    semuaAbsenMap: {},
    mapKategori: { 'CIKGU B': 'BIASA', 'CIKGU C': 'BIASA' },
    jadualData: [], // tiada konflik mengajar
    gantiGlobal: {},
    cacheSlotFree: { 'CIKGU B': { ISNIN: 2 }, 'CIKGU C': { ISNIN: 4 } },
    cacheSlotMengajar: { 'CIKGU B': { ISNIN: 5 }, 'CIKGU C': { ISNIN: 3 } },
    hadSlotOverride: 1,
    pengecualianList: [],
    config: configKosong,
    ...over,
  };
}

test('cariBestCalon — utamakan slotMengajar paling rendah', () => {
  const calon = cariBestCalon(asasArgs());
  assert.equal(calon[0].nama, 'CIKGU C'); // mengajar 3 < 5
  assert.equal(calon.length, 2);
});

test('cariBestCalon — guru exempt (kategori) dibuang', () => {
  const calon = cariBestCalon(
    asasArgs({
      semuaGuruHari: ['CIKGU C', 'USTAZ D'],
      mapKategori: { 'CIKGU C': 'BIASA', 'USTAZ D': 'PENTADBIR' },
      cacheSlotMengajar: { 'CIKGU C': { ISNIN: 3 }, 'USTAZ D': { ISNIN: 1 } },
      config: { ...configKosong, KATEGORI_EXEMPT: ['PENTADBIR'] },
    })
  );
  assert.deepEqual(
    calon.map((c) => c.nama),
    ['CIKGU C']
  );
});

test('cariBestCalon — had 1/hari kuatkuasa di PASS 1', () => {
  const calon = cariBestCalon(
    asasArgs({
      gantiGlobal: { 'CIKGU C': [{ masa: '7.40-8.10' }] }, // C sudah 1 relief
    })
  );
  assert.deepEqual(
    calon.map((c) => c.nama),
    ['CIKGU B']
  ); // C dikecualikan walau mengajar lebih rendah
});

test('cariBestCalon — Tier 2 hanya pada PASS 2 (override null)', () => {
  // Kedua-dua guru sudah 1 relief; PASS 1 → tiada calon
  const args1 = asasArgs({
    gantiGlobal: { 'CIKGU B': [{ masa: '7.40-8.10' }], 'CIKGU C': [{ masa: '7.40-8.10' }] },
  });
  assert.equal(cariBestCalon(args1).length, 0);

  // PASS 2 (override null): C (mengajar 3 > 2) tidak layak Tier 2; B (5>2) tidak;
  // jadikan seorang ringan untuk uji Tier 2 layak.
  const args2 = asasArgs({
    semuaGuruHari: ['CIKGU E'],
    mapKategori: { 'CIKGU E': 'BIASA' },
    cacheSlotMengajar: { 'CIKGU E': { ISNIN: 2 } }, // <= tier2Max
    gantiGlobal: { 'CIKGU E': [{ masa: '7.40-8.10' }] },
    hadSlotOverride: null,
  });
  const t2 = cariBestCalon(args2);
  assert.equal(t2.length, 1);
  assert.equal(t2[0].nama, 'CIKGU E');
  assert.equal(t2[0].isTier2, true);
});

test('cariBestCalon — elak relief bertindih masa', () => {
  // C sudah relief 9.10-9.40; slot baru 9.10-9.40 bertindih → C dibuang
  const calon = cariBestCalon(
    asasArgs({
      gantiGlobal: { 'CIKGU C': [{ masa: '9.10-9.40' }] },
    })
  );
  assert.deepEqual(
    calon.map((c) => c.nama),
    ['CIKGU B']
  );
});
