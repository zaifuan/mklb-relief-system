// ════════════════════════════════════════════════════════════
//  Ujian Kemaskini 05 — Integriti jadual relief.
//  • Prisma mock berkeadaan melalui seam `globalThis.prisma`: transaksi dengan
//    ROLLBACK, kunci baris `SELECT … FOR UPDATE` (mutex per batch), Cascade,
//    unique tarikh (P2002).
//  • HTTP hujung ke hujung: Express + authenticate JWT + authorize SEBENAR.
//  • Pengesah invarian ditulis bebas daripada enjin.
//  Isu A: batch terkunci · Isu B: Jana Semula kekalkan manual · Isu C: tukar guru disahkan
// ════════════════════════════════════════════════════════════
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'ujian-k05';
const SLOTS = ['7.40-8.10', '8.10-8.40', '8.40-9.10', '9.10-9.40', '10.00-10.30', '10.30-11.00', '11.00-11.30', '11.30-12.00'];
const TARIKH = '2026-11-23';
const TD = new Date('2026-11-23T00:00:00Z');

// ── Prisma mock ──
let DB, idSeq, HOOK = {};
const clone = (x) => structuredClone(x);
const padan = (r, w = {}) =>
  Object.entries(w).every(([k, v]) => {
    if (k === 'absenceRecord') return true;
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.some((x) => (x instanceof Date ? +x === +r[k] : x === r[k]));
      if ('notIn' in v) return !v.notIn.some((x) => x === r[k]);
      return true;
    }
    if (v instanceof Date) return r[k] instanceof Date && +r[k] === +v;
    return r[k] === v;
  });
const T = (n) => ({
  findMany: async (a = {}) => {
    await HOOK[`${n}.findMany`]?.();
    let rows = DB[n].filter((r) => padan(r, a.where));
    if (n === 'specialRestriction') rows = rows.map((r) => ({ ...r, teacher: { nama: r.target } }));
    return clone(rows);
  },
  findUnique: async (a = {}) => {
    const r = DB[n].find((x) => padan(x, a.where));
    if (!r) return null;
    const o = clone(r);
    if (n === 'reliefBatch' && a.include?.assignments) o.assignments = clone(DB.reliefAssignment.filter((x) => x.batchId === r.id));
    if (n === 'reliefAssignment' && a.include?.batch) o.batch = clone(DB.reliefBatch.find((b) => b.id === r.batchId));
    if (n === 'user') return { ...o, role: { nama: o.roleNama }, adminAssignment: null };
    await HOOK[`${n}.findUnique.after`]?.(o);
    return o;
  },
  create: async ({ data }) => {
    if (n === 'reliefBatch' && DB.reliefBatch.some((b) => +b.tarikh === +data.tarikh)) {
      const e = new Error('Unique constraint'); e.code = 'P2002'; throw e;
    }
    const r = { id: ++idSeq, createdAt: new Date(), updatedAt: new Date(), ...data };
    DB[n].push(r);
    return clone(r);
  },
  createMany: async ({ data }) => {
    if (HOOK['createMany.gagal']) throw new Error('DB ujian: createMany gagal');
    for (const d of data) DB[n].push({ id: ++idSeq, diubahManual: false, createdAt: new Date(), updatedAt: new Date(), ...d });
    return { count: data.length };
  },
  update: async ({ where, data }) => {
    const r = DB[n].find((x) => padan(x, where));
    Object.assign(r, data, { updatedAt: new Date() });
    return clone(r);
  },
  updateMany: async ({ where, data }) => {
    const rs = DB[n].filter((x) => padan(x, where));
    rs.forEach((r) => Object.assign(r, data, { updatedAt: new Date() }));
    return { count: rs.length };
  },
  deleteMany: async ({ where }) => {
    const buang = DB[n].filter((x) => padan(x, where));
    DB[n] = DB[n].filter((x) => !buang.includes(x));
    if (n === 'reliefBatch') DB.reliefAssignment = DB.reliefAssignment.filter((a) => !buang.some((b) => b.id === a.batchId)); // onDelete: Cascade
    return { count: buang.length };
  },
  count: async (a = {}) => DB[n].filter((r) => padan(r, a.where)).length,
});
// Kunci baris: mutex per id batch; dilepaskan apabila transaksi tamat.
const kunci = new Map();
async function ambilKunci(id) {
  while (kunci.has(id)) await kunci.get(id).p;
  let lepas; const p = new Promise((r) => (lepas = r));
  kunci.set(id, { p, lepas });
  return () => { kunci.delete(id); lepas(); };
}
const asas = new Proxy({}, { get: (_, k) => (k === '$transaction' ? tx : T(k)) });
async function tx(cb) {
  const lepasSemua = [];
  const t = new Proxy({}, {
    get: (_, k) => (k === '$queryRaw'
      ? async (_s, id) => { lepasSemua.push(await ambilKunci(id)); return [{ id }]; }
      : T(k)),
  });
  const snap = clone({ b: DB.reliefBatch, a: DB.reliefAssignment, s: idSeq });
  try { return await cb(t); }
  catch (e) { DB.reliefBatch = snap.b; DB.reliefAssignment = snap.a; throw e; }
  finally { lepasSemua.forEach((f) => f()); }
}
globalThis.prisma = asas;
const prismaAsal = asas;

