// ════════════════════════════════════════════════════════════
//  Controller: telegram (Fasa 8 — snapshot ketidakhadiran)
//    previewSnapshot  GET  /api/telegram/snapshot/preview?tarikh=YYYY-MM-DD
//    sendSnapshot     POST /api/telegram/snapshot/send  { tarikh? }
//
//  • preview: SUPER_ADMIN + ADMIN_RELIEF (bina teks sahaja, tiada hantar)
//  • send: SUPER_ADMIN sahaja (lihat routes) — hantar + log
//  • Jika tiada rekod AKTIF → tidak hantar (status TIADA)
//  • Log: telegram_logs (berstruktur) + audit_logs (TELEGRAM_SNAPSHOT_SEND)
// ════════════════════════════════════════════════════════════

import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { writeAudit, getClientIp } from '../lib/audit.js';
import { buildSnapshot, tarikhKeUtcDate, masaSekarangKL } from '../services/snapshot.service.js';
import { sendTelegramMessage, isTelegramConfigured } from '../lib/telegram.js';

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
        messageText: snap.text,
        telegramMessageId: hasil.messageId || null,
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
