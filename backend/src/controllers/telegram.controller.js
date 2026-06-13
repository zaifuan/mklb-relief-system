// ════════════════════════════════════════════════════════════
//  Controller: telegram (Fasa 8 — snapshot ketidakhadiran)
//    previewSnapshot  GET  /api/telegram/snapshot/preview?tarikh=YYYY-MM-DD
//    sendSnapshot     POST /api/telegram/snapshot/send  { tarikh? }
//
//  • preview: SUPER_ADMIN + ADMIN (bina teks sahaja, tiada hantar)
//  • send: SUPER_ADMIN sahaja (lihat routes) — hantar + log
//  • Jika tiada rekod AKTIF → tidak hantar (status TIADA)
//  • Log: telegram_logs (berstruktur) + audit_logs (TELEGRAM_SNAPSHOT_SEND)
// ════════════════════════════════════════════════════════════

import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { writeAudit, getClientIp } from '../lib/audit.js';
import { buildSnapshot, tarikhKeUtcDate, masaSekarangKL } from '../services/snapshot.service.js';
import { sendTelegramMessage, isTelegramConfigured } from '../lib/telegram.js';
import { getTelegramSettings, setTelegramSettings, snapshotTimeLabel } from '../lib/telegramSettings.js';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const TARIKH_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayKL() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function resolveTarikh(input) {
  const s = input === undefined || input === null ? '' : String(input).trim();
  return s === '' ? todayKL() : s;
}

// ── GET /api/telegram/snapshot/preview ──
export async function previewSnapshot(req, res) {
  const tarikh = resolveTarikh(req.query.tarikh);
  if (!TARIKH_RE.test(tarikh)) {
    return res.status(400).json({ mesej: 'Tarikh perlu format YYYY-MM-DD' });
  }
  try {
    const snap = await buildSnapshot({ tarikh });
    res.json({
      tarikh,
      hari: snap.hari,
      jumlahGuru: snap.jumlahGuru,
      adaRekod: snap.adaRekod,
      telegramSedia: isTelegramConfigured(),
      text: snap.text,
    });
  } catch (err) {
    if (err.code === 'BAD_DATE') return res.status(400).json({ mesej: err.message });
    console.error('previewSnapshot ERROR:', err);
    res.status(500).json({ mesej: 'Ralat menjana pratonton snapshot', error: err.message });
  }
}

// ── POST /api/telegram/snapshot/send ──
export async function sendSnapshot(req, res) {
  const parsed = z
    .object({ tarikh: z.string().regex(TARIKH_RE).optional() })
    .safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ mesej: 'Tarikh perlu format YYYY-MM-DD' });
  }
  const tarikh = resolveTarikh(parsed.data.tarikh);

  try {
    const snap = await buildSnapshot({ tarikh });

    // Tiada rekod aktif — jangan hantar
    if (!snap.adaRekod) {
      return res.json({
        status: 'TIADA',
        tarikh,
        jumlahGuru: 0,
        mesej: 'Tiada rekod ketidakhadiran aktif untuk tarikh ini — tiada mesej dihantar.',
      });
    }

    // Token/Chat belum diset di server
    if (!isTelegramConfigured()) {
      return res.status(503).json({
        status: 'ERROR',
        mesej: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID belum diset pada server.',
      });
    }

    const hasil = await sendTelegramMessage(snap.text);

    // Rekod ke telegram_logs (samada jaya atau gagal)
    await prisma.telegramLog.create({
      data: {
        tarikh: tarikhKeUtcDate(tarikh),
        jenis: 'MANUAL',
        triggerType: 'MANUAL',
        totalRecords: snap.jumlahGuru,
        messageText: snap.text,
        telegramMessageId: hasil.messageId || null,
        success: hasil.ok,
        errorMessage: hasil.ok ? null : hasil.error || 'tidak diketahui',
        status: hasil.ok ? 'OK' : `GAGAL: ${hasil.error || 'tidak diketahui'}`,
      },
    });

    if (!hasil.ok) {
      return res.status(502).json({
        status: 'ERROR',
        tarikh,
        jumlahGuru: snap.jumlahGuru,
        mesej: `Gagal hantar ke Telegram: ${hasil.error || 'tidak diketahui'}`,
      });
    }

    await writeAudit({
      userId: req.user?.id || null,
      action: 'TELEGRAM_SNAPSHOT_SEND',
      entity: 'telegram_snapshot',
      detail: { tarikh, jumlahGuru: snap.jumlahGuru },
      ip: getClientIp(req),
    });

    res.json({
      status: 'OK',
      tarikh,
      jumlahGuru: snap.jumlahGuru,
      messageId: hasil.messageId,
      masa: masaSekarangKL(),
      mesej: 'Snapshot Telegram berjaya dihantar.',
    });
  } catch (err) {
    if (err.code === 'BAD_DATE') return res.status(400).json({ mesej: err.message });
    console.error('sendSnapshot ERROR:', err);
    res.status(500).json({ status: 'ERROR', mesej: 'Ralat menghantar snapshot', error: err.message });
  }
}

// ── GET /api/telegram/settings (Super Admin + Admin) ──
export async function getSettings(req, res) {
  try {
    const s = await getTelegramSettings();
    res.json(s);
  } catch (err) {
    console.error('getSettings ERROR:', err);
    res.status(500).json({ mesej: 'Ralat membaca tetapan Telegram', error: err.message });
  }
}

// ── PATCH /api/telegram/settings (Super Admin) ──
export async function updateSettings(req, res) {
  const parsed = z
    .object({
      autoSnapshot: z.boolean().optional(),
      realtime: z.boolean().optional(),
      snapshotTime: z.string().regex(TIME_RE).optional(),
    })
    .safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ mesej: 'Input tidak sah (snapshotTime perlu format HH:MM 24-jam).' });
  }
  try {
    const before = await getTelegramSettings();
    const after = await setTelegramSettings(parsed.data);
    await writeAudit({
      userId: req.user?.id || null,
      action: 'TELEGRAM_SETTINGS_UPDATE',
      entity: 'telegram_settings',
      detail: { before, after },
      ip: getClientIp(req),
    });
    res.json(after);
  } catch (err) {
    if (err.code === 'BAD_TIME') return res.status(400).json({ mesej: err.message });
    console.error('updateSettings ERROR:', err);
    res.status(500).json({ mesej: 'Ralat menyimpan tetapan Telegram', error: err.message });
  }
}

// ── GET /api/telegram/status (Super Admin + Admin) ──
export async function getStatus(req, res) {
  try {
    const s = await getTelegramSettings();
    const last = await prisma.telegramLog.findFirst({
      where: { jenis: { in: ['SNAPSHOT', 'MANUAL', 'REALTIME'] }, status: 'OK' },
      orderBy: { sentAt: 'desc' },
    });

    let lastSnapshot = null;
    if (last) {
      const masa = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kuala_Lumpur',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(last.sentAt);
      lastSnapshot = { masa, jenis: last.jenis, totalRecords: last.totalRecords ?? null };
    }

    res.json({
      botConnected: !!process.env.TELEGRAM_BOT_TOKEN,
      chatConfigured: !!process.env.TELEGRAM_CHAT_ID,
      autoSnapshot: s.autoSnapshot,
      snapshotTime: s.snapshotTime,
      snapshotTimeLabel: snapshotTimeLabel(s.snapshotTime),
      realtime: s.realtime,
      lastSnapshot,
    });
  } catch (err) {
    console.error('getStatus ERROR:', err);
    res.status(500).json({ mesej: 'Ralat status Telegram', error: err.message });
  }
}
