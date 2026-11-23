// ════════════════════════════════════════════════════════════
//  telegram.js — penghantar mesej Telegram (Bot API sendMessage).
//  PORT daripada sendTelegramMessage() GAS.
//
//  • Token & Chat ID DIBACA dari env (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)
//    — bot & group lama sistem GAS. JANGAN hardcode.
//  • parse_mode HTML — tajuk kategori <b>bold</b>, sebab detail <i>italic</i>.
//    Teks dinamik DIESCAPE di snapshot.service.js (&, <, >, ").
//  • Guna fetch terbina Node 22 — tiada dependency baharu.
// ════════════════════════════════════════════════════════════

import { isTelegramSilentMode } from './telegramSettings.js';

const TELEGRAM_API = 'https://api.telegram.org';

export function isTelegramConfigured() {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

// Kemaskini 04 — `manual: true` HANYA dihantar oleh controller penghantaran manual
// (POST /api/telegram/snapshot/send, SUPER_ADMIN). Ia pilihan kod, bukan input
// pengguna. Semua pemanggil lain dianggap AUTOMATIK dan digugurkan semasa Mod
// Senyap (tiada simpanan/antrian, tiada retry).
export async function sendTelegramMessage(text, { manual = false } = {}) {
  if (manual !== true && (await isTelegramSilentMode())) {
    return { ok: false, skipped: true, error: 'SILENT_MODE' };
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { ok: false, error: 'NO_CONFIG' };
  }

  try {
    const resp = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });

    let data = null;
    try {
      data = await resp.json();
    } catch {
      /* bukan JSON */
    }

    if (!data || !data.ok) {
      return { ok: false, error: data?.description || `HTTP ${resp.status}`, raw: data };
    }

    const messageId = data.result?.message_id != null ? String(data.result.message_id) : null;
    return { ok: true, messageId, raw: data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