// ── Senario ──
// guru: { nama: [indeks slot mengajar] }
function bina({ guru, absen = [], sekatan = [], swaps = [], settings = {}, batch = null }) {
  idSeq = 1000;
  const jadual = [];
  for (const [nama, ajar] of Object.entries(guru))
    SLOTS.forEach((m, i) => jadual.push({ hari: 'ISNIN', guru: nama, kelas: ajar.includes(i) ? `${nama.slice(-2)}K${i}` : 'FREE', masa: m, subjek: 'S' }));
  DB = {
    teacherSchedule: jadual,
    absenceRecord: absen.map((a, i) => ({ id: i + 1, guruNama: a.nama, tarikh: TD, statusBorang: 'AKTIF', deletedAt: null, jenis: a.jenis || 'SEPANJANG_HARI', masaMula: a.masaMula || null, masaTamat: null, perluGanti: true })),
    teacher: Object.keys(guru).map((n, i) => ({ id: i + 1, nama: n, kategori: 'BIASA' })),
    reliefExclusion: [], specialRestriction: sekatan, dailySpecialSetting: [], classSwap: swaps,
    systemSetting: Object.entries({ relief_had_default: 1, threshold_pass2: 10, tier2_max_slot_mengajar: 2, ...settings }).map(([key, value]) => ({ key, value })),
    reliefBatch: [], reliefAssignment: [], auditLog: [],
    user: [{ id: 1, username: 'admin1', isActive: true, roleNama: 'ADMIN' }, { id: 2, username: 'admin2', isActive: true, roleNama: 'SUPER_ADMIN' }, { id: 3, username: 'guru1', isActive: true, roleNama: 'GURU' }],
  };
}


const { signToken } = await import('../lib/jwt.js');
const express = (await import('express')).default;
const app = express();
app.use(express.json());
app.use('/api/relief/assignment', (await import('../routes/reliefAssignment.routes.js')).default);
app.use('/api/relief', (await import('../routes/relief.routes.js')).default);
const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const BASE = `http://127.0.0.1:${srv.address().port}`;
after(() => srv.close());
const logAsal = console.log;
console.log = (...a) => { if (!String(a[0]).startsWith('[reliefPdf]')) logAsal(...a); };

async function http(method, path, body, user = 1) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken({ sub: user })}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const jana = (mod = false) => http('POST', '/api/relief/generate', { tarikh: TARIKH, modReliefKecemasan: mod });
const tukar = (id, guruGanti, extra = {}, user = 1) => http('PATCH', `/api/relief/assignment/${id}/teacher`, { guruGanti, ...extra }, user);
const baris = () => DB.reliefAssignment;
const row = (pref) => DB.reliefAssignment.find((a) => a.kelas.startsWith(pref));
const absen = (nama, perluGanti = true) => DB.absenceRecord.push({ id: 900 + DB.absenceRecord.length, guruNama: nama, tarikh: TD, statusBorang: 'AKTIF', deletedAt: null, jenis: 'SEPANJANG_HARI', masaMula: null, masaTamat: null, perluGanti });

