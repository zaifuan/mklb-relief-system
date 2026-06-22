// ════════════════════════════════════════════════════════════
//  scheduler.js — penjadual dalam-proses (FASA 7/9/10), TIADA dependency.
//
//  Dua slot snapshot automatik (masa HARDCODE, ikut jam Asia/Kuala_Lumpur):
//    • AUTO_MORNING — 05:30 → sasaran HARI INI
//    • AUTO_EARLY   — 15:00 → sasaran ESOK (makluman sehari sebelum)
//
//  Semak setiap 60 saat. Untuk SETIAP slot, jika:
//    autoSnapshot ON  DAN  jam KL SUDAH SAMPAI/LEPAS masa slot
//    DAN slot itu belum dicetus hari ini (KL)
//  → jalankan runner slot. Weekend-skip (pada TARIKH SASARAN) + dedup
//    telegram_logs per (jenis SNAPSHOT, triggerType slot, tarikh) diputus
//    DI DALAM runner.
//
//  • ON/OFF dibaca dari DB (telegramSettings.autoSnapshot) — satu suis untuk
//    kedua-dua slot. Masa di-HARDCODE (tiada setting baharu).
//  • Gerbang "sampai/lepas masa + belum dicetus" (catch-up) — BUKAN padanan
//    minit tepat — supaya snapshot tidak terlepas walau tick tersasar / backend
//    di-restart merentasi minit sasaran / host tidur.
//  • Kunci-cetus BERASINGAN per slot → AUTO_EARLY tidak menghalang AUTO_MORNING.
//  • ENABLE_SCHEDULER=false → matikan ticker sepenuhnya (suis induk dev).
// ════════════════════════════════════════════════════════════

import { runEarlySnapshot, runMorningSnapshot } from './services/telegramNotify.service.js';
import { getTelegramSettings } from './lib/telegramSettings.js';

// Slot automatik — masa HARDCODE (minit-dalam-hari, KL).
const SLOTS = [
  { nama: 'AUTO_MORNING', minit: 5 * 60 + 30, jalankan: runMorningSnapshot }, // 05:30 → hari ini
  { nama: 'AUTO_EARLY', minit: 15 * 60, jalankan: runEarlySnapshot }, //          15:00 → esok
];

let timer = null;
const lastFire = {}; // { [slot]: "YYYY-MM-DD" (KL) } — satu cetusan setiap slot/hari

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
    if (!s.autoSnapshot) return; // OFF → kedua-dua slot mati; tiada tanda lastFire

    const today = todayKL();
    const nowMin = nowKLMinit();

    for (const slot of SLOTS) {
      if (lastFire[slot.nama] === today) continue; // slot ini sudah dicetus hari ini
      if (nowMin < slot.minit) continue; // belum sampai masa slot (catch-up bila lewat)
      lastFire[slot.nama] = today; // tanda SEBELUM hantar — elak cetus berganda
      const res = await slot.jalankan();
      console.log(`[scheduler] cetus ${slot.nama} — KL ${nowKLHHMM()}:`, JSON.stringify(res));
    }
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
    '[scheduler] aktif — AUTO_MORNING 05:30 (hari ini) + AUTO_EARLY 15:00 (esok), ' +
      'catch-up; default auto OFF.'
  );
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
