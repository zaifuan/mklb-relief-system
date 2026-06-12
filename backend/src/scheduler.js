// ════════════════════════════════════════════════════════════
//  scheduler.js — penjadual dalam-proses (Fasa 9), TIADA dependency.
//
//  Fire setiap hari pada 5:30 pagi (Asia/Kuala_Lumpur) → runMorningSnapshot().
//  Langkau Sabtu/Ahad + dedup dikendalikan dalam runMorningSnapshot().
//  Dikawal env ENABLE_SCHEDULER (default 'true'; set 'false' untuk matikan,
//  cth. semasa ujian). Selamat-restart kerana ada dedup telegram_logs.
// ════════════════════════════════════════════════════════════

import { runMorningSnapshot } from './services/telegramNotify.service.js';

const SNAP_HOUR = 5;
const SNAP_MIN = 30;

let timer = null;

// Berapa milisaat ke 5:30 pagi KL seterusnya
function msUntilNextKL(hour, min) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = +parts.find((p) => p.type === 'hour').value;
  const mi = +parts.find((p) => p.type === 'minute').value;
  const s = +parts.find((p) => p.type === 'second').value;

  const nowMs = ((h * 60 + mi) * 60 + s) * 1000 + now.getMilliseconds();
  const targetMs = (hour * 60 + min) * 60 * 1000;
  let delta = targetMs - nowMs;
  if (delta <= 0) delta += 24 * 60 * 60 * 1000; // esok
  return delta;
}

function arm() {
  const delay = msUntilNextKL(SNAP_HOUR, SNAP_MIN);
  timer = setTimeout(async () => {
    try {
      const res = await runMorningSnapshot();
      console.log('[scheduler] snapshot pagi:', JSON.stringify(res));
    } catch (e) {
      console.error('[scheduler] ERROR:', e.message);
    } finally {
      arm(); // jadual semula untuk esok
    }
  }, delay);
  if (timer.unref) timer.unref();
  console.log(`[scheduler] snapshot pagi dijadualkan dalam ~${Math.round(delay / 60000)} minit (5:30 pagi KL).`);
}

export function startScheduler() {
  if (process.env.ENABLE_SCHEDULER === 'false') {
    console.log('[scheduler] dimatikan (ENABLE_SCHEDULER=false).');
    return;
  }
  if (timer) return; // elak ganda
  arm();
}

export function stopScheduler() {
  if (timer) clearTimeout(timer);
  timer = null;
}
