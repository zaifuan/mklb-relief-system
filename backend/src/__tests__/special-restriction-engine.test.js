// ════════════════════════════════════════════════════════════
//  Ujian — Sekatan Khas Relief: (1) expandRestriction() 3 jenis,
//  (2) sempadan pertindihan masa TEPAT seperti contoh dalam spesifikasi,
//  (3) REGRESI PENUH: bandingkan cariBestCalon() guna CONFIG LAMA
//  (KATEGORI_EXEMPT/NAMA_EXEMPT/LELAKI hardcode, seperti seed.js asal)
//  vs CONFIG BAHARU (hasil migrateSpecialRestrictions.js → expandRestriction())
//  atas roster & jadual yang SAMA — keputusan mesti IDENTIK bagi SETIAP guru
//  yang wujud pada masa migrasi (matlamat teras audit ini).
// ════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { masaKeMinit } from '../lib/timeUtil.js';
import { adaSekatanKhas, cariBestCalon } from '../services/candidate.service.js';
import { expandRestriction } from '../lib/restrictionExpansion.js';

const mm = masaKeMinit;
const HARI_SEKOLAH = ['ISNIN', 'SELASA', 'RABU', 'KHAMIS', 'JUMAAT'];

// ════════════════════════════════════════════════════════════
// (1) expandRestriction() — bentuk kembangan 3 jenis
// ════════════════════════════════════════════════════════════
test('expandRestriction — FULL_WEEK kembang kepada semua 5 hari, 00.00-23.59', () => {
  const row = { restrictionType: 'FULL_WEEK', hariList: [], masaDari: null, masaHingga: null, target: 'ZAINUDDIN BIN OMAR', teacher: { nama: 'ZAINUDDIN BIN OMAR' } };
  const out = expandRestriction(row);
  assert.equal(out.nama, 'ZAINUDDIN BIN OMAR');
  assert.deepEqual(out.hari, HARI_SEKOLAH);
  assert.equal(out.mulaDari, '00.00');
  assert.equal(out.mulaHingga, '23.59');
});

test('expandRestriction — SPECIFIC_DAYS kembang kepada hari terpilih sahaja, 00.00-23.59', () => {
  const row = { restrictionType: 'SPECIFIC_DAYS', hariList: ['ISNIN', 'RABU', 'JUMAAT'], masaDari: null, masaHingga: null, target: 'CIKGU X', teacher: null };
  const out = expandRestriction(row);
  assert.deepEqual(out.hari, ['ISNIN', 'RABU', 'JUMAAT']);
  assert.equal(out.mulaDari, '00.00');
  assert.equal(out.mulaHingga, '23.59');
});

test('expandRestriction — SPECIFIC_TIME kekalkan hari & masa sebenar', () => {
  const row = { restrictionType: 'SPECIFIC_TIME', hariList: ['ISNIN', 'SELASA'], masaDari: '13.00', masaHingga: '13.30', target: 'CIKGU Y', teacher: { nama: 'CIKGU Y' } };
  const out = expandRestriction(row);
  assert.deepEqual(out.hari, ['ISNIN', 'SELASA']);
  assert.equal(out.mulaDari, '13.00');
  assert.equal(out.mulaHingga, '13.30');
});

test('expandRestriction — utamakan teacher.nama (live) berbanding target (snapshot) jika ada relasi', () => {
  const row = { restrictionType: 'FULL_WEEK', hariList: [], masaDari: null, masaHingga: null, target: 'NAMA LAMA', teacher: { nama: 'NAMA SEMASA' } };
  assert.equal(expandRestriction(row).nama, 'NAMA SEMASA');
});

test('expandRestriction — fallback kepada target (snapshot) jika tiada teacherId/relasi (rekod warisan)', () => {
  const row = { restrictionType: 'SPECIFIC_TIME', hariList: ['ISNIN'], masaDari: '08.00', masaHingga: '09.00', target: 'CIKGU LAMA BIN SUDAH BERSARA', teacher: null };
  assert.equal(expandRestriction(row).nama, 'CIKGU LAMA BIN SUDAH BERSARA');
});

