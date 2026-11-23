// ════════════════════════════════════════════════════════════
//  Ujian Kemaskini 04 — Mod Senyap Telegram.
//  • Prisma mock berkeadaan melalui seam `globalThis.prisma` (lib/prisma.js).
//  • fetch ke api.telegram.org di-stub & DIKIRA (bilangan mesej sebenar).
//  • Jam palsu (node:test mock.timers, Date sahaja) — Isnin 23/11/2026 KL.
//  • Laluan HTTP diuji hujung ke hujung melalui Express + router SEBENAR
//    (authenticate JWT + authorize sedia ada).
// ════════════════════════════════════════════════════════════

import { test, mock, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'ujian-k04-rahsia';
process.env.TELEGRAM_BOT_TOKEN = 'TOKEN-UJIAN';
process.env.TELEGRAM_CHAT_ID = 'CHAT-UJIAN';
process.env.CRON_SECRET = 'cron-ujian';

// ── Prisma mock berkeadaan ──
let DB;
const padan = (r, w = {}) =>
  Object.entries(w).every(([k, v]) => {
    if (k === 'OR') return v.some((x) => padan(r, x));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.some((x) => (x instanceof Date ? +x === +r[k] : x === r[k]));
      if ('startsWith' in v) return String(r[k] || '').startsWith(v.startsWith);
      if ('gte' in v || 'lte' in v) return (!v.gte || r[k] >= v.gte) && (!v.lte || r[k] <= v.lte);
      return true;
    }
    if (v instanceof Date) return r[k] instanceof Date && +r[k] === +v;
    return r[k] === v;
  });
let hookBina = null; // dicetus semasa buildSnapshot (ujian perubahan serentak)
// K04-S: suntikan kegagalan — GAGAL['jadual.op'] = bilangan kegagalan berikutnya (Infinity = sentiasa)
let GAGAL = {};
let CUBAAN = {};
const mungkinGagal = (n, op) => {
  const k = `${n}.${op}`;
  CUBAAN[k] = (CUBAAN[k] || 0) + 1;
  if (GAGAL[k] > 0) {
    GAGAL[k]--;
    throw new Error(`DB ujian: ${k} gagal`);
  }
};
const jadual = (n) => ({
  findMany: async (a = {}) => {
    if (n === 'absenceRecord' && hookBina) await hookBina();
    return DB[n].filter((r) => padan(r, a.where)).map((r) => ({ ...r }));
  },
  findFirst: async (a = {}) => DB[n].find((r) => padan(r, a.where)) || null,
  findUnique: async (a = {}) => {
    const r = DB[n].find((x) => padan(x, a.where)) || null;
    if (r && n === 'user') return { ...r, role: { nama: r.roleNama }, adminAssignment: null };
    return r;
  },
  count: async (a = {}) => DB[n].filter((r) => padan(r, a.where)).length,
  create: async ({ data }) => {
    mungkinGagal(n, 'create');
    const r = { id: DB[n].length + 1, createdAt: new Date(), deletedAt: null, ...data };
    DB[n].push(r);
    return { ...r };
  },
  createMany: async ({ data }) => ({ count: data.length }),
  update: async ({ where, data }) => {
    const r = DB[n].find((x) => padan(x, where));
    Object.assign(r, data);
    return { ...r };
  },
  updateMany: async ({ where, data }) => {
    const rs = DB[n].filter((x) => padan(x, where));
    rs.forEach((r) => Object.assign(r, data));
    return { count: rs.length };
  },
  upsert: async ({ where, update, create }) => {
    mungkinGagal(n, 'upsert');
    const r = DB[n].find((x) => padan(x, where));
    if (r) Object.assign(r, update);
    else DB[n].push({ id: DB[n].length + 1, ...create });
    return r || create;
  },
});
const prismaMock = new Proxy({}, { get: (_, k) => (k === '$transaction' ? (cb) => cb(prismaMock) : jadual(k)) });
globalThis.prisma = prismaMock;

