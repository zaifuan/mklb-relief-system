// ════════════════════════════════════════════════════════════
//  telegramSettings.js — tetapan Telegram (DB-driven) atas SystemSetting.
//
//  Kunci (key/value JSON dalam system_settings):
//    telegram.autoSnapshot : boolean  (DEFAULT false — sekolah masih guna GAS)
//    telegram.snapshotTime : "HH:MM"  (DEFAULT "05:30", 24-jam)
//    telegram.realtime     : boolean  (DEFAULT false)
//
//  Tiada seed → ketiadaan kunci bermakna OFF (default selamat).
//  TIDAK hardcode 5:30 dalam logik penghantaran; semua baca dari sini.
// ════════════════════════════════════════════════════════════

import prisma from './prisma.js';

const KEYS = {
  autoSnapshot: 'telegram.autoSnapshot',
  snapshotTime: 'telegram.snapshotTime',
  realtime: 'telegram.realtime',
};

const DEFAULTS = {
  autoSnapshot: false,
  snapshotTime: '05:30',
  realtime: false,
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidSnapshotTime(s) {
  return TIME_RE.test(String(s || ''));
}

// "05:30" → 330 (minit mutlak)
export function snapshotMinit(s) {
  const m = TIME_RE.exec(String(s || ''));
  if (!m) return 5 * 60 + 30;
  return +m[1] * 60 + +m[2];
}

// "05:30" → "5:30 AM"  | "14:05" → "2:05 PM"
export function snapshotTimeLabel(s) {
  const m = TIME_RE.exec(String(s || ''));
  if (!m) return '5:30 AM';
  let h = +m[1];
  const mm = m[2];
  const ap = h < 12 ? 'AM' : 'PM';
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${mm} ${ap}`;
}

export async function getTelegramSettings() {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: Object.values(KEYS) } },
  });
  const map = {};
  for (const r of rows) map[r.key] = r.value;

  const autoSnapshot =
    typeof map[KEYS.autoSnapshot] === 'boolean' ? map[KEYS.autoSnapshot] : DEFAULTS.autoSnapshot;
  const realtime =
    typeof map[KEYS.realtime] === 'boolean' ? map[KEYS.realtime] : DEFAULTS.realtime;
  let snapshotTime =
    typeof map[KEYS.snapshotTime] === 'string' ? map[KEYS.snapshotTime] : DEFAULTS.snapshotTime;
  if (!isValidSnapshotTime(snapshotTime)) snapshotTime = DEFAULTS.snapshotTime;

  return { autoSnapshot, snapshotTime, realtime };
}

export async function setTelegramSettings(partial) {
  const updates = [];
  if (partial.autoSnapshot !== undefined) {
    updates.push({ key: KEYS.autoSnapshot, value: !!partial.autoSnapshot });
  }
  if (partial.realtime !== undefined) {
    updates.push({ key: KEYS.realtime, value: !!partial.realtime });
  }
  if (partial.snapshotTime !== undefined) {
    const t = String(partial.snapshotTime).trim();
    if (!isValidSnapshotTime(t)) {
      const e = new Error('Format masa tidak sah (perlu HH:MM 24-jam).');
      e.code = 'BAD_TIME';
      throw e;
    }
    updates.push({ key: KEYS.snapshotTime, value: t });
  }

  for (const u of updates) {
    await prisma.systemSetting.upsert({
      where: { key: u.key },
      update: { value: u.value },
      create: { key: u.key, value: u.value },
    });
  }
  return getTelegramSettings();
}