const minit = (t) => { const [h, m] = t.split('.').map(Number); return h * 60 + m; };
const julat = (masa) => masa.split('-').map(minit);
function invarian(max = 2) {
  const err = [];
  const ajar = {}; for (const r of DB.teacherSchedule) if (r.kelas !== 'FREE') (ajar[r.guru] ||= []).push(julat(r.masa));
  const absenSet = new Set(DB.absenceRecord.filter((a) => a.statusBorang === 'AKTIF').map((a) => a.guruNama));
  const rel = {};
  for (const a of baris()) if (a.status !== 'BATAL' && a.guruGanti && a.guruGanti !== 'TIADA_PENGGANTI') (rel[a.guruGanti] ||= []).push(julat(a.masa));
  const ov = (a, b) => a[0] < b[1] && b[0] < a[1]; const dr = (a, b) => a[0] === b[1] || a[1] === b[0];
  for (const [g, rs] of Object.entries(rel)) {
    if (rs.length > max) err.push(`${g}:${rs.length}relief`);
    if (absenSet.has(g)) err.push(`${g}:absen`);
    for (const r of rs) for (const a of ajar[g] || []) { if (ov(r, a)) err.push(`${g}:mengajar`); if (dr(r, a)) err.push(`${g}:berderet-ajar`); }
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { if (ov(rs[i], rs[j])) err.push(`${g}:bertindih`); if (dr(rs[i], rs[j])) err.push(`${g}:berderet`); }
  }
  const k = baris().map((a) => `${a.guruTakHadir}|${a.kelas}|${a.masa}`);
  if (new Set(k).size !== k.length) err.push('slot-pendua');
  return err;
}
const GURU = { 'GURU AB': [0, 2, 4, 6], 'GURU CD': [0, 2, 4, 6], X0: [], Y1: [7], Z3: [1, 3, 7], W5: [0, 1, 2, 3, 5], T7: [0, 1, 2, 3, 5, 6, 7] };
const asasSenario = (extra = {}) => bina({ guru: GURU, absen: [{ nama: 'GURU AB' }], ...extra });

// ═══ A. Batch terkunci ═══
for (const st of ['DIHANTAR', 'SELESAI']) {
  test(`A — batch ${st}: semua absen dibatalkan / jana semula / tukar guru / sahkan → 409; batch & tugasan kekal`, async () => {
    asasSenario();
    await jana();
    DB.reliefBatch[0].status = st;
    const n0 = baris().length;
    DB.absenceRecord.forEach((a) => (a.statusBorang = 'DIBATALKAN'));
    assert.equal((await jana()).status, 409);
    assert.equal(DB.reliefBatch.length, 1);
    assert.equal(baris().length, n0);
    DB.absenceRecord.forEach((a) => (a.statusBorang = 'AKTIF'));
    assert.equal((await jana(true)).status, 409);
    assert.equal((await tukar(baris()[0].id, 'X0')).status, 409);
    assert.equal((await http('PATCH', `/api/relief/assignment/${baris()[1].id}/confirm`)).status, 409);
    assert.equal((await http('PATCH', `/api/relief/${TARIKH}/confirm-all`)).status, 409);
    assert.equal(baris().length, n0);
  });
}
test('A — perlumbaan: batch dikunci SELEPAS enjin membaca, SEBELUM dikosongkan → 409, batch kekal', async () => {
  asasSenario();
  await jana();
  DB.absenceRecord.forEach((a) => (a.statusBorang = 'DIBATALKAN'));
  let sekali = true;
  HOOK['reliefBatch.findUnique.after'] = () => { if (sekali) { sekali = false; DB.reliefBatch[0].status = 'DIHANTAR'; } };
  const r = await jana();
  HOOK = {};
  assert.equal(r.status, 409);
  assert.equal(DB.reliefBatch.length, 1);
  assert.equal(baris().length, 4);
});

