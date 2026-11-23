// ════════════════════════════════════════════════════════════
//  Ujian Kemaskini 03 — Mod Relief Kecemasan (janaJadualGanti + API).
//  Menggunakan seam `globalThis.prisma` (lib/prisma.js) dengan Prisma mock
//  dalam memori — tiada pangkalan data sebenar disentuh.
//
//  Grid realistik 8 slot sehari, rehat 9.40–10.00. Pengesah invarian
//  (sahkan) ditulis BEBAS daripada kod enjin.
// ════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SLOTS = ['7.40-8.10', '8.10-8.40', '8.40-9.10', '9.10-9.40', '10.00-10.30', '10.30-11.00', '11.00-11.30', '11.30-12.00'];
const TARIKH = '2026-11-23'; // Isnin
const HARI = 'ISNIN';
const NOTA_K = 'Relief kedua (2x) — Mod Kecemasan';

// ── Prisma mock ──
let DB = {};
let AUDIT = [];
let BATCH = null;
const tbl = (name) => ({
  findMany: async (args = {}) => {
    let rows = DB[name] || [];
    if (name === 'teacherSchedule' && args.where?.hari) rows = rows.filter((r) => r.hari === args.where.hari);
    if (name === 'systemSetting' && args.where?.key?.in) rows = rows.filter((r) => args.where.key.in.includes(r.key));
    return rows.map((r) => ({ ...r }));
  },
  findUnique: async () => (name === 'reliefBatch' ? BATCH : null),
  deleteMany: async () => ({ count: 0 }),
  create: async ({ data }) => {
    if (name === 'auditLog') AUDIT.push(data);
    if (name === 'reliefBatch') BATCH = { id: 1, ...data };
    return { id: 1, ...data };
  },
  createMany: async ({ data }) => ({ count: data.length }),
  update: async ({ data }) => ({ id: 1, ...BATCH, ...data }),
});
const mock = new Proxy({}, { get: (_, k) => (k === '$transaction' ? (cb) => cb(mock) : tbl(k)) });
globalThis.prisma = mock;

const { janaJadualGanti } = await import('../services/relief.service.js');
const { generateRelief } = await import('../controllers/relief.controller.js');
const { authorize } = await import('../middleware/authorize.js');

// ── Pembina senario ──
// guru: [{ nama, ajar: [indeks slot] }]   absen: [{ nama, jenis?, masaMula? }]
function db({ guru, absen, settings = {}, sekatan = [], exclusions = [], special = [], swaps = [], kelas = {} }) {
  const jadual = [];
  for (const g of guru) {
    SLOTS.forEach((m, i) => {
      const k = g.ajar.includes(i) ? kelas[`${g.nama}|${i}`] || `${g.nama.slice(-3)}-${i}` : 'FREE';
      jadual.push({ hari: HARI, guru: g.nama, kelas: k, masa: m, subjek: k === 'FREE' ? '' : 'SUBJ' });
    });
  }
  return {
    teacherSchedule: jadual,
    absenceRecord: absen.map((a, i) => ({ id: i + 1, guruNama: a.nama, jenis: a.jenis || 'SEPANJANG_HARI', masaMula: a.masaMula || null, masaTamat: a.masaTamat || null, perluGanti: true, statusBorang: 'AKTIF' })),
    teacher: guru.map((g) => ({ nama: g.nama, kategori: 'BIASA' })),
    reliefExclusion: exclusions,
    specialRestriction: sekatan,
    systemSetting: Object.entries({ relief_had_default: 1, threshold_pass2: 10, tier2_max_slot_mengajar: 2, ...settings }).map(([key, value]) => ({ key, value })),
    dailySpecialSetting: special,
    classSwap: swaps,
  };
}
async function jana(d, opt = {}) {
  DB = d;
  BATCH = opt.batch ?? null;
  return janaJadualGanti({ tarikh: TARIKH, ...opt });
}
const minit = (t) => { const [h, m] = t.split('.').map(Number); return h * 60 + m; };
const julat = (masa) => masa.split('-').map(minit);
const bertindih = (a, b) => a[0] < b[1] && b[0] < a[1];
const berderet = (a, b) => a[0] === b[1] || a[1] === b[0];

