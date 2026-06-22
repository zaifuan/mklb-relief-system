// ════════════════════════════════════════════════════════════
//  scheduler.js — penjadual dalam-proses (FASA 7/9), TIADA dependency.
//
//  Semak setiap 60 saat. Jika tetapan DB:
//    autoSnapshot = ON  DAN  jam KL SUDAH SAMPAI/LEPAS snapshotTime ("HH:MM")
//    DAN belum dicetus hari ini (KL)
//  → runMorningSnapshot() (langkau Sabtu/Ahad + dedup telegram_logs).
//
//  • Masa & ON/OFF dibaca dari DB (telegramSettings) — TIADA hardcode 5:30.
//    Tukar tetapan terus berkesan tanpa restart.
//  • DEFAULT autoSnapshot OFF → tiada apa dihantar sehingga admin aktifkan.
//  • ENABLE_SCHEDULER=false → matikan ticker sepenuhnya (suis induk dev).
//
//  ── PEMBETULAN BUG 5:30 ──────────────────────────────────────
//  Dahulu gerbang ialah padanan minit TEPAT (nowKLHHMM() === snapshotTime).
//  Jika tick 60s terlepas minit 05:30 (drift setInterval, backend di-restart
//  merentasi 05:30, atau host VPS tidur), snapshot TERUS terlepas sepanjang
//  hari — tiada catch-up. (Realtime tidak terjejas kerana ia dicetus oleh
//  permintaan HTTP, bukan timer.)
//  Kini gerbang = "jam KL sudah sampai/lepas masa jadual DAN belum dicetus
//  hari ini". Selagi backend hidup pada bila-bila masa pada/selepas masa
//  jadual (hari bukan hujung minggu), snapshot dihantar SEKALI hari itu.
//  Dedup DB (telegram_logs) tetap menjamin tiada mesej pendua.
// ════════════════════════════════════════════════════════════

import { runMorningSnapshot } from './services/telegramNotify.service.js';
import { getTelegramSettings, snapshotMinit } from './lib/telegramSettings.js';

let timer = null;
let lastFireKey = null; // "YYYY-MM-DD" (KL) — satu cetusan setiap hari

// Jam:minit KL semasa "HH:MM" (untuk log sahaja)
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

// Minit mutlak dalam hari (0–1439) ikut jam Asia/Kuala_Lumpur
function nowKLMinit() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const h = +parts.find((p) => p.type === 'hour').value;
  const m = +parts.find((p) => p.type === 'minute').value;
  return h * 60 + m;
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

    const today = todayKL();
    if (lastFireKey === today) return; // sudah dicetus hari ini (proses ini)

    // Catch-up: cetus sebaik jam KL sampai/lepas masa jadual (bukan minit tepat).
    if (nowKLMinit() < snapshotMinit(s.snapshotTime)) return; // belum tiba masa

    lastFireKey = today; // tandakan SEBELUM hantar — elak cetus berganda seminit
    const res = await runMorningSnapshot();
    console.log(
      `[scheduler] cetus snapshot auto — KL ${nowKLHHMM()} (jadual ${s.snapshotTime}):`,
      JSON.stringify(res)
    );
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
  console.log(
    '[scheduler] aktif — semak tetapan Telegram DB setiap 60 saat ' +
      '(catch-up pada/lepas masa jadual; default auto OFF).'
  );
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