const ISNIN = new Date('2026-11-23T00:00:00Z');
const SELASA = new Date('2026-11-24T00:00:00Z');
function reset(settings = {}) {
  DB = {
    systemSetting: Object.entries(settings).map(([key, value], i) => ({ id: i + 1, key, value })),
    telegramLog: [],
    auditLog: [],
    teacher: [{ id: 1, nama: 'USTAZAH A', isActive: true }, { id: 2, nama: 'USTAZ B', isActive: true }],
    classSwap: [],
    user: [
      { id: 1, username: 'ketua', isActive: true, roleNama: 'SUPER_ADMIN' },
      { id: 2, username: 'admin', isActive: true, roleNama: 'ADMIN' },
      { id: 3, username: 'guru', isActive: true, roleNama: 'GURU' },
    ],
    absenceRecord: [
      { id: 1, reference: 'R1', guruNama: 'USTAZ B', hari: 'ISNIN', tarikh: ISNIN, statusBorang: 'AKTIF', deletedAt: null, jenis: 'SEPANJANG_HARI', sebabKategori: 'MC', sebabDetail: null, groupReference: 'GRP-T', createdAt: new Date('2026-11-20T00:00:00Z') },
      { id: 2, reference: 'R2', guruNama: 'USTAZ B', hari: 'SELASA', tarikh: SELASA, statusBorang: 'AKTIF', deletedAt: null, jenis: 'SEPANJANG_HARI', sebabKategori: 'MC', sebabDetail: null, groupReference: 'GRP-T', createdAt: new Date('2026-11-20T00:00:00Z') },
    ],
  };
}

// ── fetch: Telegram di-stub & dikira; selain itu (HTTP ujian tempatan) fetch sebenar ──
const fetchAsli = globalThis.fetch;
let HANTAR = [];
globalThis.fetch = async (url, opt) => {
  if (String(url).startsWith('https://api.telegram.org')) {
    HANTAR.push(JSON.parse(opt.body).text);
    return { status: 200, json: async () => ({ ok: true, result: { message_id: HANTAR.length } }) };
  }
  return fetchAsli(url, opt);
};

const jam = (iso) => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: new Date(iso) });
};
const KL_0535 = '2026-11-22T21:35:00Z'; // Isnin 05:35 KL
const KL_1000 = '2026-11-23T02:00:00Z'; // Isnin 10:00 KL
const KL_1530 = '2026-11-23T07:30:00Z'; // Isnin 15:30 KL

const N = await import('../services/telegramNotify.service.js');
const S = await import('../lib/telegramSettings.js');
const { signToken } = await import('../lib/jwt.js');
const express = (await import('express')).default;
const telegramRoutes = (await import('../routes/telegram.routes.js')).default;
const telegramCronRoutes = (await import('../routes/telegramCron.routes.js')).default;
const absenceRoutes = (await import('../routes/absence.routes.js')).default;
const adminAbsenceRoutes = (await import('../routes/adminAbsence.routes.js')).default;

// App ujian — susunan mount sama seperti server.js
const app = express();
app.use(express.json());
app.use('/api/absence', absenceRoutes);
app.use('/api/admin/absence', adminAbsenceRoutes);
app.use('/api/telegram/cron', telegramCronRoutes);
app.use('/api/telegram', telegramRoutes);
let server, BASE;
before(async () => {
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  BASE = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  mock.timers.reset();
  server?.close();
});
beforeEach(() => {
  HANTAR = [];
  hookBina = null;
  GAGAL = {};
  CUBAAN = {};
});

const token = (id) => signToken({ sub: id });
async function http(method, path, { user, body, headers = {} } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (user) h.Authorization = `Bearer ${token(user)}`;
  const r = await globalThis.fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let b = null;
  try {
    b = await r.json();
  } catch {
    /* tiada badan */
  }
  return { status: r.status, body: b };
}
const nilaiSenyap = () => DB.systemSetting.find((r) => r.key === 'telegram_silent_mode')?.value;
const asal = () => JSON.stringify(DB.systemSetting.filter((r) => r.key.startsWith('telegram.')));
const SEMUA_ON = { 'telegram.autoSnapshot': true, 'telegram.realtime': true, 'telegram.snapshotTime': '05:30' };