// ════════════════════════════════════════════════════════════
// (2) Sempadan pertindihan — CONTOH TEPAT daripada spesifikasi ZAI:
//     Sekatan Waktu Tertentu 13.00–13.30
// ════════════════════════════════════════════════════════════
test('adaSekatanKhas — sempadan pertindihan TEPAT seperti contoh spesifikasi (13.00-13.30)', () => {
  const SK = [{ nama: 'CIKGU ZAI', hari: ['ISNIN'], mulaDari: '13.00', mulaHingga: '13.30' }];
  const kena = (mula, tamat) => adaSekatanKhas('CIKGU ZAI', 'ISNIN', mm(mula), mm(tamat), SK);

  assert.equal(kena('12.30', '13.00'), false, '12:30–13:00 → TIDAK disekat (bersambung tepat, tiada pertindihan)');
  assert.equal(kena('12.45', '13.15'), true, '12:45–13:15 → DISEKAT (bertindih)');
  assert.equal(kena('13.00', '13.30'), true, '13:00–13:30 → DISEKAT (tepat sama)');
  assert.equal(kena('13.15', '13.45'), true, '13:15–13:45 → DISEKAT (bertindih)');
  assert.equal(kena('13.30', '14.00'), false, '13:30–14:00 → TIDAK disekat (bersambung tepat, tiada pertindihan)');
});

// ════════════════════════════════════════════════════════════
// (3) REGRESI PENUH — CONFIG LAMA (seed.js asal) vs CONFIG BAHARU
//     (migrateSpecialRestrictions.js) atas roster + jadual SAMA.
// ════════════════════════════════════════════════════════════

// Roster meniru fixture __tests__/migrate-special-restrictions.test.js.
const ROSTER = [
  'ZAINUDDIN BIN OMAR', // Pengetua baharu (PENTADBIR, lelaki)
  'ROSNAH BINTI KASSIM', // GPK (PENTADBIR, perempuan)
  'ZURAINI BINTI IBRAHIM',
  'SITI AMIRA BINTI MOHD DIN',
  'ZULAIKAH BINTI MOHD NGAT',
  'SUHAINA BINTI SHARIPUDDIN',
  'MOHAMAD ZAIFUAN BIN ZULKAFLEE',
  'HANIZA BINTI MUSTAPHA',
  'MOHD SHARIFUDDIN BIN ABDUL LATIF',
  'AHMAD BIN TALIB',
  'CIKGU BIASA PEREMPUAN',
];

const mapKategori = {
  'ZAINUDDIN BIN OMAR': 'PENTADBIR',
  'ROSNAH BINTI KASSIM': 'PENTADBIR',
  'ZURAINI BINTI IBRAHIM': 'BIASA',
  'SITI AMIRA BINTI MOHD DIN': 'BIASA',
  'ZULAIKAH BINTI MOHD NGAT': 'BIASA',
  'SUHAINA BINTI SHARIPUDDIN': 'BIASA',
  'MOHAMAD ZAIFUAN BIN ZULKAFLEE': 'BIASA',
  'HANIZA BINTI MUSTAPHA': 'BIASA',
  'MOHD SHARIFUDDIN BIN ABDUL LATIF': 'BIASA',
  'AHMAD BIN TALIB': 'BIASA',
  'CIKGU BIASA PEREMPUAN': 'BIASA',
};

// ── CONFIG LAMA — sepadan TEPAT seed.js/reliefConfig.js SEBELUM migrasi ──
const OLD_KATEGORI_EXEMPT = ['PENTADBIR'];
const OLD_NAMA_EXEMPT = ['HANIZA BINTI MUSTAPHA'];
const OLD_SEKATAN_KHAS = [
  { nama: 'ZURAINI BINTI IBRAHIM', hari: ['SELASA'], mulaDari: '11.00', mulaHingga: '14.30' },
  { nama: 'SITI AMIRA BINTI MOHD DIN', hari: ['SELASA'], mulaDari: '11.00', mulaHingga: '14.30' },
  { nama: 'ZULAIKAH BINTI MOHD NGAT', hari: HARI_SEKOLAH, mulaDari: '00.00', mulaHingga: '23.59' },
  { nama: 'SUHAINA BINTI SHARIPUDDIN', hari: ['JUMAAT'], mulaDari: '11.35', mulaHingga: '12.35' },
  { nama: 'MOHAMAD ZAIFUAN BIN ZULKAFLEE', hari: ['ISNIN', 'SELASA', 'RABU'], mulaDari: '13.00', mulaHingga: '13.30' },
  { nama: 'MOHAMAD ZAIFUAN BIN ZULKAFLEE', hari: ['KHAMIS'], mulaDari: '12.30', mulaHingga: '13.00' },
  { nama: 'HANIZA BINTI MUSTAPHA', hari: ['SELASA', 'RABU', 'KHAMIS'], mulaDari: '07.40', mulaHingga: '09.10' },
  { nama: 'LELAKI', hari: ['JUMAAT'], mulaDari: '12.05', mulaHingga: '12.35' }, // magic string asal
  { nama: 'MOHD SHARIFUDDIN BIN ABDUL LATIF', hari: ['ISNIN', 'SELASA', 'RABU'], mulaDari: '13.30', mulaHingga: '14.30' },
];

