// ════════════════════════════════════════════════════════════
//  Ujian UNIT — planMigration() (prisma/migrateSpecialRestrictions.js).
//  Tulen, tiada pangkalan data — fixture meniru struktur data sedia ada
//  dalam seed.js/system_settings sebelum migrasi "Sekatan Khas Relief".
// ════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMigration } from '../../prisma/migrateSpecialRestrictions.js';

// ── Fixture: meniru keadaan pangkalan data SEBELUM migrasi ──
const allTeachers = [
  { id: 1, nama: 'ZAINUDDIN BIN OMAR', isActive: true }, // Pengetua baharu (PENTADBIR, lelaki)
  { id: 2, nama: 'ROSNAH BINTI KASSIM', isActive: true }, // GPK (PENTADBIR, perempuan)
  { id: 3, nama: 'ZURAINI BINTI IBRAHIM', isActive: true },
  { id: 4, nama: 'SITI AMIRA BINTI MOHD DIN', isActive: true },
  { id: 5, nama: 'ZULAIKAH BINTI MOHD NGAT', isActive: true },
  { id: 6, nama: 'SUHAINA BINTI SHARIPUDDIN', isActive: true },
  { id: 7, nama: 'MOHAMAD ZAIFUAN BIN ZULKAFLEE', isActive: true },
  { id: 8, nama: 'HANIZA BINTI MUSTAPHA', isActive: true },
  { id: 9, nama: 'MOHD SHARIFUDDIN BIN ABDUL LATIF', isActive: true },
  { id: 10, nama: 'AHMAD BIN TALIB', isActive: true }, // lelaki lain, tiada sekatan individu lagi
  { id: 11, nama: 'CIKGU BIASA PEREMPUAN', isActive: true },
  { id: 12, nama: 'PENGETUA LAMA BIN HASHIM', isActive: false }, // Pengetua lama, sudah tidak aktif
];

const pentadbirActiveTeachers = [
  { id: 1, nama: 'ZAINUDDIN BIN OMAR' },
  { id: 2, nama: 'ROSNAH BINTI KASSIM' },
];

const namaExemptList = ['HANIZA BINTI MUSTAPHA', 'USTAZAH LAMA BINTI TIADA REKOD'];

const existingRestrictions = [
  { id: 101, target: 'ZURAINI BINTI IBRAHIM', hariList: ['SELASA'], masaDari: '11.00', masaHingga: '14.30', restrictionType: 'SPECIFIC_TIME', teacherId: null, isActive: true },
  { id: 102, target: 'SITI AMIRA BINTI MOHD DIN', hariList: ['SELASA'], masaDari: '11.00', masaHingga: '14.30', restrictionType: 'SPECIFIC_TIME', teacherId: null, isActive: true },
  { id: 103, target: 'ZULAIKAH BINTI MOHD NGAT', hariList: ['ISNIN', 'SELASA', 'RABU', 'KHAMIS', 'JUMAAT'], masaDari: '00.00', masaHingga: '23.59', restrictionType: 'SPECIFIC_TIME', teacherId: null, isActive: true },
  { id: 104, target: 'SUHAINA BINTI SHARIPUDDIN', hariList: ['JUMAAT'], masaDari: '11.35', masaHingga: '12.35', restrictionType: 'SPECIFIC_TIME', teacherId: null, isActive: true },
  { id: 105, target: 'MOHAMAD ZAIFUAN BIN ZULKAFLEE', hariList: ['ISNIN', 'SELASA', 'RABU'], masaDari: '13.00', masaHingga: '13.30', restrictionType: 'SPECIFIC_TIME', teacherId: null, isActive: true },
  { id: 106, target: 'MOHAMAD ZAIFUAN BIN ZULKAFLEE', hariList: ['KHAMIS'], masaDari: '12.30', masaHingga: '13.00', restrictionType: 'SPECIFIC_TIME', teacherId: null, isActive: true },
  { id: 107, target: 'HANIZA BINTI MUSTAPHA', hariList: ['SELASA', 'RABU', 'KHAMIS'], masaDari: '07.40', masaHingga: '09.10', restrictionType: 'SPECIFIC_TIME', teacherId: null, isActive: true },
  { id: 108, target: 'LELAKI', hariList: ['JUMAAT'], masaDari: '12.05', masaHingga: '12.35', restrictionType: 'SPECIFIC_TIME', teacherId: null, isActive: true },
  { id: 109, target: 'MOHD SHARIFUDDIN BIN ABDUL LATIF', hariList: ['ISNIN', 'SELASA', 'RABU'], masaDari: '13.30', masaHingga: '14.30', restrictionType: 'SPECIFIC_TIME', teacherId: null, isActive: true },
  { id: 110, target: 'CIKGU LAMA BIN SUDAH BERSARA', hariList: ['ISNIN'], masaDari: '08.00', masaHingga: '09.00', restrictionType: 'SPECIFIC_TIME', teacherId: null, isActive: true },
];

