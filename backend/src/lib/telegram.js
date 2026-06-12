// ════════════════════════════════════════════════════════════
//  telegram.js — penghantar mesej Telegram (Bot API sendMessage).
//  PORT daripada sendTelegramMessage() GAS.
//
//  • Token & Chat ID DIBACA dari env (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)
//    — bot & group lama sistem GAS. JANGAN hardcode.
//  • Plain text (parse_mode kosong) — selamat untuk aksara khas, sama GAS.
//  • Guna fetch terbina Node 22 — tiada dependency baharu.
// ════════════════════════════════════════════════════════════

const TELEGRAM_API = 'https://api.telegram.org';

export function isTelegramConfigured() {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { ok: false, error: 'NO_CONFIG' };
  }

  try {
    const resp = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: '' }),
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