// Pengesah bebas: had relief, tiada bertindih/berderet, tiada relief ketika absen/mengajar.
function sahkan(d, hasil, max = 2) {
  const err = [];
  const ajar = {};
  for (const r of d.teacherSchedule) if (r.kelas !== 'FREE') (ajar[r.guru] ||= []).push(julat(r.masa));
  const absen = {};
  for (const a of d.absenceRecord) {
    const j = a.jenis === 'SEPARUH_HARI' ? [minit(a.masaMula), a.masaTamat ? minit(a.masaTamat) : 1440] : [0, 1440];
    (absen[a.guruNama] ||= []).push(j);
  }
  const rel = {};
  for (const h of hasil) if (h.guruGanti) (rel[h.guruGanti] ||= []).push(julat(h.masa));
  for (const [g, rs] of Object.entries(rel)) {
    if (rs.length > max) err.push(`${g} ${rs.length} relief`);
    for (const r of rs) {
      for (const a of absen[g] || []) if (bertindih(r, a)) err.push(`${g} relief semasa absen`);
      for (const a of ajar[g] || []) {
        if (bertindih(r, a)) err.push(`${g} bertindih mengajar`);
        if (berderet(r, a)) err.push(`${g} berderet mengajar`);
      }
    }
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) {
        if (bertindih(rs[i], rs[j])) err.push(`${g} dua relief bertindih`);
        if (berderet(rs[i], rs[j])) err.push(`${g} dua relief berderet`);
      }
  }
  return { err, rel };
}
const kiraan = (hasil) => {
  const c = {};
  for (const h of hasil) if (h.guruGanti) c[h.guruGanti] = (c[h.guruGanti] || 0) + 1;
  return c;
};

// Senario kekurangan calon: N slot relief (guru absen mengajar), calon berbeza beban.
function senarioKurang(n) {
  const absen = [];
  const guru = [];
  let baki = n;
  let i = 0;
  while (baki > 0) {
    const ambil = Math.min(8, baki);
    const nama = `GURU ABSEN ${i++}`;
    guru.push({ nama, ajar: [...Array(ambil).keys()] });
    absen.push({ nama });
    baki -= ambil;
  }
  // Calon (4 orang, < 5 slot): 0–1 slot (beban ringan) dan 3/5 slot (beban sederhana) — tidak cukup untuk N slot.
  guru.push({ nama: 'CALON A0', ajar: [] });
  guru.push({ nama: 'CALON B1', ajar: [7] });
  guru.push({ nama: 'CALON D3', ajar: [5, 6, 7] });
  guru.push({ nama: 'CALON E5', ajar: [0, 1, 2, 6, 7] });
  return db({ guru, absen });
}

// ═══ A/B. Kekurangan calon 5 / 9 / 10 / 15 slot ═══
for (const n of [5, 9, 10, 15]) {
  test(`B — ${n} slot, calon tidak mencukupi: ON ≤2 relief, sah, isi ≥ OFF`, async () => {
    const d = senarioKurang(n);
    const off = await jana(d);
    const on = await jana(d, { modReliefKecemasan: true });
    assert.equal(on.hasil.length, n);
    assert.equal(off.hasil.length, n);
    assert.deepEqual(sahkan(d, off.hasil).err, []);
    const { err } = sahkan(d, on.hasil, 2);
    assert.deepEqual(err, []);
    assert.ok(on.ringkasan.terisi >= off.ringkasan.terisi);
    assert.equal(on.ringkasan.tier2, on.hasil.filter((h) => h.isTier2).length);
    for (const h of on.hasil) assert.equal(h.auditNote, h.guruGanti ? (h.isTier2 ? NOTA_K : null) : 'Tiada calon sesuai');
    for (const h of off.hasil) assert.ok(!String(h.auditNote || '').includes('Kecemasan'));
    assert.equal(on.modReliefKecemasan, true);
    assert.equal(off.modReliefKecemasan, false);
  });
}

test('B — 5 slot (< ambang 10): OFF tiada PASS 2, ON isi slot kosong dengan relief kedua', async () => {
  const d = senarioKurang(5);
  const off = await jana(d);
  const on = await jana(d, { modReliefKecemasan: true });
  assert.equal(off.ringkasan.tier2, 0); // ambang 10 tidak dipenuhi → PASS 2 asal tidak berjalan
  assert.ok(on.ringkasan.tier2 > 0);
  assert.ok(on.ringkasan.terisi > off.ringkasan.terisi);
});

test('B — 10 slot: relief kedua dibuka kepada guru 3 slot mengajar (di luar had Tier 2 biasa = 2)', async () => {
  const d = senarioKurang(10);
  const off = await jana(d);
  const on = await jana(d, { modReliefKecemasan: true });
  assert.ok(!off.hasil.some((h) => h.isTier2 && h.guruGanti === 'CALON D3')); // OFF: tier2MaxSlotMengajar = 2
  assert.ok(on.hasil.some((h) => h.isTier2 && h.guruGanti === 'CALON D3')); // ON: tiada had slot mengajar
  // Relief kedua yang sama dengan OFF (A0, B1) kekal; D3 ditambah selepasnya.
  assert.ok(on.ringkasan.terisi > off.ringkasan.terisi);
});