function baseInput(overrides = {}) {
  return { pentadbirActiveTeachers, namaExemptList, allTeachers, existingRestrictions, ...overrides };
}

test('planMigration — PENTADBIR aktif dipindahkan kepada FULL_WEEK', () => {
  const plan = planMigration(baseInput());
  const namesGranted = plan.createFullWeek.map((c) => c.nama);
  assert.ok(namesGranted.includes('ZAINUDDIN BIN OMAR'));
  assert.ok(namesGranted.includes('ROSNAH BINTI KASSIM'));
  const zainuddin = plan.createFullWeek.find((c) => c.nama === 'ZAINUDDIN BIN OMAR');
  assert.equal(zainuddin.sourceReason, 'KATEGORI_PENTADBIR');
});

test('planMigration — Pengetua LAMA (tidak aktif) TIDAK menerima FULL_WEEK', () => {
  const plan = planMigration(baseInput());
  const names = plan.createFullWeek.map((c) => c.nama);
  assert.ok(!names.includes('PENGETUA LAMA BIN HASHIM'));
});

test('planMigration — nama_exempt sepadan dipindahkan kepada FULL_WEEK; tidak sepadan dilaporkan', () => {
  const plan = planMigration(baseInput());
  const haniza = plan.createFullWeek.find((c) => c.nama === 'HANIZA BINTI MUSTAPHA');
  assert.ok(haniza);
  assert.equal(haniza.sourceReason, 'NAMA_EXEMPT');
  assert.deepEqual(plan.unmatchedNamaExempt, ['USTAZAH LAMA BINTI TIADA REKOD']);
});

test('planMigration — Keputusan#3: rekod waktu lama HANIZA dinyahaktifkan (bukan dipadam), bukan dua aktif', () => {
  const plan = planMigration(baseInput());
  const deact = plan.deactivate.find((d) => d.id === 107);
  assert.ok(deact, 'rekod #107 (Haniza, waktu lama) mesti dinyahaktifkan');
  // Tetap direklasifikasi (untuk rekod tepat jika perlu diaktifkan semula secara manual),
  // tapi TIDAK dipadam terus.
  const reclass = plan.reclassify.find((r) => r.id === 107);
  assert.ok(reclass);
  assert.equal(reclass.restrictionType, 'SPECIFIC_TIME');
});

test('planMigration — rekod 00.00-23.59 semua 5 hari → FULL_WEEK (ZULAIKAH)', () => {
  const plan = planMigration(baseInput());
  const r = plan.reclassify.find((x) => x.id === 103);
  assert.equal(r.restrictionType, 'FULL_WEEK');
  assert.deepEqual(r.hariList, []);
  assert.equal(r.masaDari, null);
  assert.equal(r.masaHingga, null);
});

test('planMigration — rekod waktu sebenar kekal SPECIFIC_TIME + hari tersusun ikut ISNIN..JUMAAT', () => {
  const plan = planMigration(baseInput());
  const zuraini = plan.reclassify.find((x) => x.id === 101);
  assert.equal(zuraini.restrictionType, 'SPECIFIC_TIME');
  assert.deepEqual(zuraini.hariList, ['SELASA']);
  assert.equal(zuraini.masaDari, '11.00');
  assert.equal(zuraini.masaHingga, '14.30');

  // Dua rekod ZAIFUAN berbeza (hari & masa berbeza) mesti KEKAL berasingan, bukan digabung.
  const zaifuanRows = plan.reclassify.filter((x) => x.id === 105 || x.id === 106);
  assert.equal(zaifuanRows.length, 2);
});

test('planMigration — teacherId dipautkan ikut padanan nama (termasuk guru tidak aktif jika wujud rekod)', () => {
  const plan = planMigration(baseInput());
  const zuraini = plan.reclassify.find((x) => x.id === 101);
  assert.equal(zuraini.teacherId, 3); // ZURAINI BINTI IBRAHIM id=3
});

test('planMigration — rekod tanpa padanan Teacher dilaporkan, teacherId kekal null, TIDAK gagal', () => {
  const plan = planMigration(baseInput());
  const unmatched = plan.unmatchedLegacyRows.find((u) => u.id === 110);
  assert.ok(unmatched, 'rekod #110 (CIKGU LAMA BIN SUDAH BERSARA) mesti dilaporkan sebagai unmatched');
  const reclass = plan.reclassify.find((x) => x.id === 110);
  assert.equal(reclass.teacherId, null);
  assert.equal(reclass.restrictionType, 'SPECIFIC_TIME'); // masih dikembangkan, hanya teacherId null
});

