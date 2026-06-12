// ════════════════════════════════════════════════════════════
//  telegramNotify.service.js — Telegram automatik (Fasa 9)
//    • runMorningSnapshot()  → snapshot pagi 5:30 (penuh, dedup harian)
//    • sendRealtime(rec)     → "KETIDAKHADIRAN BAHARU" (satu rekod)
//    • sendPembatalan(rec)   → "PEMBATALAN KETIDAKHADIRAN" (satu rekod)
//
//  Reka bentuk (keputusan Fasa 9):
//    • Hibrid: pagi = snapshot PENUH (buildSnapshot F8, isAutoSnapshot);
//      realtime & pembatalan = mesej SATU REKOD (format baharu).
//    • Syarat cetus realtime/pembatalan (ikut GAS):
//        tarikh rekod = hari ini (KL)  DAN  masa semasa ≥ 5:30 pagi.
//    • MC/CRK/CTR → tanpa detail; PROGRAM_*/LAIN_LAIN → sertakan sebabDetail.
//    • Dedup pagi: telegram_logs { jenis:SNAPSHOT, tarikh, status:OK }.
//    • Tidak mengubah F8 — hanya guna semula buildSnapshot + sendTelegramMessage.
//    • Kegagalan Telegram TIDAK boleh gagalkan borang/tindakan (try/catch di caller).
// ════════════════════════════════════════════════════════════

import prisma from '../lib/prisma.js';
import { writeAudit } from '../lib/audit.js';
import { sendTelegramMessage, isTelegramConfigured } from '../lib/telegram.js';
import { buildSnapshot, masaSekarangKL, tarikhKeUtcDate } from './snapshot.service.js';
import { SEBAB_LABEL } from '../lib/absenceConstants.js';

const MC_KATEGORI = ['MC', 'CRK', 'CTR'];
const SNAP_MINIT = 5 * 60 + 30; // 5:30 pagi = 330 minit

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

// Date (@db.Date) → "10/6/2026" (tanpa sifar awalan)
function tarikhDisplay(d) {
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
}

// Syarat cetus realtime/pembatalan (ikut GAS shouldTriggerRealtimeUpdate)
function bolehHantarRealtime(rekodTarikhDate) {
  if (!(rekodTarikhDate instanceof Date)) return false;
  if (rekodTarikhStr(rekodTarikhDate) !== todayKLStr()) return false; // hanya hari ini
  if (sekarangMinitKL() < SNAP_MINIT) return false; // hanya selepas 5:30 pagi
  return true;
}

// Rekod ke telegram_logs (jaya/gagal) — tidak melempar
async function logTelegram({ tarikhDate, jenis, text, hasil }) {
  try {
    await prisma.telegramLog.create({
      data: {
        tarikh: tarikhDate || null,
        jenis,
        messageText: text,
        telegramMessageId: hasil?.messageId || null,
        status: hasil?.ok ? 'OK' : `GAGAL: ${hasil?.error || 'tidak diketahui'}`,
      },
    });
  } catch (e) {
    console.error('logTelegram ERROR:', e.message);
  }
}

// ── BINA MESEJ SATU REKOD ─────────────────────────────────
export function buildRealtimeMessage(rec) {
  const nama = String(rec.guruNama || '').trim();
  const kat = String(rec.sebabKategori || '').trim().toUpperCase();
  const detail = String(rec.sebabDetail || '').trim();
  const katLabel = SEBAB_LABEL[kat] || kat;

  let msg = 'KETIDAKHADIRAN BAHARU\n\n';
  msg += nama + '\n\n';
  msg += 'Tarikh:\n' + tarikhDisplay(rec.tarikh) + '\n\n';
  msg += 'Kategori:\n' + katLabel;
  if (!MC_KATEGORI.includes(kat) && detail) msg += '\n' + detail;
  msg += '\n\nMasa:\n' + masaSekarangKL();
  return msg;
}