test('B — relief kedua diberi ikut slot mengajar paling sedikit (0 → 1 → 2 → 3 …)', async () => {
  // Guru absen mengajar slot 0,2,4,6 (tidak berderet). Calon X0 (0 slot), Z1 (1 slot: 7) dan W5 (5 slot — bersebelahan
  // semua slot relief → tidak layak berderet). Pastikan relief kedua jatuh pada guru beban rendah dahulu.
  const d = db({
    guru: [
      { nama: 'ABSEN', ajar: [0, 2, 4, 6] },
      { nama: 'X0', ajar: [] },
      { nama: 'Z1', ajar: [7] },
      { nama: 'W5', ajar: [1, 3, 5, 7, 0] },
    ],
    absen: [{ nama: 'ABSEN' }],
  });
  const on = await jana(d, { modReliefKecemasan: true });
  assert.deepEqual(sahkan(d, on.hasil).err, []);
  const c = kiraan(on.hasil);
  // Relief pertama: X0 dan Z1 (slotMengajar ↑). Relief kedua: X0 (0) diutamakan sebelum Z1 (1).
  const tier2 = on.hasil.filter((h) => h.isTier2).map((h) => h.guruGanti);
  assert.ok(tier2.length >= 1);
  assert.equal(tier2[0], 'X0');
  assert.ok(Object.values(c).every((v) => v <= 2));
});

test('B — guru yang sudah ada 2 relief TIDAK menerima relief ketiga; baki slot kekal kosong', async () => {
  // Satu-satunya calon (X0, tiada kelas) — 4 slot relief tidak berderet.
  const d = db({ guru: [{ nama: 'ABSEN', ajar: [0, 2, 4, 6] }, { nama: 'X0', ajar: [] }], absen: [{ nama: 'ABSEN' }] });
  const on = await jana(d, { modReliefKecemasan: true });
  assert.equal(kiraan(on.hasil).X0, 2);
  assert.equal(on.ringkasan.kosong, 2);
  assert.equal(on.hasil.filter((h) => h.guruGanti === null).every((h) => h.auditNote === 'Tiada calon sesuai'), true);
});

test('B — masih ada guru tanpa relief yang layak → TIADA relief kedua diberikan', async () => {
  const d = db({
    guru: [{ nama: 'ABSEN', ajar: [0, 2, 4] }, { nama: 'P0', ajar: [] }, { nama: 'Q0', ajar: [] }, { nama: 'R0', ajar: [] }],
    absen: [{ nama: 'ABSEN' }],
  });
  const on = await jana(d, { modReliefKecemasan: true });
  assert.equal(on.ringkasan.terisi, 3);
  assert.equal(on.ringkasan.tier2, 0);
  assert.deepEqual(Object.values(kiraan(on.hasil)), [1, 1, 1]);
});

test('B — tiada guru lain layak: slot kekal kosong dalam kedua-dua mod', async () => {
  const d = db({ guru: [{ nama: 'ABSEN', ajar: [0, 1] }, { nama: 'PENUH', ajar: [2, 3, 4, 5, 6, 7] }], absen: [{ nama: 'ABSEN' }] });
  const on = await jana(d, { modReliefKecemasan: true });
  const off = await jana(d);
  // PENUH: slot 0/1 bersebelahan slot 2 (berderet) atau pada masa sama → tidak layak.
  assert.equal(on.ringkasan.terisi, off.ringkasan.terisi);
  assert.deepEqual(sahkan(d, on.hasil).err, []);
});

// ═══ C. Ujian masa ═══
test('C — guru 7/8 slot mengajar TIDAK dikecualikan secara automatik (had slot mengajar tiada)', async () => {
  // Waktu lapang yang benar-benar memenuhi syarat: slot relief 12.10–12.40 (selepas jurang 10 minit).
  const d = db({ guru: [{ nama: 'ABSEN', ajar: [] }, { nama: 'TUJUH', ajar: [0, 1, 2, 3, 4, 5, 6] }], absen: [{ nama: 'ABSEN' }] });
  d.teacherSchedule.push({ hari: HARI, guru: 'ABSEN', kelas: '5S', masa: '12.10-12.40', subjek: 'SUBJ' });
  for (const mod of [false, true]) {
    const r = await jana(d, { modReliefKecemasan: mod });
    assert.equal(r.hasil[0].guruGanti, 'TUJUH'); // slot 11.30-12.00 FREE; 12.10 tidak berderet dengan 11.00-11.30
    assert.deepEqual(sahkan(d, r.hasil).err, []);
  }
});