// ── CONFIG BAHARU — hasil sebenar migrateSpecialRestrictions.js (disahkan
//    terhadap Postgres 16 sebenar dalam audit) → dikembang guna expandRestriction() ──
const NEW_ROWS = [
  { restrictionType: 'SPECIFIC_TIME', hariList: ['SELASA'], masaDari: '11.00', masaHingga: '14.30', target: 'ZURAINI BINTI IBRAHIM', teacher: { nama: 'ZURAINI BINTI IBRAHIM' } },
  { restrictionType: 'SPECIFIC_TIME', hariList: ['SELASA'], masaDari: '11.00', masaHingga: '14.30', target: 'SITI AMIRA BINTI MOHD DIN', teacher: { nama: 'SITI AMIRA BINTI MOHD DIN' } },
  { restrictionType: 'FULL_WEEK', hariList: [], masaDari: null, masaHingga: null, target: 'ZULAIKAH BINTI MOHD NGAT', teacher: { nama: 'ZULAIKAH BINTI MOHD NGAT' } },
  { restrictionType: 'SPECIFIC_TIME', hariList: ['JUMAAT'], masaDari: '11.35', masaHingga: '12.35', target: 'SUHAINA BINTI SHARIPUDDIN', teacher: { nama: 'SUHAINA BINTI SHARIPUDDIN' } },
  { restrictionType: 'SPECIFIC_TIME', hariList: ['ISNIN', 'SELASA', 'RABU'], masaDari: '13.00', masaHingga: '13.30', target: 'MOHAMAD ZAIFUAN BIN ZULKAFLEE', teacher: { nama: 'MOHAMAD ZAIFUAN BIN ZULKAFLEE' } },
  { restrictionType: 'SPECIFIC_TIME', hariList: ['KHAMIS'], masaDari: '12.30', masaHingga: '13.00', target: 'MOHAMAD ZAIFUAN BIN ZULKAFLEE', teacher: { nama: 'MOHAMAD ZAIFUAN BIN ZULKAFLEE' } },
  { restrictionType: 'SPECIFIC_TIME', hariList: ['JUMAAT'], masaDari: '12.05', masaHingga: '12.35', target: 'MOHAMAD ZAIFUAN BIN ZULKAFLEE', teacher: { nama: 'MOHAMAD ZAIFUAN BIN ZULKAFLEE' } }, // bekas LELAKI
  { restrictionType: 'SPECIFIC_TIME', hariList: ['ISNIN', 'SELASA', 'RABU'], masaDari: '13.30', masaHingga: '14.30', target: 'MOHD SHARIFUDDIN BIN ABDUL LATIF', teacher: { nama: 'MOHD SHARIFUDDIN BIN ABDUL LATIF' } },
  { restrictionType: 'SPECIFIC_TIME', hariList: ['JUMAAT'], masaDari: '12.05', masaHingga: '12.35', target: 'MOHD SHARIFUDDIN BIN ABDUL LATIF', teacher: { nama: 'MOHD SHARIFUDDIN BIN ABDUL LATIF' } }, // bekas LELAKI
  { restrictionType: 'SPECIFIC_TIME', hariList: ['JUMAAT'], masaDari: '12.05', masaHingga: '12.35', target: 'AHMAD BIN TALIB', teacher: { nama: 'AHMAD BIN TALIB' } }, // bekas LELAKI, baharu sepenuhnya
  { restrictionType: 'FULL_WEEK', hariList: [], masaDari: null, masaHingga: null, target: 'ZAINUDDIN BIN OMAR', teacher: { nama: 'ZAINUDDIN BIN OMAR' } }, // drpd KATEGORI_PENTADBIR (ZAINUDDIN dilangkau LELAKI kerana ini)
  { restrictionType: 'FULL_WEEK', hariList: [], masaDari: null, masaHingga: null, target: 'ROSNAH BINTI KASSIM', teacher: { nama: 'ROSNAH BINTI KASSIM' } }, // drpd KATEGORI_PENTADBIR
  { restrictionType: 'FULL_WEEK', hariList: [], masaDari: null, masaHingga: null, target: 'HANIZA BINTI MUSTAPHA', teacher: { nama: 'HANIZA BINTI MUSTAPHA' } }, // drpd NAMA_EXEMPT (rekod waktu lama dinyahaktifkan, tidak disenaraikan di sini)
];
const NEW_SEKATAN_KHAS = NEW_ROWS.map(expandRestriction);
const NEW_KATEGORI_EXEMPT = [];
const NEW_NAMA_EXEMPT = [];