// ═══ B. Jana Semula ═══
test('B — tiada manual: jana semula sama seperti jana pertama; tiada tugasan dikekalkan', async () => {
  asasSenario();
  const r1 = await jana();
  const a = baris().map((x) => [x.kelas, x.guruGanti]);
  const r2 = await jana();
  assert.deepEqual(baris().map((x) => [x.kelas, x.guruGanti]), a);
  assert.equal(r2.body.kekal.dikekalkan, 0);
  assert.deepEqual(r1.body.ringkasan, r2.body.ringkasan);
});
test('B — satu manual: id, guru, kelas, masa, status dikekalkan; ditanda diubahManual', async () => {
  asasSenario();
  await jana();
  const s = row('ABK2');
  const t = await tukar(s.id, 'X0', { guruGantiSemasa: s.guruGanti });
  assert.equal(t.status, 200);
  const r = await jana();
  const s2 = DB.reliefAssignment.find((a) => a.kelas === 'ABK2');
  assert.equal(s2.id, s.id);
  assert.equal(s2.guruGanti, 'X0');
  assert.equal(s2.masa, s.masa);
  assert.equal(s2.status, 'CADANGAN');
  assert.equal(s2.diubahManual, true);
  assert.equal(r.body.kekal.dikekalkan, 1);
  assert.deepEqual(invarian(), []);
});
test('B — beberapa manual: dikekalkan & beban dikira (PASS 1 tidak memberi relief lain kepada guru manual)', async () => {
  asasSenario();
  await jana();
  assert.equal((await tukar(row('ABK0').id, 'Y1')).status, 200);
  assert.equal((await tukar(row('ABK4').id, 'X0')).status, 200);
  await jana();
  assert.equal(row('ABK0').guruGanti, 'Y1');
  assert.equal(row('ABK4').guruGanti, 'X0');
  assert.equal(baris().filter((a) => a.guruGanti === 'X0').length, 1);
  assert.deepEqual(invarian(), []);
});
test('B — DISAHKAN dikekalkan; BATAL dikekalkan dan slotnya TIDAK diisi semula', async () => {
  asasSenario();
  await jana();
  const d = row('ABK0'), c = row('ABK2');
  assert.equal((await http('PATCH', `/api/relief/assignment/${d.id}/confirm`)).status, 200);
  assert.equal((await http('PATCH', `/api/relief/assignment/${c.id}/cancel`)).status, 200);
  await jana();
  assert.equal(DB.reliefAssignment.find((a) => a.id === d.id).status, 'DISAHKAN');
  const c2 = baris().filter((a) => a.kelas === 'ABK2');
  assert.equal(c2.length, 1);
  assert.equal(c2[0].id, c.id);
  assert.equal(c2[0].status, 'BATAL');
});
test('B — guru tambahan tidak hadir selepas jana: slot baharu dijana, manual kekal, invarian', async () => {
  asasSenario();
  await jana();
  await tukar(row('ABK4').id, 'Y1');
  absen('GURU CD');
  await jana();
  assert.equal(row('ABK4').guruGanti, 'Y1');
  assert.ok(baris().some((a) => a.kelas.startsWith('CDK')));
  assert.deepEqual(invarian(), []);
});
test('B — guru pilihan manual kemudian tidak hadir: DIKEKALKAN + konflik (respons & GET), ringkasan.konflik > 0', async () => {
  asasSenario();
  await jana();
  await tukar(row('ABK2').id, 'Y1');
  absen('Y1', false);
  const r = await jana();
  assert.equal(row('ABK2').guruGanti, 'Y1');
  assert.deepEqual(r.body.kekal.konflik.map((k) => k.sebab), ['TIDAK_HADIR']);
  const g = await http('GET', `/api/relief/${TARIKH}`);
  const a = g.body.assignments.find((x) => x.kelas === 'ABK2');
  assert.equal(a.konflik.sebab, 'TIDAK_HADIR');
  assert.equal(a.diubahManual, true);
  assert.equal(g.body.ringkasan.konflik, 1);
  // Audit merekod konflik
  assert.equal(DB.auditLog.filter((x) => x.action === 'RELIEF_GENERATE').at(-1).detail.konflik.length, 1);
});
test('B — slot tidak lagi diperlukan: tugasan manual dibuang DAN dilaporkan (respons + audit)', async () => {
  asasSenario();
  await jana();
  await tukar(row('ABK6').id, 'X0');
  DB.absenceRecord[0].statusBorang = 'DIBATALKAN';
  absen('GURU CD');
  const r = await jana();
  assert.ok(!row('ABK'));
  assert.deepEqual(r.body.kekal.tidakDiperlukan.map((t) => [t.kelas, t.guruGanti, t.diubahManual, t.sebab]), [['ABK6', 'X0', true, 'SLOT_TIDAK_DIPERLUKAN']]);
  assert.equal(DB.auditLog.filter((x) => x.action === 'RELIEF_GENERATE').at(-1).detail.tidakDiperlukan.length, 1);
});
test('B — semua absen dibatalkan: batch dikosongkan; tugasan manual dilaporkan', async () => {
  asasSenario();
  await jana();
  await tukar(row('ABK6').id, 'X0');
  DB.absenceRecord.forEach((a) => (a.statusBorang = 'DIBATALKAN'));
  const r = await jana();
  assert.equal(r.status, 200);
  assert.equal(DB.reliefBatch.length, 0);
  assert.equal(r.body.kekal.tidakDiperlukan.length, 1);
  assert.equal(DB.auditLog.filter((x) => x.action === 'RELIEF_CLEAR_EMPTY').at(-1).detail.tugasanKekalDibuang.length, 1);
});
test('B — PENDUA tugasan terlindung bagi slot sama: TIDAK dipadam; dilaporkan sebagai konflik', async () => {
  asasSenario();
  await jana();
  const s = row('ABK2');
  await tukar(s.id, 'X0');
  // data rosak: baris manual kedua bagi slot sama
  DB.reliefAssignment.push({ ...structuredClone(s), id: 5000, guruGanti: 'TIADA_PENGGANTI', diubahManual: true });
  const r = await jana();
  const kekal = baris().filter((a) => a.kelas === 'ABK2');
  assert.deepEqual(kekal.map((a) => a.id).sort(), [s.id, 5000]);
  assert.deepEqual(r.body.kekal.konflik.map((k) => [k.id, k.sebab]), [[5000, 'PENDUA']]);
  const g = await http('GET', `/api/relief/${TARIKH}`);
  assert.equal(g.body.assignments.find((a) => a.id === 5000).konflik.sebab, 'PENDUA');
  assert.ok(g.body.ringkasan.konflik >= 1);
});
test('B — dua tugasan terlindung guru sama bertindih: kedua-dua DIKEKALKAN & berkonflik (tiada pemadaman senyap)', async () => {
  bina({ guru: { 'GURU AB': [2], 'GURU CD': [2], X0: [], Y0: [] }, absen: [{ nama: 'GURU AB' }, { nama: 'GURU CD' }] });
  await jana();
  const [p, q] = baris();
  DB.reliefAssignment.find((a) => a.id === p.id).guruGanti = 'X0';
  DB.reliefAssignment.find((a) => a.id === p.id).diubahManual = true;
  DB.reliefAssignment.find((a) => a.id === q.id).guruGanti = 'X0';
  DB.reliefAssignment.find((a) => a.id === q.id).status = 'DISAHKAN';
  const r = await jana();
  assert.equal(baris().length, 2);
  assert.deepEqual(r.body.kekal.konflik.map((k) => k.sebab).sort(), ['BERTINDIH', 'BERTINDIH']);
});
for (const mod of [false, true]) {
  test(`B — Mod ${mod ? 'Kecemasan' : 'Normal'} dengan manual (kekurangan calon): manual kekal; ≤2 relief; tiada bertindih/berderet`, async () => {
    bina({ guru: { 'GURU AB': [0, 1, 2, 3, 4, 5, 6, 7], 'GURU CD': [0, 2, 4, 6], X0: [], Y1: [7], Z3: [1, 3, 7] }, absen: [{ nama: 'GURU AB' }, { nama: 'GURU CD' }] });
    await jana(mod);
    // pilih guru yang SAH daripada senarai calon backend (bukan guru semasa); jika tiada → TIADA_PENGGANTI
    const g0 = await http('GET', `/api/relief/${TARIKH}`);
    const a3 = g0.body.assignments.find((x) => x.kelas === 'ABK3');
    const pilih = a3.candidates.map((c) => c.nama).find((n) => n !== a3.guruGanti) || 'TIADA_PENGGANTI';
    assert.equal((await tukar(a3.id, pilih)).status, 200);
    const r = await jana(mod);
    assert.equal(row('ABK3').guruGanti, pilih);
    assert.equal(row('ABK3').diubahManual, true);
    assert.deepEqual(invarian(2), []);
    assert.equal(r.body.modReliefKecemasan, mod);
  });
}

