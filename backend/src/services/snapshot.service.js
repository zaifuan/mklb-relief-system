// ════════════════════════════════════════════════════════════
//  snapshot.service.js — bina teks snapshot ketidakhadiran guru.
//
//  Format selaras telegram.gs + penambahbaikan (FASA 7):
//    Susunan: MC / CRK / CTR → PROGRAM DI SEKOLAH → PROGRAM DI LUAR
//             SEKOLAH → LAIN-LAIN. Seksyen kosong DISEMBUNYIKAN.
//    • MC/CRK/CTR : "• Nama - JENIS" (tiada detail).
//    • Program/Lain-lain : rekod dgn (jenis+masa+catatan) SAMA dikumpul →
//        senarai nama bullet, baris (masa), baris "Catatan: …".
//    • Masa : SEPANJANG_HARI → "(Sehari Penuh)";
//             SEPARUH_HARI   → "(7:30 pagi - tamat sekolah)".
//    • Header manual "KEMASKINI KETIDAKHADIRAN GURU" / auto "KETIDAKHADIRAN
//      GURU". Footer "Kemaskini terakhir: <masa>" (auto guna masa tetapan).
//    • Plain text — sendMessage sahaja, jangan edit/padam mesej lama.
// ════════════════════════════════════════════════════════════

import prisma from '../lib/prisma.js';
import { hariDari } from '../lib/absenceUtil.js';
import { masaKeMinitAuto, HUJUNG_HARI } from '../lib/absenceWindow.js';

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

// minit mutlak → "7:30 pagi" / "12:00 tengah hari" / "2:30 petang"
function minitKeLabel(min) {
  const h = Math.floor(min / 60);
  const mm = String(min % 60).padStart(2, '0');
  let suffix, hh;
  if (h === 12) {
    suffix = 'tengah hari';
    hh = 12;
  } else if (h < 12) {
    suffix = 'pagi';
    hh = h === 0 ? 12 : h;
  } else {
    suffix = 'petang';
    hh = h - 12;
  }
  return `${hh}:${mm} ${suffix}`;
}

// jenis + masaMula + masaTamat → "(Sehari Penuh)" / "(7:30 pagi - tamat sekolah)"
function masaLabel(jenis, masaMula, masaTamat) {
  if (jenis !== 'SEPARUH_HARI') return '(Sehari Penuh)';
  const m = masaKeMinitAuto(masaMula);
  if (m === null) return '(Sehari Penuh)'; // fallback selamat
  const mulaTxt = minitKeLabel(m);
  const t = masaTamat ? masaKeMinitAuto(masaTamat) : null;
  const tamatTxt = t === null || t === HUJUNG_HARI || t <= m ? 'tamat sekolah' : minitKeLabel(t);
  return `(${mulaTxt} - ${tamatTxt})`;
}

// Render seksyen Program/Lain-lain: kumpul ikut jenis+masa+catatan
function renderKumpulan(records) {
  const order = [];
  const map = new Map();
  for (const r of records) {
    const key = `${r.jenis}|${r.masaMula || ''}|${r.masaTamat || ''}|${r.catatan || ''}`;
    if (!map.has(key)) {
      map.set(key, { jenis: r.jenis, masaMula: r.masaMula, masaTamat: r.masaTamat, catatan: r.catatan, nama: [] });
      order.push(key);
    }
    const g = map.get(key);
    if (!g.nama.includes(r.nama)) g.nama.push(r.nama);
  }
  return order
    .map((key) => {
      const g = map.get(key);
      let b = g.nama.map((n) => `• ${n}`).join('\n');
      b += `\n\n${masaLabel(g.jenis, g.masaMula, g.masaTamat)}`;
      if (g.catatan) b += `\n\nCatatan: ${g.catatan}`;
      return b;
    })
    .join('\n\n'); // pisah kumpulan berbeza dalam kategori sama
}

export async function buildSnapshot({
  tarikh,
  isAutoSnapshot = false,
  pembatalan = false,
  autoLabel = '5:30 AM',
}) {
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

  const mc = []; // { nama, kat }
  const progSekolah = []; // { nama, jenis, masaMula, masaTamat, catatan }
  const progLuar = [];
  const lainLain = [];

  for (const r of records) {
    const nama = String(r.guruNama || '').trim();
    const kat = String(r.sebabKategori || '').trim().toUpperCase();
    const catatan = String(r.sebabDetail || '').trim();
    if (!nama) continue;

    if (MC_KATEGORI.includes(kat)) {
      if (!mc.some((x) => x.nama === nama && x.kat === kat)) mc.push({ nama, kat });
    } else {
      const item = { nama, jenis: r.jenis, masaMula: r.masaMula, masaTamat: r.masaTamat, catatan };
      if (kat === 'PROGRAM_SEKOLAH') progSekolah.push(item);
      else if (kat === 'PROGRAM_LUAR') progLuar.push(item);
      else lainLain.push(item);
    }
  }

  const jumlah = mc.length + progSekolah.length + progLuar.length + lainLain.length;

  // ── Kosong (cth selepas pembatalan) ──
  if (jumlah === 0) {
    let m = '';
    if (pembatalan) m += '⚠️ PEMBATALAN KETIDAKHADIRAN\n\n';
    m += pembatalan
      ? 'Tiada lagi rekod ketidakhadiran aktif untuk hari ini.'
      : 'Tiada rekod ketidakhadiran.';
    return { text: m, jumlahGuru: 0, hari, adaRekod: false };
  }

  // ── Bina teks ──
  let msg = '';
  if (pembatalan) msg += '⚠️ PEMBATALAN KETIDAKHADIRAN\n\n';

  const header = isAutoSnapshot ? 'KETIDAKHADIRAN GURU' : 'KEMASKINI KETIDAKHADIRAN GURU';
  msg += header + '\n\n';
  msg += 'Tarikh: ' + tarikhDisplay(tarikh) + '\n';
  msg += 'Hari: ' + String(hari || '').toUpperCase();

  const sections = [];
  if (mc.length) sections.push(['MC / CRK / CTR', mc.map((x) => `• ${x.nama} - ${x.kat}`).join('\n')]);
  if (progSekolah.length) sections.push(['PROGRAM DI SEKOLAH', renderKumpulan(progSekolah)]);
  if (progLuar.length) sections.push(['PROGRAM DI LUAR SEKOLAH', renderKumpulan(progLuar)]);
  if (lainLain.length) sections.push(['LAIN-LAIN', renderKumpulan(lainLain)]);

  for (const [label, body] of sections) {
    msg += `\n\n\n${label}\n\n${body}`;
  }

  msg += '\n\nKemaskini terakhir: ' + (isAutoSnapshot ? autoLabel : masaSekarangKL());

  return { text: msg, jumlahGuru: jumlah, hari, adaRekod: true };
}