// ═══ A. Status & konfigurasi ═══
test('A — default OFF (tiada kunci); nilai bukan boolean → OFF', async () => {
  reset();
  assert.equal(await S.isTelegramSilentMode(), false);
  reset({ telegram_silent_mode: 'true' });
  assert.equal(await S.isTelegramSilentMode(), false);
});
test('A — ON/OFF disimpan sebagai boolean kekal; "restart" (import semula modul) membaca nilai sama; tetapan asal tidak berubah', async () => {
  reset(SEMUA_ON);
  const sebelum = asal();
  await S.setTelegramSilentMode(true);
  assert.equal(nilaiSenyap(), true);
  const S2 = await import(`../lib/telegramSettings.js?restart=${Date.now()}`); // modul segar = proses baharu
  assert.equal(await S2.isTelegramSilentMode(), true);
  assert.equal(asal(), sebelum);
  await S.setTelegramSilentMode(false);
  assert.equal(nilaiSenyap(), false);
  assert.equal(await S2.isTelegramSilentMode(), false);
  assert.equal(asal(), sebelum);
  assert.deepEqual(await S.getTelegramSettings(), { autoSnapshot: true, snapshotTime: '05:30', realtime: true });
});

// ═══ B. Kawalan akses (HTTP, authenticate + authorize sebenar) ═══
test('B — PATCH /silent-mode: SUPER_ADMIN dibenarkan; ADMIN/GURU 403; tanpa token 401; token palsu 401', async () => {
  reset(SEMUA_ON);
  jam(KL_0535);
  let r = await http('PATCH', '/api/telegram/silent-mode', { user: 1, body: { silentMode: true } });
  assert.equal(r.status, 200);
  assert.equal(r.body.silentMode, true);
  r = await http('PATCH', '/api/telegram/silent-mode', { user: 1, body: { silentMode: false } });
  assert.equal(r.body.silentMode, false);
  for (const u of [2, 3]) {
    r = await http('PATCH', '/api/telegram/silent-mode', { user: u, body: { silentMode: true } });
    assert.equal(r.status, 403);
  }
  assert.equal((await http('PATCH', '/api/telegram/silent-mode', { body: { silentMode: true } })).status, 401);
  assert.equal((await http('PATCH', '/api/telegram/silent-mode', { body: { silentMode: true }, headers: { Authorization: 'Bearer palsu' } })).status, 401);
  assert.equal(nilaiSenyap(), false); // percubaan tanpa kebenaran tidak mengubah status
  // Audit hanya untuk perubahan sah (2 kali oleh SUPER_ADMIN)
  const a = DB.auditLog.filter((x) => x.action === 'TELEGRAM_SILENT_MODE_UPDATE');
  assert.equal(a.length, 2);
  assert.deepEqual(a.map((x) => [x.userId, x.detail.statusLama, x.detail.statusBaharu, x.detail.oleh]), [
    [1, false, true, 'ketua'],
    [1, true, false, 'ketua'],
  ]);
});
test('B — input tidak sah ditolak 400 (bukan boolean / medan lain)', async () => {
  reset();
  jam(KL_0535);
  for (const body of [{ silentMode: 'true' }, { silentMode: 1 }, { silentMode: null }, {}, { silentMode: true, realtime: false }]) {
    assert.equal((await http('PATCH', '/api/telegram/silent-mode', { user: 1, body })).status, 400);
  }
  assert.equal(nilaiSenyap(), undefined);
});
test('B — GET /silent-mode: SUPER_ADMIN & ADMIN boleh baca; GURU 403; tanpa token 401', async () => {
  reset({ telegram_silent_mode: true });
  jam(KL_0535);
  assert.equal((await http('GET', '/api/telegram/silent-mode', { user: 1 })).body.silentMode, true);
  assert.equal((await http('GET', '/api/telegram/silent-mode', { user: 2 })).body.silentMode, true);
  assert.equal((await http('GET', '/api/telegram/silent-mode', { user: 3 })).status, 403);
  assert.equal((await http('GET', '/api/telegram/silent-mode')).status, 401);
});