// ═══ C. Tukar guru manual ═══
test('C — pengesahan backend: lapang 200; mengajar/absen/sekatan/pertukaran/tiada jadual → 422 + sebab; TIADA_PENGGANTI 200', async () => {
  asasSenario({ sekatan: [{ id: 1, target: 'Z3', restrictionType: 'SPECIFIC_DAYS', hariList: ['ISNIN'], isActive: true }], swaps: [{ tarikh: TD, guruAsal: 'GURU CD', kelas: 'CDK0', masa: '7.40-8.10', guruGanti: 'Y1' }] });
  absen('GURU CD', false);
  await jana();
  const s2 = row('ABK2');
  for (const [g, sebab] of [['W5', 'SEDANG_MENGAJAR'], ['GURU CD', 'TIDAK_HADIR'], ['Z3', 'SEKATAN_KHAS'], ['Y1', 'PERTUKARAN'], ['GURU HANTU', 'TIADA_JADUAL']]) {
    const r = await tukar(s2.id, g);
    assert.equal(r.status, 422, g);
    assert.equal(r.body.sebab, sebab, g);
    assert.ok(r.body.mesej.length > 10);
  }
  assert.equal(row('ABK2').diubahManual, false); // penolakan tidak menanda/mengubah baris
  assert.equal((await tukar(row('ABK4').id, 'X0')).status, 200);
  const t = await tukar(row('ABK0').id, 'TIADA_PENGGANTI');
  assert.equal(t.status, 200);
  assert.equal(row('ABK0').diubahManual, true); // TIADA_PENGGANTI = pelarasan manual
});
test('C — berderet / had 2 relief / bertindih → 422; isTier2 dikira semula', async () => {
  bina({ guru: { 'GURU AB': [0, 1, 2, 3, 4, 5, 6, 7], X0: [], Q: [0, 1, 2, 3, 4, 5, 6, 7] }, absen: [{ nama: 'GURU AB' }] });
  await jana();
  const sl = (i) => DB.reliefAssignment.find((a) => a.kelas === `ABK${i}`);
  assert.equal((await tukar(sl(0).id, 'X0')).status, 200);
  const k2 = await tukar(sl(2).id, 'X0');
  assert.equal(k2.status, 200);
  assert.equal(k2.body.isTier2, true);
  assert.equal((await tukar(sl(1).id, 'X0')).body.sebab, 'BERDERET');
  assert.equal((await tukar(sl(5).id, 'X0')).body.sebab, 'HAD_RELIEF');
  bina({ guru: { 'GURU AB': [2], 'GURU CD': [2], X0: [] }, absen: [{ nama: 'GURU AB' }, { nama: 'GURU CD' }] });
  await jana();
  await tukar(baris()[0].id, 'X0');
  const r = await tukar(baris()[1].id, 'X0');
  assert.equal(r.status, 422);
  assert.equal(r.body.sebab, 'BERTINDIH');
});
test('C — baris BATAL → 409; akses: GURU 403; SUPER_ADMIN dibenarkan', async () => {
  bina({ guru: { 'GURU AB': [2], X0: [], Y0: [] }, absen: [{ nama: 'GURU AB' }] });
  await jana();
  const id = baris()[0].id;
  assert.equal((await tukar(id, 'Y0', {}, 3)).status, 403);
  assert.equal((await tukar(id, 'Y0', {}, 2)).status, 200);
  await http('PATCH', `/api/relief/assignment/${id}/cancel`);
  assert.equal((await tukar(id, 'X0')).status, 409);
});
test('C — dua admin serentak: guru sama pada masa sama → satu 200, satu 422; tiada pertindihan', async () => {
  bina({ guru: { 'GURU AB': [2], 'GURU CD': [2], X0: [], Y0: [] }, absen: [{ nama: 'GURU AB' }, { nama: 'GURU CD' }] });
  await jana();
  const [q1, q2] = baris();
  const [h1, h2] = await Promise.all([tukar(q1.id, 'X0', {}, 1), tukar(q2.id, 'X0', {}, 2)]);
  assert.deepEqual([h1.status, h2.status].sort(), [200, 422]);
  assert.equal(baris().filter((a) => a.guruGanti === 'X0').length, 1);
});
test('C — dua admin serentak pada baris sama (guruGantiSemasa) → yang kedua 409, tidak ditimpa senyap', async () => {
  bina({ guru: { 'GURU AB': [2], X0: [], Y0: [], Z0: [] }, absen: [{ nama: 'GURU AB' }] });
  await jana();
  const r1 = baris()[0];
  const semasa = r1.guruGanti;
  const [e1, e2] = await Promise.all([tukar(r1.id, 'Y0', { guruGantiSemasa: semasa }, 1), tukar(r1.id, 'Z0', { guruGantiSemasa: semasa }, 2)]);
  assert.deepEqual([e1.status, e2.status].sort(), [200, 409]);
  const kalah = e1.status === 409 ? e1 : e2;
  assert.equal(kalah.body.berubah, true);
  assert.equal(baris()[0].guruGanti, e1.status === 200 ? 'Y0' : 'Z0');
});
test('Serentak — tukar manual berlaku SEMASA enjin membaca → jana 409, perubahan manual TIDAK hilang, tiada perubahan separa', async () => {
  asasSenario();
  await jana();
  const tgt = row('ABK2');
  const sebelum = structuredClone(baris().filter((a) => a.id !== tgt.id));
  let sekali = true;
  HOOK['absenceRecord.findMany'] = async () => { if (sekali) { sekali = false; await tukar(tgt.id, 'X0'); } };
  const r = await jana();
  HOOK = {};
  assert.equal(r.status, 409);
  assert.equal(r.body.berubah, true);
  assert.equal(DB.reliefAssignment.find((a) => a.id === tgt.id).guruGanti, 'X0');
  assert.deepEqual(baris().filter((a) => a.id !== tgt.id).map((a) => [a.id, a.guruGanti]), sebelum.map((a) => [a.id, a.guruGanti]));
});
test('Rollback — ralat di tengah simpanan: jadual lama kekal utuh (tiada pemadaman separa)', async () => {
  asasSenario();
  await jana();
  await tukar(row('ABK2').id, 'X0');
  absen('GURU CD');
  const sebelum = structuredClone(baris());
  const asal = prismaAsal.reliefAssignment.createMany;
  HOOK['createMany.gagal'] = true;
  const r = await jana();
  HOOK = {};
  assert.equal(r.status, 500);
  assert.deepEqual(baris().map((a) => [a.id, a.guruGanti]), sebelum.map((a) => [a.id, a.guruGanti]));
  void asal;
});