test('C — slot lapang yang berderet dengan mengajar ditolak; slot yang benar-benar lapang digunakan', async () => {
  // L: mengajar slot 1 sahaja. Relief slot 0 (berderet dengan slot 1) → tidak layak; slot 3 → layak.
  const d = db({ guru: [{ nama: 'ABSEN', ajar: [0, 3] }, { nama: 'L', ajar: [1] }], absen: [{ nama: 'ABSEN' }] });
  const on = await jana(d, { modReliefKecemasan: true });
  const bySlot = Object.fromEntries(on.hasil.map((h) => [h.masa, h.guruGanti]));
  assert.equal(bySlot['7.40-8.10'], null);
  assert.equal(bySlot['9.10-9.40'], 'L');
});

test('C — dua relief tidak berderet sesama sendiri walaupun guru lapang sepanjang hari', async () => {
  const d = db({ guru: [{ nama: 'ABSEN', ajar: [0, 1, 2] }, { nama: 'X0', ajar: [] }], absen: [{ nama: 'ABSEN' }] });
  const on = await jana(d, { modReliefKecemasan: true });
  // X0 boleh slot 0 & 2 (tidak berderet), tetapi bukan slot 1.
  assert.deepEqual(sahkan(d, on.hasil).err, []);
  assert.equal(kiraan(on.hasil).X0, 2);
  assert.equal(on.hasil.find((h) => h.masa === '8.10-8.40').guruGanti, null);
});

// ═══ D. Sekatan & ketidakhadiran ═══
function senarioPenuhCalon(extra = {}) {
  return db({
    guru: [
      { nama: 'ABSEN', ajar: [0, 2, 4, 6] },
      { nama: 'X0', ajar: [] },
      { nama: 'Y0', ajar: [] },
      { nama: 'SEPARUH', ajar: [] },
      { nama: 'LAIN ABSEN', ajar: [] },
    ],
    absen: [{ nama: 'ABSEN' }, { nama: 'LAIN ABSEN' }, { nama: 'SEPARUH', jenis: 'SEPARUH_HARI', masaMula: '10.00' }],
    ...extra,
  });
}
test('D — guru tidak hadir & separuh hari dipatuhi (ON)', async () => {
  const d = senarioPenuhCalon();
  const on = await jana(d, { modReliefKecemasan: true });
  assert.deepEqual(sahkan(d, on.hasil).err, []);
  assert.ok(!on.hasil.some((h) => h.guruGanti === 'LAIN ABSEN'));
  for (const h of on.hasil.filter((x) => x.guruGanti === 'SEPARUH')) assert.ok(julat(h.masa)[1] <= minit('10.00'));
});
test('D — sekatan khas, pengecualian guru (harian & Tetapan Khas) dipatuhi (ON)', async () => {
  const d = senarioPenuhCalon({
    sekatan: [{ target: 'X0', restrictionType: 'SPECIFIC_DAYS', hariList: [HARI], isActive: true }],
    exclusions: [{ guruNama: 'Y0', mod: 'SEPANJANG_HARI', masaDari: null, masaHingga: null }],
  });
  const on = await jana(d, { modReliefKecemasan: true });
  assert.ok(!on.hasil.some((h) => ['X0', 'Y0'].includes(h.guruGanti)));
  const d2 = senarioPenuhCalon({ special: [{ jenis: 'TEACHER_EXCLUSION', target: 'X0', scope: 'FULL_DAY' }] });
  const on2 = await jana(d2, { modReliefKecemasan: true });
  assert.ok(!on2.hasil.some((h) => h.guruGanti === 'X0'));
});
test('D — pengecualian kelas & pertukaran suka sama suka dipatuhi; kelas keutamaan diproses dahulu', async () => {
  const kelas = { 'ABSEN|0': '1A', 'ABSEN|2': '2B', 'ABSEN|4': '3K', 'ABSEN|6': '4D' };
  const d = senarioPenuhCalon({
    kelas,
    special: [
      { jenis: 'CLASS_EXCLUSION', target: '1A', scope: 'FULL_DAY' },
      { jenis: 'PRIORITY_CLASS', target: '4D', scope: 'FULL_DAY' },
    ],
    swaps: [{ guruAsal: 'ABSEN', kelas: '2B', masa: '8.40-9.10', guruGanti: 'Y0' }],
  });
  const on = await jana(d, { modReliefKecemasan: true });
  const kelasDijana = on.hasil.map((h) => h.kelas);
  assert.ok(!kelasDijana.includes('1A')); // CLASS_EXCLUSION
  assert.ok(!kelasDijana.includes('2B')); // slot pertukaran — bukan relief
  assert.equal(kelasDijana[0], '4D'); // PRIORITY_CLASS dahulu
  assert.ok(!on.hasil.some((h) => h.guruGanti === 'Y0')); // pengambil alih pertukaran tidak jadi calon
  assert.deepEqual(sahkan(d, on.hasil).err, []);
});

