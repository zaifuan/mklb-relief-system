// ════════════════════════════════════════════════════════════
//  telegramNotify.service.js — Telegram automatik (FASA 7/9/10)
//    • runMorningSnapshot() → snapshot AUTO_MORNING (sasaran HARI INI, 05:30)
//    • runEarlySnapshot()   → snapshot AUTO_EARLY  (sasaran ESOK, 15:00)
//    • sendRealtime(rec)     → resend SNAPSHOT PENUH (seperti GAS)
//    • sendPembatalan(rec)   → resend SNAPSHOT PENUH + prefix ⚠️ PEMBATALAN
//
//  Tetapan DB (telegramSettings):
//    • autoSnapshot ON/OFF (satu suis untuk KEDUA-DUA slot)  • realtime ON/OFF
//    • DEFAULT semua OFF. Masa snapshot di-HARDCODE (tiada setting baharu).
//
//  Window realtime/pembatalan: target T aktif (T-1) 15:00 → T 23:59 BERTERUSAN
//    (tiada jurang tengah malam; AUTO_MORNING bukan sempadan):
//    • rekod HARI INI → aktif sepanjang hari.
//    • rekod ESOK     → aktif dari 15:00 (hari sebelum).
//    Snapshot dihantar PENUH (bukan delta).
//  Kegagalan Telegram TIDAK boleh gagalkan borang/tindakan (try/catch caller).
// ════════════════════════════════════════════════════════════

import prisma from '../lib/prisma.js';
import { writeAudit } from '../lib/audit.js';
import { sendTelegramMessage, isTelegramConfigured } from '../lib/telegram.js';
import { buildSnapshot, tarikhKeUtcDate } from './snapshot.service.js';
import { getTelegramSettings } from '../lib/telegramSettings.js';

// ── Bantuan masa/tarikh (zon Asia/Kuala_Lumpur) ──
function todayKLStr() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// Minit-dalam-hari (0–1439) ikut jam Asia/Kuala_Lumpur
function sekarangMinitKL() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const h = +parts.find((p) => p.type === 'hour').value;
  const mi = +parts.find((p) => p.type === 'minute').value;
  return h * 60 + mi;
}