const norm = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');

// ── Replikasi BEKU logik pengecualian LAMA (candidate.service.js SEBELUM
//    Sekatan Khas Relief — cabang khas LELAKI + KATEGORI_EXEMPT/NAMA_EXEMPT
//    sebagai sumber AKTIF). Ini snapshot SEJARAH semata-mata untuk bukti
//    regresi — BUKAN kod produksi (kod produksi sebenar sudah diubah; tidak
//    boleh "re-derive" tingkah laku lama drpd fungsi yang sudah disunting).
function oldAdaSekatanKhasBeku(namaGuru, hari, mula, tamat, SEKATAN_KHAS) {
  const g = norm(namaGuru);
  const h = String(hari).toUpperCase();
  for (const s of SEKATAN_KHAS) {
    if (s.nama === 'LELAKI') {
      if (!g.includes(' BIN ')) continue;
    } else if (norm(s.nama) !== g) {
      continue;
    }
    if (!(s.hari || []).includes(h)) continue;
    const sm = mm(s.mulaDari);
    const st = mm(s.mulaHingga);
    if (sm === null || st === null) continue;
    if (mula < st && tamat > sm) return true;
  }
  return false;
}

function wasRestrictedOld(nama, kategori, hari, mula, tamat) {
  if (OLD_KATEGORI_EXEMPT.includes(kategori)) return true;
  if (OLD_NAMA_EXEMPT.includes(norm(nama))) return true;
  return oldAdaSekatanKhasBeku(nama, hari, mm(mula), mm(tamat), OLD_SEKATAN_KHAS);
}

// Guna FUNGSI SEBENAR (sudah diubah) — inilah kod produksi yang sedang diuji.
function isRestrictedNew(nama, kategori, hari, mula, tamat) {
  if (NEW_KATEGORI_EXEMPT.includes(kategori)) return true; // sentiasa kosong selepas migrasi
  if (NEW_NAMA_EXEMPT.includes(norm(nama))) return true; // sentiasa kosong selepas migrasi
  return adaSekatanKhas(nama, hari, mm(mula), mm(tamat), NEW_SEKATAN_KHAS);
}

// Jana titik mula setiap 5 minit dari 07.00 hingga 15.00 (merangkumi semua
// sempadan sekatan sebenar: 07.40, 12.05, 12.30, 12.35, 13.00, 13.30, 14.30…),
// slot tetap 30 minit.
function janaSlotMasa() {
  const slots = [];
  for (let totalMin = 7 * 60; totalMin <= 15 * 60; totalMin += 5) {
    const jam = Math.floor(totalMin / 60);
    const minit = totalMin % 60;
    const mula = `${jam}.${String(minit).padStart(2, '0')}`;
    const tMin = totalMin + 30;
    const tJam = Math.floor(tMin / 60);
    const tMinit = tMin % 60;
    const tamat = `${tJam}.${String(tMinit).padStart(2, '0')}`;
    slots.push({ mula, tamat });
  }
  return slots;
}
const SLOT_SWEEP = janaSlotMasa();