// ═══ C. Snapshot automatik ═══
test('C — Situasi A (auto ON, realtime ON, Senyap ON): 05:30 & 15:00 digugurkan, tiada mesej', async () => {
  reset({ ...SEMUA_ON, telegram_silent_mode: true });
  jam(KL_0535);
  assert.equal((await N.runMorningSnapshot()).reason, 'SENYAP');
  jam(KL_1530);
  assert.equal((await N.runEarlySnapshot()).reason, 'SENYAP');
  assert.equal(HANTAR.length, 0);
  assert.ok(DB.telegramLog.every((l) => l.status === 'SENYAP' && l.messageText === null && l.success === false));
});
test('C — Senyap OFF: snapshot ikut peraturan asal (auto ON → hantar; auto OFF → AUTO_OFF; hujung minggu langkau)', async () => {
  reset({ ...SEMUA_ON, telegram_silent_mode: false });
  jam(KL_0535);
  assert.equal((await N.runMorningSnapshot()).status, 'OK');
  assert.equal((await N.runMorningSnapshot()).reason, 'SUDAH_DIHANTAR');
  reset({ 'telegram.autoSnapshot': false });
  assert.equal((await N.runMorningSnapshot()).reason, 'AUTO_OFF');
  reset({ ...SEMUA_ON, telegram_silent_mode: true });
  jam('2026-11-20T21:35:00Z'); // Sabtu 05:35 KL
  assert.equal((await N.runMorningSnapshot()).reason, 'HUJUNG_MINGGU'); // peraturan asal dahulu — tiada penanda
  assert.equal(DB.telegramLog.length, 0);
});