// Date (@db.Date, UTC-midnight) → "YYYY-MM-DD"
function rekodTarikhStr(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Esok (KL) "YYYY-MM-DD" — UTC-midnight aritmetik (selamat untuk tarikh-sahaja).
function esokKL() {
  const base = tarikhKeUtcDate(todayKLStr()); // UTC-midnight tarikh KL hari ini
  const next = new Date(base.getTime() + 86400000); // +1 hari
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, '0');
  const d = String(next.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Masa mula window realtime untuk target ESOK — HARDCODE (minit-dalam-hari, KL).
const EARLY_TIME_MIN = 15 * 60; // 15:00 (pada hari sebelum tarikh sasaran)

// Slot snapshot automatik → tarikh sasaran + label header "Kemaskini terakhir".
const AUTO_SLOTS = {
  AUTO_MORNING: { sasaran: 'HARI_INI', label: '5:30 AM' },
  AUTO_EARLY: { sasaran: 'ESOK', label: '3:00 PM' },
};

// Map jenis log → trigger_type (ikut prompt #12)
const TRIGGER_MAP = {
  SNAPSHOT: 'AUTO',
  MANUAL: 'MANUAL',
  REALTIME: 'REALTIME',
  PEMBATALAN: 'PEMBATALAN',
  RELIEF_PDF: 'MANUAL',
};

// Rekod ke telegram_logs (jaya/gagal) — tidak melempar
async function logTelegram({ tarikhDate, jenis, text, hasil, totalRecords = null, triggerType = null }) {
  try {
    await prisma.telegramLog.create({
      data: {
        tarikh: tarikhDate || null,
        jenis,
        triggerType: triggerType || TRIGGER_MAP[jenis] || null,
        totalRecords,
        messageText: text,
        telegramMessageId: hasil?.messageId || null,
        success: !!hasil?.ok,
        errorMessage: hasil?.ok ? null : hasil?.error || 'tidak diketahui',
        status: hasil?.ok ? 'OK' : `GAGAL: ${hasil?.error || 'tidak diketahui'}`,
      },
    });
  } catch (e) {
    console.error('logTelegram ERROR:', e.message);
  }
}

// Window realtime/pembatalan: target T aktif dari (T-1) 15:00 hingga T 23:59 —
// BERTERUSAN, tiada jurang tengah malam. AUTO_MORNING 05:30 BUKAN sempadan.
//   • rekod = HARI INI → aktif sepanjang hari (00:00–23:59).
//   • rekod = ESOK     → aktif dari 15:00 (hari sebelum) hingga 23:59.
//   • tarikh lain      → tiada realtime (tunggu ia masuk window sendiri).
// Realtime = SNAPSHOT PENUH (bukan delta).
async function bolehHantarRealtime(rekodTarikhDate, settings) {
  if (!settings.realtime) return false;
  if (!(rekodTarikhDate instanceof Date)) return false;
  const recStr = rekodTarikhStr(rekodTarikhDate);
  if (recStr === todayKLStr()) return true; // T = hari ini → sepanjang hari (window hingga 23:59)
  if (recStr === esokKL()) return sekarangMinitKL() >= EARLY_TIME_MIN; // T = esok → mula 15:00 hari sebelum
  return false; // H+2… atau tarikh lepas
}

// ── HANTAR REALTIME (selepas tambah/kemaskini rekod) — snapshot PENUH ──
export async function sendRealtime(rec, { ip = null } = {}) {
  try {
    const settings = await getTelegramSettings();
    if (!(await bolehHantarRealtime(rec.tarikh, settings))) return { skipped: true, reason: 'GATE' };
    if (!isTelegramConfigured()) return { skipped: true, reason: 'NO_CONFIG' };

    const tarikhStr = rekodTarikhStr(rec.tarikh);
    const snap = await buildSnapshot({ tarikh: tarikhStr }); // header manual "KEMASKINI…"
    if (!snap.adaRekod) return { skipped: true, reason: 'TIADA' };

    const hasil = await sendTelegramMessage(snap.text);
    await logTelegram({ tarikhDate: rec.tarikh, jenis: 'REALTIME', text: snap.text, hasil, totalRecords: snap.jumlahGuru });

    if (hasil.ok) {
      await writeAudit({
        userId: null,
        action: 'TELEGRAM_REALTIME_SEND',
        entity: 'telegram_realtime',
        detail: { tarikh: tarikhStr, jumlahGuru: snap.jumlahGuru, dicetus: rec.reference || null },
        ip,
      });
    }
    return { ok: hasil.ok, error: hasil.error };
  } catch (e) {
    console.error('sendRealtime ERROR:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── HANTAR PEMBATALAN (status → DIBATALKAN) — snapshot PENUH + ⚠️ ──
//  Panggil SELEPAS rekod ditandakan DIBATALKAN supaya snapshot tidak lagi
//  memaparkan rekod tersebut (sama gaya GAS).
export async function sendPembatalan(rec, { userId = null, ip = null } = {}) {
  try {
    const settings = await getTelegramSettings();
    if (!(await bolehHantarRealtime(rec.tarikh, settings))) return { skipped: true, reason: 'GATE' };
    if (!isTelegramConfigured()) return { skipped: true, reason: 'NO_CONFIG' };

    const tarikhStr = rekodTarikhStr(rec.tarikh);
    const snap = await buildSnapshot({ tarikh: tarikhStr, pembatalan: true });

    const hasil = await sendTelegramMessage(snap.text);
    await logTelegram({ tarikhDate: rec.tarikh, jenis: 'PEMBATALAN', text: snap.text, hasil, totalRecords: snap.jumlahGuru });

    if (hasil.ok) {
      await writeAudit({
        userId,
        action: 'TELEGRAM_PEMBATALAN_SEND',
        entity: 'telegram_pembatalan',
        detail: { tarikh: tarikhStr, jumlahGuru: snap.jumlahGuru, dicetus: rec.reference || null },
        ip,
      });
    }
    return { ok: hasil.ok, error: hasil.error };
  } catch (e) {
    console.error('sendPembatalan ERROR:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── SNAPSHOT AUTOMATIK (umum: pagi/awal) ──────────────────
//  Satu enjin untuk kedua-dua slot. Slot tentukan tarikh sasaran + label:
//    • AUTO_MORNING → sasaran HARI INI   (05:30)
//    • AUTO_EARLY   → sasaran ESOK       (15:00 — makluman sehari sebelum)
//  Dedup PER (jenis SNAPSHOT, triggerType slot, tarikh sasaran) → AUTO_EARLY &
//  AUTO_MORNING untuk tarikh sasaran SAMA kedua-duanya boleh dihantar.
//  Hujung minggu diuji pada TARIKH SASARAN.
//  force=true → langkau autoSnapshot + hujung minggu + dedup (ujian).
async function runAutoSnapshot(slotName, { force = false } = {}) {
  const slot = AUTO_SLOTS[slotName];
  const settings = await getTelegramSettings();
  const tarikh = slot.sasaran === 'ESOK' ? esokKL() : todayKLStr();
  const tarikhDate = tarikhKeUtcDate(tarikh);

  // Hormati tetapan auto OFF (kecuali force untuk ujian)
  if (!force && !settings.autoSnapshot) {
    return { status: 'SKIP', reason: 'AUTO_OFF', slot: slotName, tarikh };
  }

  // Langkau Sabtu/Ahad pada TARIKH SASARAN, kecuali force
  const dow = tarikhDate.getUTCDay(); // 0=Ahad, 6=Sabtu
  if (!force && (dow === 0 || dow === 6)) {
    return { status: 'SKIP', reason: 'HUJUNG_MINGGU', slot: slotName, tarikh };
  }

  // Dedup PER (slot, tarikh sasaran) — AUTO_EARLY & AUTO_MORNING berasingan
  if (!force) {
    const sudah = await prisma.telegramLog.findFirst({
      where: { jenis: 'SNAPSHOT', triggerType: slotName, tarikh: tarikhDate, status: 'OK' },
    });
    if (sudah) return { status: 'SKIP', reason: 'SUDAH_DIHANTAR', slot: slotName, tarikh };
  }

  const snap = await buildSnapshot({ tarikh, isAutoSnapshot: true, autoLabel: slot.label });
  if (!snap.adaRekod) return { status: 'TIADA', slot: slotName, tarikh, jumlahGuru: 0 };

  if (!isTelegramConfigured()) return { status: 'ERROR', reason: 'NO_CONFIG', slot: slotName, tarikh };

  const hasil = await sendTelegramMessage(snap.text);
  await logTelegram({ tarikhDate, jenis: 'SNAPSHOT', triggerType: slotName, text: snap.text, hasil, totalRecords: snap.jumlahGuru });

  if (!hasil.ok) {
    return { status: 'ERROR', slot: slotName, tarikh, jumlahGuru: snap.jumlahGuru, error: hasil.error };
  }

  await writeAudit({
    userId: null,
    action: 'TELEGRAM_SNAPSHOT_AUTO',
    entity: 'telegram_snapshot',
    detail: { slot: slotName, tarikh, jumlahGuru: snap.jumlahGuru, auto: true, masa: slot.label },
    ip: null,
  });

  return { status: 'OK', slot: slotName, tarikh, jumlahGuru: snap.jumlahGuru, messageId: hasil.messageId };
}

// Pembungkus serasi-belakang (kekalkan API untuk cron + scheduler).
export async function runMorningSnapshot({ force = false } = {}) {
  return runAutoSnapshot('AUTO_MORNING', { force });
}

// Snapshot AWAL — sasaran ESOK (makluman sehari sebelum).
export async function runEarlySnapshot({ force = false } = {}) {
  return runAutoSnapshot('AUTO_EARLY', { force });
}