test('planMigration — LELAKI dikembangkan kepada SETIAP guru lelaki AKTIF sebagai SPECIFIC_TIME individu', () => {
  const plan = planMigration(baseInput());
  const names = plan.createSpecificTimeForLelaki.map((c) => c.nama);
  assert.ok(names.includes('MOHAMAD ZAIFUAN BIN ZULKAFLEE'));
  assert.ok(names.includes('MOHD SHARIFUDDIN BIN ABDUL LATIF'));
  assert.ok(names.includes('AHMAD BIN TALIB')); // guru lelaki TANPA sebarang sekatan individu sebelum ini
  assert.ok(!names.includes('PENGETUA LAMA BIN HASHIM')); // tidak aktif → dikecualikan

  const ahmad = plan.createSpecificTimeForLelaki.find((c) => c.nama === 'AHMAD BIN TALIB');
  assert.deepEqual(ahmad.hariList, ['JUMAAT']);
  assert.equal(ahmad.masaDari, '12.05');
  assert.equal(ahmad.masaHingga, '12.35');
});

test('planMigration — perempuan (BINTI) TIDAK tersentuh oleh pengembangan LELAKI', () => {
  const plan = planMigration(baseInput());
  const names = plan.createSpecificTimeForLelaki.map((c) => c.nama);
  assert.ok(!names.includes('CIKGU BIASA PEREMPUAN'));
  assert.ok(!names.includes('ROSNAH BINTI KASSIM'));
});

test('planMigration — guru lelaki yang sudah/akan FULL_WEEK dilangkau drpd pengembangan LELAKI (elak pendua)', () => {
  const plan = planMigration(baseInput());
  const names = plan.createSpecificTimeForLelaki.map((c) => c.nama);
  assert.ok(!names.includes('ZAINUDDIN BIN OMAR')); // PENTADBIR → sudah FULL_WEEK
  const skipped = plan.skippedLelakiAlreadyFullWeek.map((s) => s.nama);
  assert.ok(skipped.includes('ZAINUDDIN BIN OMAR'));
});

test('planMigration — rekod LELAKI asal dirancang untuk PADAM (bukan sekadar nyahaktif)', () => {
  const plan = planMigration(baseInput());
  assert.deepEqual(
    plan.lelakiRowsToDelete.map((d) => d.id),
    [108]
  );
});

test('planMigration — IDEMPOTEN: larian kedua (input = hasil larian pertama) tidak hasilkan pendua/tindakan berlebihan', () => {
  const plan1 = planMigration(baseInput());

  // Bina semula existingRestrictions selepas larian pertama (secara manual, meniru DB
  // selepas runMigration() applies plan1): rekod baharu dicipta, rekod lama dikemaskini/nyahaktif/dipadam.
  let nextId = 200;
  const afterRun1 = [
    // Rekod yang bertahan (reclassified in-place, id sama)
    ...existingRestrictions
      .filter((r) => r.id !== 108) // LELAKI dipadam
      .map((r) => {
        const rc = plan1.reclassify.find((x) => x.id === r.id);
        const deact = plan1.deactivate.some((d) => d.id === r.id);
        return rc
          ? { ...r, restrictionType: rc.restrictionType, hariList: rc.hariList, masaDari: rc.masaDari, masaHingga: rc.masaHingga, teacherId: rc.teacherId, isActive: !deact }
          : r;
      }),
    // Rekod FULL_WEEK baharu
    ...plan1.createFullWeek.map((c) => ({ id: nextId++, target: c.nama, hariList: [], masaDari: null, masaHingga: null, restrictionType: 'FULL_WEEK', teacherId: c.teacherId, isActive: true })),
    // Rekod SPECIFIC_TIME baharu (bekas LELAKI)
    ...plan1.createSpecificTimeForLelaki.map((c) => ({ id: nextId++, target: c.nama, hariList: c.hariList, masaDari: c.masaDari, masaHingga: c.masaHingga, restrictionType: 'SPECIFIC_TIME', teacherId: c.teacherId, isActive: true })),
  ];

  const plan2 = planMigration(baseInput({ existingRestrictions: afterRun1 }));

  assert.deepEqual(plan2.createFullWeek, [], 'larian kedua tidak boleh cipta FULL_WEEK pendua');
  assert.deepEqual(plan2.createSpecificTimeForLelaki, [], 'larian kedua tidak boleh cipta SPECIFIC_TIME (LELAKI) pendua');
  assert.deepEqual(plan2.lelakiRowsToDelete, [], 'tiada lagi rekod LELAKI untuk dipadam pada larian kedua');
  assert.deepEqual(plan2.deactivate, [], 'tiada rekod tambahan untuk dinyahaktifkan pada larian kedua');
});