// ═══ E. Penjanaan semula (enjin tanpa keadaan; batch terkunci) ═══
test('E — Normal → Kecemasan → Normal: tanpa keadaan, tiada duplikasi slot', async () => {
  const d = senarioKurang(10);
  const a = await jana(d);
  const b = await jana(d, { modReliefKecemasan: true, batch: { id: 1, status: 'DIJANA', assignments: a.hasil } });
  const c = await jana(d, { batch: { id: 1, status: 'DIJANA', assignments: b.hasil } });
  assert.deepEqual(c.hasil, a.hasil);
  assert.deepEqual(c.ringkasan, a.ringkasan);
  const kunci = b.hasil.map((h) => `${h.guruTakHadir}|${h.kelas}|${h.masa}`);
  assert.equal(new Set(kunci).size, kunci.length);
  assert.ok(Object.values(kiraan(b.hasil)).every((v) => v <= 2));
});
for (const status of ['DIHANTAR', 'SELESAI']) {
  test(`E — batch ${status} kekal terkunci dalam kedua-dua mod`, async () => {
    const d = senarioKurang(5);
    for (const mod of [false, true]) {
      await assert.rejects(() => jana(d, { modReliefKecemasan: mod, batch: { id: 1, status, assignments: [] } }), (e) => e.code === 'LOCKED');
    }
  });
}

// ═══ F. API: pengesahan input + audit + akses ═══
function resMock() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
async function panggil(body) {
  DB = senarioKurang(5);
  BATCH = null;
  AUDIT = [];
  const res = resMock();
  await generateRelief({ body, user: { id: 7, username: 'admin1' }, headers: {}, socket: {} }, res);
  return res;
}
test('F — parameter tidak dihantar → Mod Normal', async () => {
  const r = await panggil({ tarikh: TARIKH });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.modReliefKecemasan, false);
  const a = AUDIT.find((x) => x.action === 'RELIEF_GENERATE');
  assert.equal(a.detail.modReliefKecemasan, false);
});
test('F — false → Normal; true → Kecemasan; audit lengkap', async () => {
  const f = await panggil({ tarikh: TARIKH, modReliefKecemasan: false });
  assert.equal(f.body.modReliefKecemasan, false);
  const t = await panggil({ tarikh: TARIKH, modReliefKecemasan: true });
  assert.equal(t.body.modReliefKecemasan, true);
  const a = AUDIT.find((x) => x.action === 'RELIEF_GENERATE');
  assert.equal(a.userId, 7);
  assert.equal(a.detail.tarikh, TARIKH);
  assert.equal(a.detail.dijanaOleh, 'admin1');
  assert.equal(a.detail.modReliefKecemasan, true);
  assert.equal(a.detail.slot, t.body.ringkasan.slot);
  assert.equal(a.detail.terisi, t.body.ringkasan.terisi);
  assert.equal(a.detail.kosong, t.body.ringkasan.kosong);
  assert.equal(a.detail.reliefKedua, t.body.ringkasan.tier2);
  assert.ok(t.body.ringkasan.terisi > f.body.ringkasan.terisi);
});
for (const bad of ['true', 1, 0, null, 'ON', {}]) {
  test(`F — input tidak sah ditolak (400): ${JSON.stringify(bad)}`, async () => {
    const r = await panggil({ tarikh: TARIKH, modReliefKecemasan: bad });
    assert.equal(r.statusCode, 400);
  });
}
test('F — akses: ADMIN & SUPER_ADMIN dibenarkan; peranan lain / tiada peranan ditolak', () => {
  const mw = authorize('SUPER_ADMIN', 'ADMIN');
  const cuba = (role) => {
    let lulus = false;
    const res = resMock();
    mw({ userRole: role }, res, () => (lulus = true));
    return lulus ? 'OK' : res.statusCode;
  };
  assert.equal(cuba('ADMIN'), 'OK');
  assert.equal(cuba('SUPER_ADMIN'), 'OK');
  assert.equal(cuba('GURU'), 403);
  assert.equal(cuba(undefined), 401);
});
