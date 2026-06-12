// ════════════════════════════════════════════════════════════
//  snapshot.service.js — bina teks snapshot ketidakhadiran guru.
//  PORT TEPAT format generateTelegramSnapshot() GAS, tetapi guna
//  sebabKategori + sebabDetail yang SUDAH berasingan (Fasa 4) —
//  tiada lagi emoji-stripping / dash-splitting.
//
//  Susunan & label kekal 100% seperti sistem GAS lama:
//    MC / CRK / CTR → PROGRAM DI SEKOLAH → PROGRAM DI LUAR SEKOLAH → LAIN-LAIN
//  Seksyen kosong DISEMBUNYIKAN. Jika semua kosong → adaRekod:false
//  (controller tidak akan hantar).
// ════════════════════════════════════════════════════════════

import prisma from '../lib/prisma.js';
import { hariDari } from '../lib/absenceUtil.js';

const GROUP_ORDER = ['MC_CRK_CTR', 'PROGRAM_SEKOLAH', 'PROGRAM_LUAR', 'LAIN_LAIN'];

const LABEL_MAP = {
  MC_CRK_CTR: 'MC / CRK / CTR',
  PROGRAM_SEKOLAH: 'PROGRAM DI SEKOLAH',
  PROGRAM_LUAR: 'PROGRAM DI LUAR SEKOLAH',
  LAIN_LAIN: 'LAIN-LAIN',
};

const MC_KATEGORI = ['MC', 'CRK', 'CTR'];

export function tarikhKeUtcDate(tarikhStr) {
  const m = String(tarikhStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

// "2026-06-10" → "10/6/2026" (tanpa sifar awalan, sama GAS)
function tarikhDisplay(tarikhStr) {
  const p = String(tarikhStr).split('-');
  return `${parseInt(p[2], 10)}/${parseInt(p[1], 10)}/${p[0]}`;
}

// Masa semasa Malaysia → "7:17 PM"
export function masaSekarangKL() {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date());
  } catch {
    return '';
  }
}

export async function buildSnapshot({ tarikh, isAutoSnapshot = false, pembatalan = false }) {
  const tarikhDate = tarikhKeUtcDate(tarikh);
  if (!tarikhDate) {
    const e = new Error('Format tarikh tidak sah (perlu YYYY-MM-DD).');
    e.code = 'BAD_DATE';
    throw e;
  }
  const hari = hariDari(tarikhDate);

  const records = await prisma.absenceRecord.findMany({
    where: { tarikh: tarikhDate, statusBorang: 'AKTIF', deletedAt: null },
    orderBy: { createdAt: 'asc' }, // susun ikut masa hantar
  });

  const groups = { MC_CRK_CTR: [], PROGRAM_SEKOLAH: [], PROGRAM_LUAR: [], LAIN_LAIN: [] };

  for (const r of records) {
    const nama = String(r.guruNama || '').trim();
    const kat = String(r.sebabKategori || '').trim().toUpperCase();
    const detail = String(r.sebabDetail || '').trim();

    let key, display;
    if (MC_KATEGORI.includes(kat)) {
      // MC / CRK / CTR — papar jenis cuti sahaja, BUKAN detail
      key = 'MC_CRK_CTR';
      display = `${nama} - ${kat}`;
    } else if (kat === 'PROGRAM_SEKOLAH') {
      key = 'PROGRAM_SEKOLAH';
      display = detail ? `${nama} - ${detail}` : nama;
    } else if (kat === 'PROGRAM_LUAR') {
      key = 'PROGRAM_LUAR';
      display = detail ? `${nama} - ${detail}` : nama;
    } else {
      // LAIN_LAIN + sebarang fallback — papar detail
      key = 'LAIN_LAIN';
      display = detail ? `${nama} - ${detail}` : nama;
    }

    if (!display.trim()) continue;
    // Dedup nama dalam kumpulan sama
    if (!groups[key].some((x) => x.nama === nama)) {
      groups[key].push({ nama, display });
    }
  }

  const jumlahGuru = GROUP_ORDER.reduce((s, k) => s + groups[k].length, 0);
  const masaLabel = isAutoSnapshot ? '5:30 AM' : masaSekarangKL();

  // ── Bina teks ──
  let msg = '';
  if (pembatalan) msg += '⚠️ PEMBATALAN KETIDAKHADIRAN\n\n';

  if (jumlahGuru === 0) {
    msg += pembatalan
      ? 'Tiada lagi rekod ketidakhadiran aktif untuk hari ini.'
      : 'Tiada rekod ketidakhadiran.';
    return { text: msg, jumlahGuru: 0, hari, adaRekod: false };
  }

  const header = isAutoSnapshot ? 'KETIDAKHADIRAN GURU' : 'KEMASKINI KETIDAKHADIRAN GURU';
  msg += header + '\n\n';
  msg += 'Tarikh: ' + tarikhDisplay(tarikh) + '\n';
  msg += 'Hari: ' + String(hari || '').toUpperCase();

  for (const k of GROUP_ORDER) {
    if (groups[k].length === 0) continue; // sembunyi seksyen kosong
    msg += '\n\n\n' + LABEL_MAP[k] + '\n\n';
    groups[k].forEach((g, i) => {
      msg += `${i + 1}. ${g.display}\n`;
    });
  }

  msg += '\n\nKemaskini terakhir: ' + masaLabel;

  return { text: msg, jumlahGuru, hari, adaRekod: true };
}
