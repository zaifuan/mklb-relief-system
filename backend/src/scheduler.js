// ════════════════════════════════════════════════════════════
//  scheduler.js — penjadual dalam-proses (FASA 7), TIADA dependency.
//
//  Semak setiap 60 saat. Jika tetapan DB:
//    autoSnapshot = ON  DAN  jam KL = snapshotTime ("HH:MM")
//  → runMorningSnapshot() (langkau Sabtu/Ahad + dedup telegram_logs).
//
//  • Masa & ON/OFF dibaca dari DB (telegramSettings) — TIADA hardcode 5:30.
//    Tukar tetapan terus berkesan tanpa restart.
//  • DEFAULT autoSnapshot OFF → tiada apa dihantar sehingga admin aktifkan.
//  • ENABLE_SCHEDULER=false → matikan ticker sepenuhnya (suis induk dev).
// ════════════════════════════════════════════════════════════

import { runMorningSnapshot } from './services/telegramNotify.service.js';
import { getTelegramSettings } from './lib/telegramSettings.js';

let timer = null;
let lastFireKey = null; // elak cetus berganda dalam minit yang sama

function nowKLHHMM() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const h = parts.find((p) => p.type === 'hour').value;
  const m = parts.find((p) => p.type === 'minute').value;
  return `${h}:${m}`;
}

function todayKL() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function tick() {
  try {
    const s = await getTelegramSettings();
    if (!s.autoSnapshot) return; // OFF → tiada apa
    if (nowKLHHMM() !== s.snapshotTime) return; // belum tiba masa

    const key = `${todayKL()} ${s.snapshotTime}`;
    if (lastFireKey === key) return; // sudah cuba minit ini
    lastFireKey = key;

    const res = await runMorningSnapshot();
    console.log('[scheduler] snapshot auto:', JSON.stringify(res));
  } catch (e) {
    console.error('[scheduler] tick ERROR:', e.message);
  }
}

export function startScheduler() {
  if (process.env.ENABLE_SCHEDULER === 'false') {
    console.log('[scheduler] dimatikan (ENABLE_SCHEDULER=false).');
    return;
  }
  if (timer) return; // elak ganda
  timer = setInterval(tick, 60 * 1000); // semak setiap 60 saat
  if (timer.unref) timer.unref();
  console.log('[scheduler] aktif — semak tetapan Telegram DB setiap 60 saat (default auto OFF).');
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