export function buildPembatalanMessage(rec) {
  const nama = String(rec.guruNama || '').trim();
  const kat = String(rec.sebabKategori || '').trim().toUpperCase();
  const detail = String(rec.sebabDetail || '').trim();
  const katLabel = SEBAB_LABEL[kat] || kat;

  let msg = 'PEMBATALAN KETIDAKHADIRAN\n\n';
  msg += 'Nama:\n' + nama + '\n\n';
  msg += 'Tarikh:\n' + tarikhDisplay(rec.tarikh) + '\n\n';
  msg += 'Kategori:\n' + katLabel;
  if (!MC_KATEGORI.includes(kat) && detail) msg += '\n' + detail;
  msg += '\n\nMasa:\n' + masaSekarangKL();
  return msg;
}

// ── HANTAR REALTIME (selepas submit borang) ───────────────
export async function sendRealtime(rec, { ip = null } = {}) {
  try {
    if (!bolehHantarRealtime(rec.tarikh)) return { skipped: true, reason: 'GATE' };
    if (!isTelegramConfigured()) return { skipped: true, reason: 'NO_CONFIG' };

    const text = buildRealtimeMessage(rec);
    const hasil = await sendTelegramMessage(text);
    await logTelegram({ tarikhDate: rec.tarikh, jenis: 'REALTIME', text, hasil });

    if (hasil.ok) {
      await writeAudit({
        userId: null,
        action: 'TELEGRAM_REALTIME_SEND',
        entity: 'telegram_realtime',
        detail: { reference: rec.reference, guru: rec.guruNama, tarikh: rekodTarikhStr(rec.tarikh) },
        ip,
      });
    }
    return { ok: hasil.ok, error: hasil.error };
  } catch (e) {
    console.error('sendRealtime ERROR:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── HANTAR PEMBATALAN (status → DIBATALKAN) ───────────────
export async function sendPembatalan(rec, { userId = null, ip = null } = {}) {
  try {
    if (!bolehHantarRealtime(rec.tarikh)) return { skipped: true, reason: 'GATE' };
    if (!isTelegramConfigured()) return { skipped: true, reason: 'NO_CONFIG' };

    const text = buildPembatalanMessage(rec);
    const hasil = await sendTelegramMessage(text);
    await logTelegram({ tarikhDate: rec.tarikh, jenis: 'PEMBATALAN', text, hasil });

    if (hasil.ok) {
      await writeAudit({
        userId,
        action: 'TELEGRAM_PEMBATALAN_SEND',
        entity: 'telegram_pembatalan',
        detail: { reference: rec.reference, guru: rec.guruNama, tarikh: rekodTarikhStr(rec.tarikh) },
        ip,
      });
    }
    return { ok: hasil.ok, error: hasil.error };
  } catch (e) {
    console.error('sendPembatalan ERROR:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── SNAPSHOT PAGI AUTO (5:30) ─────────────────────────────
// force=true → langkau semakan hujung minggu + dedup (untuk ujian)
export async function runMorningSnapshot({ force = false } = {}) {
  const tarikh = todayKLStr();
  const tarikhDate = tarikhKeUtcDate(tarikh);

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

  const snap = await buildSnapshot({ tarikh, isAutoSnapshot: true });
  if (!snap.adaRekod) return { status: 'TIADA', tarikh, jumlahGuru: 0 };

  if (!isTelegramConfigured()) return { status: 'ERROR', reason: 'NO_CONFIG', tarikh };

  const hasil = await sendTelegramMessage(snap.text);
  await logTelegram({ tarikhDate, jenis: 'SNAPSHOT', text: snap.text, hasil });

  if (!hasil.ok) {
    return { status: 'ERROR', tarikh, jumlahGuru: snap.jumlahGuru, error: hasil.error };
  }

  await writeAudit({
    userId: null,
    action: 'TELEGRAM_SNAPSHOT_AUTO',
    entity: 'telegram_snapshot',
    detail: { tarikh, jumlahGuru: snap.jumlahGuru, auto: true },
    ip: null,
  });

  return { status: 'OK', tarikh, jumlahGuru: snap.jumlahGuru, messageId: hasil.messageId };
}