// ═══ K05 v2 — Statistik: TIADA_PENGGANTI & BATAL bukan "terisi"; respons jana = GET ═══
const ringkasGet = async () => {
  const g = await http('GET', `/api/relief/${TARIKH}`);
  const { konflik, ...r } = g.body.ringkasan;
  return r;
};
const SEMUA_LAPANG = { 'GURU AB': [0, 2, 4], P0: [], Q0: [], R0: [] };
test('Statistik — semua kelas ada guru ganti: terisi = slot; respons jana = GET', async () => {
  bina({ guru: SEMUA_LAPANG, absen: [{ nama: 'GURU AB' }] });
  const r = await jana();
  assert.deepEqual(r.body.ringkasan, { slot: 3, terisi: 3, kosong: 0, tier2: 0 });
  assert.deepEqual(await ringkasGet(), r.body.ringkasan);
});
test('Statistik — sebahagian TIADA_PENGGANTI (contoh audit: 3 slot → terisi 2, kosong 1); kekal selepas jana semula; tidak diisi semula', async () => {
  bina({ guru: SEMUA_LAPANG, absen: [{ nama: 'GURU AB' }] });
  await jana();
  const s = row('ABK4');
  assert.equal((await tukar(s.id, 'TIADA_PENGGANTI')).status, 200);
  assert.deepEqual(await ringkasGet(), { slot: 3, terisi: 2, kosong: 1, tier2: 0 });
  const r = await jana(); // calon lapang masih ada (R0) — enjin TIDAK boleh mengisi semula
  assert.deepEqual(r.body.ringkasan, { slot: 3, terisi: 2, kosong: 1, tier2: 0 });
  assert.deepEqual(await ringkasGet(), r.body.ringkasan);
  const s2 = DB.reliefAssignment.find((a) => a.kelas === 'ABK4');
  assert.equal(s2.id, s.id);
  assert.equal(s2.guruGanti, 'TIADA_PENGGANTI'); // nilai DB tidak ditukar kepada null
  assert.equal(s2.diubahManual, true);
});
test('Statistik — semua kelas TIADA_PENGGANTI: terisi 0, kosong = slot; kekal selepas jana semula', async () => {
  bina({ guru: SEMUA_LAPANG, absen: [{ nama: 'GURU AB' }] });
  await jana();
  for (const a of [...baris()]) assert.equal((await tukar(a.id, 'TIADA_PENGGANTI')).status, 200);
  assert.deepEqual(await ringkasGet(), { slot: 3, terisi: 0, kosong: 3, tier2: 0 });
  const r = await jana();
  assert.deepEqual(r.body.ringkasan, { slot: 3, terisi: 0, kosong: 3, tier2: 0 });
  assert.deepEqual(await ringkasGet(), r.body.ringkasan);
  assert.ok(baris().every((a) => a.guruGanti === 'TIADA_PENGGANTI'));
});
test('Statistik — BATAL dan TIADA_PENGGANTI serentak: kedua-duanya bukan terisi; semantik dikekalkan', async () => {
  bina({ guru: { 'GURU AB': [0, 2, 4, 6], P0: [], Q0: [], R0: [], S0: [] }, absen: [{ nama: 'GURU AB' }] });
  await jana();
  const b = row('ABK0'); // ada guru ganti → kemudian BATAL
  assert.ok(b.guruGanti && b.guruGanti !== 'TIADA_PENGGANTI');
  assert.equal((await http('PATCH', `/api/relief/assignment/${b.id}/cancel`)).status, 200);
  assert.equal((await tukar(row('ABK2').id, 'TIADA_PENGGANTI')).status, 200);
  assert.deepEqual(await ringkasGet(), { slot: 4, terisi: 2, kosong: 2, tier2: 0 });
  const r = await jana();
  assert.deepEqual(r.body.ringkasan, { slot: 4, terisi: 2, kosong: 2, tier2: 0 });
  assert.deepEqual(await ringkasGet(), r.body.ringkasan);
  const b2 = DB.reliefAssignment.find((a) => a.id === b.id);
  assert.equal(b2.status, 'BATAL');
  assert.equal(b2.guruGanti, b.guruGanti); // nilai asal BATAL tidak diubah
  assert.equal(baris().filter((a) => a.kelas === 'ABK0').length, 1); // slot BATAL tidak dijana semula
  assert.equal(row('ABK2').guruGanti, 'TIADA_PENGGANTI');
});
for (const mod of [false, true]) {
  test(`Statistik — Mod ${mod ? 'Kecemasan' : 'Normal'} (kekurangan calon, relief kedua, TIADA_PENGGANTI): respons jana = GET`, async () => {
    bina({ guru: { 'GURU AB': [0, 1, 2, 3, 4, 5, 6, 7], 'GURU CD': [0, 2, 4, 6], X0: [], Y1: [7], Z3: [1, 3, 7] }, absen: [{ nama: 'GURU AB' }, { nama: 'GURU CD' }] });
    const r1 = await jana(mod);
    assert.deepEqual(await ringkasGet(), r1.body.ringkasan);
    const terisiRow = baris().find((a) => a.guruGanti && a.guruGanti !== 'TIADA_PENGGANTI');
    assert.equal((await tukar(terisiRow.id, 'TIADA_PENGGANTI')).status, 200);
    const r2 = await jana(mod);
    assert.deepEqual(await ringkasGet(), r2.body.ringkasan);
    const sebenar = baris().filter((a) => a.status !== 'BATAL' && a.guruGanti && a.guruGanti !== 'TIADA_PENGGANTI').length;
    assert.equal(r2.body.ringkasan.terisi, sebenar);
    assert.equal(r2.body.ringkasan.slot, baris().length);
    assert.equal(r2.body.ringkasan.kosong, baris().length - sebenar);
  });
}
test('Statistik — kiraRingkasan: unit (null, TIADA_PENGGANTI, BATAL, tier2)', async () => {
  const { kiraRingkasan } = await import('../services/relief.service.js');
  const rows = [
    { guruGanti: 'USTAZ AHMAD', status: 'CADANGAN', isTier2: false },
    { guruGanti: 'USTAZ ALI', status: 'DISAHKAN', isTier2: true },
    { guruGanti: 'TIADA_PENGGANTI', status: 'CADANGAN', isTier2: false },
    { guruGanti: null, status: 'CADANGAN', isTier2: false },
    { guruGanti: 'USTAZ BAKAR', status: 'BATAL', isTier2: true },
  ];
  assert.deepEqual(kiraRingkasan(rows.slice(0, 3)), { slot: 3, terisi: 2, kosong: 1, tier2: 1 }); // contoh audit
  assert.deepEqual(kiraRingkasan(rows), { slot: 5, terisi: 2, kosong: 3, tier2: 1 });
  assert.deepEqual(kiraRingkasan([]), { slot: 0, terisi: 0, kosong: 0, tier2: 0 });
});
