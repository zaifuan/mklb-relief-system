// ════════════════════════════════════════════════════════════
//  telegramNotify.service.js — Telegram automatik (FASA 7/9)
//    • runMorningSnapshot()  → snapshot pagi auto (penuh, dedup harian)
//    • sendRealtime(rec)     → resend SNAPSHOT PENUH (seperti GAS)
//    • sendPembatalan(rec)   → resend SNAPSHOT PENUH + prefix ⚠️ PEMBATALAN
//
//  Tetapan DB (telegramSettings):
//    • autoSnapshot ON/OFF  • snapshotTime "HH:MM"  • realtime ON/OFF
//    • DEFAULT semua OFF — sekolah masih guna GAS minggu ini.
//
//  Gerbang realtime/pembatalan (ikut GAS, tapi guna masa tetapan):
//    realtime ON  DAN  tarikh rekod = hari ini (KL)  DAN  masa kini ≥ snapshotTime.
//  Kegagalan Telegram TIDAK boleh gagalkan borang/tindakan (try/catch caller).
// ════════════════════════════════════════════════════════════

import prisma from '../lib/prisma.js';
import { writeAudit } from '../lib/audit.js';
import { sendTelegramMessage, isTelegramConfigured } from '../lib/telegram.js';
import { buildSnapshot, tarikhKeUtcDate } from './snapshot.service.js';
import { getTelegramSettings, snapshotMinit, snapshotTimeLabel } from '../lib/telegramSettings.js';

// ── Bantuan masa/tarikh (zon Asia/Kuala_Lumpur) ──
function todayKLStr() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

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

// Map jenis log → trigger_type (ikut prompt #12)
const TRIGGER_MAP = {
  SNAPSHOT: 'AUTO',
  MANUAL: 'MANUAL',
  REALTIME: 'REALTIME',
  PEMBATALAN: 'PEMBATALAN',
  RELIEF_PDF: 'MANUAL',
};

// Rekod ke telegram_logs (jaya/gagal) — tidak melempar
async function logTelegram({ tarikhDate, jenis, text, hasil, totalRecords = null }) {
  try {
    await prisma.telegramLog.create({
      data: {
        tarikh: tarikhDate || null,
        jenis,
        triggerType: TRIGGER_MAP[jenis] || null,
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

// Gerbang realtime/pembatalan: realtime ON + tarikh hari ini + selepas snapshotTime
async function bolehHantarRealtime(rekodTarikhDate, settings) {
  if (!settings.realtime) return false;
  if (!(rekodTarikhDate instanceof Date)) return false;
  if (rekodTarikhStr(rekodTarikhDate) !== todayKLStr()) return false; // hanya hari ini
  if (sekarangMinitKL() < snapshotMinit(settings.snapshotTime)) return false; // selepas masa tetapan
  return true;
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

// ── SNAPSHOT PAGI AUTO ────────────────────────────────────
//  force=true → langkau semakan autoSnapshot + hujung minggu + dedup (ujian)
export async function runMorningSnapshot({ force = false } = {}) {
  const settings = await getTelegramSettings();
  const tarikh = todayKLStr();
  const tarikhDate = tarikhKeUtcDate(tarikh);

  // Hormati tetapan auto OFF (kecuali force untuk ujian)
  if (!force && !settings.autoSnapshot) {
    return { status: 'SKIP', reason: 'AUTO_OFF', tarikh };
  }

  // Langkau Sabtu/Ahad (ikut GAS), kecuali force
  const dow = tarikhDate.getUTCDay(); // 0=Ahad, 6=Sabtu
  if (!force && (dow === 0 || dow === 6)) {
    return { status: 'SKIP', reason: 'HUJUNG_MINGGU', tarikh };
  }

  // Dedup: jangan hantar dua kali dalam sehari
  if (!force) {
    const sudah = await prisma.telegramLog.findFirst({
      where: { jenis: 'SNAPSHOT', tarikh: tarikhDate, status: 'OK' },
    });
    if (sudah) return { status: 'SKIP', reason: 'SUDAH_DIHANTAR', tarikh };
  }

  const autoLabel = snapshotTimeLabel(settings.snapshotTime);
  const snap = await buildSnapshot({ tarikh, isAutoSnapshot: true, autoLabel });
  if (!snap.adaRekod) return { status: 'TIADA', tarikh, jumlahGuru: 0 };

  if (!isTelegramConfigured()) return { status: 'ERROR', reason: 'NO_CONFIG', tarikh };

  const hasil = await sendTelegramMessage(snap.text);
  await logTelegram({ tarikhDate, jenis: 'SNAPSHOT', text: snap.text, hasil, totalRecords: snap.jumlahGuru });

  if (!hasil.ok) {
    return { status: 'ERROR', tarikh, jumlahGuru: snap.jumlahGuru, error: hasil.error };
  }

  await writeAudit({
    userId: null,
    action: 'TELEGRAM_SNAPSHOT_AUTO',
    entity: 'telegram_snapshot',
    detail: { tarikh, jumlahGuru: snap.jumlahGuru, auto: true, masa: autoLabel },
    ip: null,
  });

  return { status: 'OK', tarikh, jumlahGuru: snap.jumlahGuru, messageId: hasil.messageId };
}