// ═══ D. Notifikasi masa nyata (HTTP sebenar — operasi DB kekal berjaya) ═══
test('D — Senyap ON: permohonan baharu disimpan (201) tanpa Telegram', async () => {
  reset({ ...SEMUA_ON, telegram_silent_mode: true });
  jam(KL_1000);
  const r = await http('POST', '/api/absence', { body: { guruNama: 'USTAZAH A', tarikhMula: '2026-11-23', sebab: 'MC', jenis: 'SEPANJANG_HARI' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.success, true);
  assert.ok(DB.absenceRecord.some((x) => x.guruNama === 'USTAZAH A' && x.statusBorang === 'AKTIF'));
  assert.equal(HANTAR.length, 0);
  assert.ok(!DB.telegramLog.some((l) => String(l.status).startsWith('GAGAL')));
});
test('D — Senyap ON: pembatalan awam / admin / kumpulan berjaya tanpa Telegram', async () => {
  reset({ ...SEMUA_ON, telegram_silent_mode: true });
  jam(KL_1000);
  let r = await http('PATCH', '/api/absence/public/1/cancel', { body: { guruNama: 'USTAZ B' } });
  assert.equal(r.status, 200);
  assert.equal(DB.absenceRecord[0].statusBorang, 'DIBATALKAN');
  reset({ ...SEMUA_ON, telegram_silent_mode: true });
  r = await http('PATCH', '/api/admin/absence/1/status', { user: 2, body: { status: 'DIBATALKAN' } });
  assert.equal(r.status, 200);
  assert.equal(DB.absenceRecord[0].statusBorang, 'DIBATALKAN');
  reset({ ...SEMUA_ON, telegram_silent_mode: true });
  r = await http('PATCH', '/api/admin/absence/group/GRP-T/cancel', { user: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.body.dibatalkan, 2);
  assert.equal(HANTAR.length, 0);
});
test('D — Senyap OFF: permohonan & pembatalan menghantar ikut tetapan asal (realtime ON)', async () => {
  reset({ ...SEMUA_ON, telegram_silent_mode: false });
  jam(KL_1000);
  assert.equal((await http('POST', '/api/absence', { body: { guruNama: 'USTAZAH A', tarikhMula: '2026-11-23', sebab: 'MC', jenis: 'SEPANJANG_HARI' } })).status, 201);
  assert.equal(HANTAR.length, 1);
  assert.equal((await http('PATCH', '/api/absence/public/1/cancel', { body: { guruNama: 'USTAZ B' } })).status, 200);
  assert.equal(HANTAR.length, 2);
  assert.ok(HANTAR[1].includes('PEMBATALAN'));
});
test('D — Situasi B (realtime OFF, Senyap OFF): realtime kekal OFF; Situasi C (auto OFF, realtime ON): realtime berjalan', async () => {
  reset({ 'telegram.autoSnapshot': true, 'telegram.realtime': false, telegram_silent_mode: false });
  jam(KL_0535);
  assert.equal((await N.runMorningSnapshot()).status, 'OK');
  assert.equal((await N.sendRealtime(DB.absenceRecord[0])).reason, 'GATE');
  reset({ 'telegram.autoSnapshot': false, 'telegram.realtime': true, telegram_silent_mode: false });
  assert.equal((await N.runMorningSnapshot()).reason, 'AUTO_OFF');
  assert.equal((await N.sendRealtime(DB.absenceRecord[0])).ok, true);
});

// ═══ E. Manual & cron ═══
test('E — manual SUPER_ADMIN dihantar ketika ON dan OFF; ADMIN/GURU/tanpa token ditolak', async () => {
  for (const senyap of [true, false]) {
    reset({ ...SEMUA_ON, telegram_silent_mode: senyap });
    jam(KL_1000);
    HANTAR = [];
    const r = await http('POST', '/api/telegram/snapshot/send', { user: 1, body: { tarikh: '2026-11-23' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'OK');
    assert.equal(HANTAR.length, 1);
    assert.equal(DB.telegramLog.at(-1).jenis, 'MANUAL');
    assert.equal((await http('POST', '/api/telegram/snapshot/send', { user: 2, body: {} })).status, 403);
    assert.equal((await http('POST', '/api/telegram/snapshot/send', { user: 3, body: {} })).status, 403);
    assert.equal((await http('POST', '/api/telegram/snapshot/send', { body: {} })).status, 401);
    assert.equal(HANTAR.length, 1);
  }
});
test('E — cron (dengan & tanpa force) disekat ketika ON; parameter manual tidak boleh dihantar melaluinya', async () => {
  reset({ ...SEMUA_ON, telegram_silent_mode: true });
  jam(KL_0535);
  const h = { 'x-cron-secret': 'cron-ujian' };
  for (const [q, body] of [['', { manual: true }], ['?force=true', { force: true, manual: true }]]) {
    const r = await http('POST', `/api/telegram/cron/snapshot${q}`, { headers: h, body });
    assert.equal(r.status, 200);
    assert.equal(r.body.reason === 'SENYAP' || r.body.reason === 'DIGUGURKAN_SENYAP', true);
  }
  assert.equal(HANTAR.length, 0);
  assert.equal(DB.telegramLog.filter((l) => l.status === 'SENYAP').length, 1); // force tidak menulis penanda
  assert.equal((await http('POST', '/api/telegram/cron/snapshot', { headers: { 'x-cron-secret': 'salah' } })).status, 401);
});

// ═══ F. Keselamatan operasi ═══
test('F — tiada penghantaran semula selepas Senyap OFF + restart (catch-up); penanda tidak berganda', async () => {
  reset({ ...SEMUA_ON, telegram_silent_mode: true });
  jam(KL_0535);
  await N.runMorningSnapshot(); // digugurkan → penanda
  await N.runMorningSnapshot(); // dicetus semula (cron / tick) → tiada penanda kedua
  jam(KL_1530);
  await N.runEarlySnapshot();
  await N.runEarlySnapshot();
  assert.equal(DB.telegramLog.filter((l) => l.status === 'SENYAP').length, 2); // satu bagi setiap slot
  jam(KL_1000);
  await S.setTelegramSilentMode(false);
  const N2 = await import(`../services/telegramNotify.service.js?restart=${Date.now()}`); // proses baharu
  assert.equal((await N2.runMorningSnapshot()).reason, 'DIGUGURKAN_SENYAP');
  jam(KL_1530);
  assert.equal((await N2.runEarlySnapshot()).reason, 'DIGUGURKAN_SENYAP');
  assert.equal(HANTAR.length, 0);
  assert.equal(DB.telegramLog.filter((l) => l.status === 'SENYAP').length, 2);
  // Hari berikutnya (Selasa 05:35) berjalan seperti biasa
  jam('2026-11-23T21:35:00Z');
  assert.equal((await N2.runMorningSnapshot()).status, 'OK');
  assert.equal(HANTAR.length, 1);
});
test('F — perubahan serentak: Senyap ON berlaku selepas gerbang utama, sebelum fetch → disekat, tiada log GAGAL palsu', async () => {
  for (const fn of [() => N.runMorningSnapshot(), () => N.sendRealtime(DB.absenceRecord[0]), () => N.sendPembatalan(DB.absenceRecord[0])]) {
    reset(SEMUA_ON);
    jam(KL_0535);
    HANTAR = [];
    hookBina = () => S.setTelegramSilentMode(true);
    const r = await fn();
    hookBina = null;
    assert.equal(HANTAR.length, 0);
    assert.ok(r.reason === 'SENYAP' || r.reason === 'SILENT');
    assert.ok(!DB.telegramLog.some((l) => String(l.status).startsWith('GAGAL')));
  }
});
test('F — penghalang terakhir: pemanggil automatik tanpa { manual: true } disekat; { manual: true } dibenarkan', async () => {
  const { sendTelegramMessage } = await import('../lib/telegram.js');
  reset({ telegram_silent_mode: true });
  assert.deepEqual(await sendTelegramMessage('x'), { ok: false, skipped: true, error: 'SILENT_MODE' });
  assert.deepEqual(await sendTelegramMessage('x', { manual: 'true' }), { ok: false, skipped: true, error: 'SILENT_MODE' });
  assert.equal((await sendTelegramMessage('x', { manual: true })).ok, true);
  reset({ telegram_silent_mode: false });
  assert.equal((await sendTelegramMessage('x')).ok, true);
  assert.equal(HANTAR.length, 2);
});

// ═══ K04-S. Ketahanan operasi: kegagalan penanda SENYAP & audit log ═══
test('K04-S — penanda gagal sekali, berjaya cubaan kedua → SKIP biasa, 1 penanda, tiada amaran', async () => {
  reset({ ...SEMUA_ON, telegram_silent_mode: true });
  jam(KL_0535);
  GAGAL['telegramLog.create'] = 1;
  const r = await N.runMorningSnapshot();
  assert.deepEqual([r.status, r.reason], ['SKIP', 'SENYAP']);
  assert.equal(CUBAAN['telegramLog.create'], 2);
  assert.equal(DB.telegramLog.filter((l) => l.status === 'SENYAP').length, 1);
  assert.ok(!DB.auditLog.some((a) => a.action === 'TELEGRAM_SILENT_MARKER_FAIL'));
  assert.equal(HANTAR.length, 0);
});
test('K04-S — penanda gagal 2 kali → ERROR dilaporkan (bukan SKIP senyap), mesej TIDAK dihantar, audit amaran ditulis', async () => {
  reset({ ...SEMUA_ON, telegram_silent_mode: true });
  jam(KL_1530);
  GAGAL['telegramLog.create'] = 2;
  const r = await N.runEarlySnapshot();
  assert.equal(r.status, 'ERROR');
  assert.equal(r.reason, 'PENANDA_SENYAP_GAGAL');
  assert.equal(r.dihantar, false);
  assert.equal(HANTAR.length, 0);
  assert.equal(DB.telegramLog.length, 0);
  const a = DB.auditLog.find((x) => x.action === 'TELEGRAM_SILENT_MARKER_FAIL');
  assert.deepEqual(a.detail, { slot: 'AUTO_EARLY', tarikh: '2026-11-24' });
});
test('K04-S — selepas penanda gagal: Senyap OFF dalam proses sama → TIDAK dihantar; penanda dipulihkan; selepas restart kekal tidak dihantar', async () => {
  reset({ ...SEMUA_ON, telegram_silent_mode: true });
  jam(KL_0535);
  GAGAL['telegramLog.create'] = 2;
  assert.equal((await N.runMorningSnapshot()).reason, 'PENANDA_SENYAP_GAGAL');
  jam(KL_1000);
  await S.setTelegramSilentMode(false);
  // cron / cetusan semula dalam proses yang sama (DB pulih) → pengawal memori + pulih penanda
  const r = await N.runMorningSnapshot();
  assert.equal(r.reason, 'DIGUGURKAN_SENYAP');
  assert.equal(HANTAR.length, 0);
  assert.equal(DB.telegramLog.filter((l) => l.status === 'SENYAP').length, 1); // dipulihkan, sekali sahaja
  assert.equal((await N.runMorningSnapshot()).reason, 'DIGUGURKAN_SENYAP'); // kini dari DB
  assert.equal(DB.telegramLog.filter((l) => l.status === 'SENYAP').length, 1); // tiada pendua
  const N2 = await import(`../services/telegramNotify.service.js?restart-s=${Date.now()}`);
  assert.equal((await N2.runMorningSnapshot()).reason, 'DIGUGURKAN_SENYAP');
  assert.equal(HANTAR.length, 0);
});
test('K04-S — penanda masih gagal semasa pemulihan → kekal tidak dihantar', async () => {
  reset({ ...SEMUA_ON, telegram_silent_mode: true });
  jam(KL_0535);
  GAGAL['telegramLog.create'] = Infinity;
  GAGAL['auditLog.create'] = Infinity; // DB log turut gagal — fungsi tidak boleh melempar
  assert.equal((await N.runMorningSnapshot()).reason, 'PENANDA_SENYAP_GAGAL');
  await S.setTelegramSilentMode(false);
  assert.equal((await N.runMorningSnapshot()).reason, 'DIGUGURKAN_SENYAP');
  assert.equal((await N.runMorningSnapshot()).reason, 'DIGUGURKAN_SENYAP');
  assert.equal(HANTAR.length, 0);
});
test('K04-S — PATCH: audit gagal → 200 dengan status sebenar + auditGagal; status DB berubah', async () => {
  reset(SEMUA_ON);
  jam(KL_1000);
  GAGAL['auditLog.create'] = 1;
  const r = await http('PATCH', '/api/telegram/silent-mode', { user: 1, body: { silentMode: true } });
  assert.equal(r.status, 200);
  assert.equal(r.body.silentMode, true);
  assert.equal(r.body.auditGagal, true);
  assert.match(r.body.amaran, /audit log gagal/);
  assert.equal(nilaiSenyap(), true);
  assert.equal((await http('GET', '/api/telegram/silent-mode', { user: 1 })).body.silentMode, true);
  // Audit berjaya → tiada medan amaran
  const r2 = await http('PATCH', '/api/telegram/silent-mode', { user: 1, body: { silentMode: false } });
  assert.deepEqual(r2.body, { silentMode: false });
});
test('K04-S — PATCH: simpan gagal → 500, status DB tidak berubah, tiada audit', async () => {
  reset({ ...SEMUA_ON, telegram_silent_mode: false });
  jam(KL_1000);
  GAGAL['systemSetting.upsert'] = 1;
  const r = await http('PATCH', '/api/telegram/silent-mode', { user: 1, body: { silentMode: true } });
  assert.equal(r.status, 500);
  assert.equal(nilaiSenyap(), false);
  assert.ok(!DB.auditLog.some((a) => a.action === 'TELEGRAM_SILENT_MODE_UPDATE'));
});
test('K04-S — writeAudit pulangkan true/false dan tidak pernah melempar', async () => {
  const { writeAudit } = await import('../lib/audit.js');
  reset();
  assert.equal(await writeAudit({ action: 'X' }), true);
  GAGAL['auditLog.create'] = 1;
  assert.equal(await writeAudit({ action: 'X' }), false);
});