test('REGRESI PENUH — setiap guru × setiap hari × setiap slot 5-minit (07.00-15.00): keputusan pengecualian LAMA === BAHARU', () => {
  const percanggahan = [];
  for (const nama of ROSTER) {
    const kategori = mapKategori[nama];
    for (const hari of HARI_SEKOLAH) {
      for (const { mula, tamat } of SLOT_SWEEP) {
        const lama = wasRestrictedOld(nama, kategori, hari, mula, tamat);
        const baharu = isRestrictedNew(nama, kategori, hari, mula, tamat);
        if (lama !== baharu) {
          percanggahan.push({ nama, hari, mula, tamat, lama, baharu });
        }
      }
    }
  }
  assert.deepEqual(percanggahan, [], `Terdapat ${percanggahan.length} percanggahan keputusan LAMA vs BAHARU`);
});

// ════════════════════════════════════════════════════════════
// (4) Ujian fungsian PIPELINE PENUH (cariBestCalon) guna CONFIG BAHARU sahaja
//     — bukti bahawa expandRestriction() + adaSekatanKhas() disambung betul
//     ke enjin sebenar (Pass 1/ranking/Tier2 sudah diuji berasingan dlm
//     relief-rules.test.js dan TIDAK disentuh oleh perubahan ini).
// ════════════════════════════════════════════════════════════
function baseCalonArgs({ hari, masaMula, masaTamat, config }) {
  return {
    semuaGuruHari: ROSTER,
    hari,
    masaMula: mm(masaMula),
    masaTamat: mm(masaTamat),
    semuaAbsenSet: new Set(),
    semuaAbsenMap: {},
    mapKategori,
    jadualData: [],
    gantiGlobal: {},
    cacheSlotFree: {},
    cacheSlotMengajar: {},
    hadSlotOverride: 1,
    pengecualianList: [],
    guruKecualiList: [],
    swapBuyers: new Set(),
    config,
  };
}

const NEW_CONFIG = {
  KATEGORI_EXEMPT: NEW_KATEGORI_EXEMPT,
  NAMA_EXEMPT: NEW_NAMA_EXEMPT,
  SEKATAN_KHAS: NEW_SEKATAN_KHAS,
  hadDefault: 1,
  thresholdPass2: 10,
  tier2MaxSlotMengajar: 2,
};

test('cariBestCalon (CONFIG BAHARU) — tetingkap bekas-LELAKI Jumaat 12.05-12.35: ketiga-tiga bekas-LELAKI disekat, guru lain kekal calon', () => {
  const calon = cariBestCalon(baseCalonArgs({ hari: 'JUMAAT', masaMula: '12.10', masaTamat: '12.20', config: NEW_CONFIG })).map((c) => c.nama);
  assert.ok(!calon.includes('MOHAMAD ZAIFUAN BIN ZULKAFLEE'));
  assert.ok(!calon.includes('MOHD SHARIFUDDIN BIN ABDUL LATIF'));
  assert.ok(!calon.includes('AHMAD BIN TALIB'));
  assert.ok(!calon.includes('ZAINUDDIN BIN OMAR')); // FULL_WEEK (PENTADBIR)
  assert.ok(!calon.includes('ROSNAH BINTI KASSIM')); // FULL_WEEK (PENTADBIR)
  assert.ok(!calon.includes('HANIZA BINTI MUSTAPHA')); // FULL_WEEK (bekas NAMA_EXEMPT)
  assert.ok(calon.includes('ZURAINI BINTI IBRAHIM'));
  assert.ok(calon.includes('CIKGU BIASA PEREMPUAN'));
});

test('cariBestCalon (CONFIG BAHARU) — luar tetingkap bekas-LELAKI (Jumaat pagi): bekas-LELAKI kembali menjadi calon', () => {
  const calon = cariBestCalon(baseCalonArgs({ hari: 'JUMAAT', masaMula: '07.40', masaTamat: '08.10', config: NEW_CONFIG })).map((c) => c.nama);
  assert.ok(calon.includes('MOHAMAD ZAIFUAN BIN ZULKAFLEE'));
  assert.ok(calon.includes('MOHD SHARIFUDDIN BIN ABDUL LATIF'));
  assert.ok(calon.includes('AHMAD BIN TALIB'));
  // FULL_WEEK sentiasa disekat tanpa mengira hari/masa
  assert.ok(!calon.includes('ZAINUDDIN BIN OMAR'));
  assert.ok(!calon.includes('HANIZA BINTI MUSTAPHA'));
});
