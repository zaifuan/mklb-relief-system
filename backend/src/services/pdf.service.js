// ════════════════════════════════════════════════════════════
//  pdf.service.js — jana PDF "JADUAL WAKTU GURU GANTI".
//  • A4 Landscape, margin profesional, multi-muka surat, no. muka surat auto.
//  • Header: logo + tajuk + tarikh/hari + nama sekolah + ringkasan.
//  • Jadual: Bil | Guru Tidak Hadir | Kelas | Subjek | Masa | Guru Ganti.
//  • Footer: tandatangan (muka akhir) + nota auto + nombor muka surat.
//  PDFKit (fon Helvetica terbina — tiada kebergantungan fon luar).
//  TIDAK menyentuh enjin relief / DB.
// ════════════════════════════════════════════════════════════

import PDFDocument from 'pdfkit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO = path.join(__dirname, '../assets/logo-sekolah.png');

const HIJAU = '#0f766e';
const HIJAU_GELAP = '#0b5e57';
const GARIS = '#c7d3cf';
const ZEBRA = '#f3f7f6';
const TEKS = '#1f2d29';
const TIADA = 'TIADA_PENGGANTI';

const BULAN = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];

function fmtTarikh(d) {
  return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function fmtMasaJana(d) {
  if (!d) return '-';
  const x = new Date(new Date(d).getTime() + 8 * 3600 * 1000); // waktu Malaysia (UTC+8)
  let h = x.getUTCHours();
  const m = String(x.getUTCMinutes()).padStart(2, '0');
  const ap = h < 12 ? 'pagi' : 'petang';
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${x.getUTCDate()} ${BULAN[x.getUTCMonth()]} ${x.getUTCFullYear()}, ${hh}:${m} ${ap}`;
}

// Tukar satu token masa sekolah ("8.10" / "8:10") → "8:10 AM".
// Kuirk format sekolah: jam 7–11 = AM (pagi), 12 = PM (tengah hari), 1–6 = PM (petang).
function jamAmPm(tok) {
  const m = String(tok || '').trim().match(/^(\d{1,2})[.:](\d{2})$/);
  if (!m) return String(tok || '').trim();
  let h = parseInt(m[1], 10);
  const mm = m[2];
  let ap;
  if (h === 12) ap = 'PM';
  else if (h >= 7 && h <= 11) ap = 'AM';
  else if (h >= 1 && h <= 6) ap = 'PM';
  else {
    ap = h < 12 ? 'AM' : 'PM'; // jaga-jaga jika format 24-jam
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
  }
  return `${h}:${mm} ${ap}`;
}

// "8.10 – 8.40" / "8.10-8.40" → "8:10 AM – 8:40 AM"
function fmtMasaAmPm(masa) {
  const clean = String(masa || '').replace(/[–—]/g, '-');
  const i = clean.indexOf('-');
  if (i < 0) return jamAmPm(clean);
  return `${jamAmPm(clean.slice(0, i))} – ${jamAmPm(clean.slice(i + 1))}`;
}

// Masa mula DARI teks terformat ("8:10 AM – 8:40 AM") → minit mutlak (untuk sort).
function startMinitFmt(masaFmt) {
  const m = String(masaFmt || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return 9999;
  let h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + mi;
}

// Stream PDF terus ke `res` (atau mana-mana writable stream).
export function streamReliefPdf(res, { tarikhDate, hari, namaSekolah, baris: barisInput, pertukaran = [], dijanaOleh, masaJana }) {
  // ── Sorting LAST-MILE (sebelum pagination & render) ──
  // Dilakukan di sini supaya PDF SENTIASA tersusun ikut nama guru tidak hadir
  // A–Z → masa mula → kelas, tidak kira urutan data yang dihantar.
  console.log(
    '[pdf.service] PDF SORT CHECK (input):',
    JSON.stringify((barisInput || []).map((b) => ({ guru: b.guruTakHadir, masa: b.masa, kelas: b.kelas })))
  );
  const baris = [...(barisInput || [])].sort((a, b) => {
    const byNama = String(a.guruTakHadir || '').localeCompare(String(b.guruTakHadir || ''), 'ms');
    if (byNama !== 0) return byNama;
    const sa = startMinitFmt(a.masa);
    const sb = startMinitFmt(b.masa);
    if (sa !== sb) return sa - sb;
    return String(a.kelas || '').localeCompare(String(b.kelas || ''), 'ms');
  });
  console.log(
    '[pdf.service] PDF SORTED CHECK (selepas sort):',
    JSON.stringify(baris.map((b, i) => ({ bil: i + 1, guru: b.guruTakHadir, masa: b.masa, kelas: b.kelas })))
  );

  // ── Kiraan relief per guru ganti (HANYA relief automatik jadual utama) ──
  // Tidak kira "TIADA PENGGANTI", tidak kira slot kosong, tidak kira pertukaran kelas.
  const reliefCount = {}; // KEY (UPPERCASE) → bilangan
  const reliefNama = {}; // KEY → nama paparan (asal)
  for (const b of baris) {
    if (!b.guruGanti || b.guruGanti === TIADA) continue;
    const key = String(b.guruGanti).trim().toUpperCase();
    reliefCount[key] = (reliefCount[key] || 0) + 1;
    if (!reliefNama[key]) reliefNama[key] = String(b.guruGanti).trim();
  }
  const multiList = Object.keys(reliefCount)
    .filter((k) => reliefCount[k] > 1)
    .map((k) => ({ nama: reliefNama[k], count: reliefCount[k] }))
    .sort((a, b) => b.count - a.count || a.nama.localeCompare(b.nama, 'ms'));

  // Maklumat sel "Guru Ganti": teks (+ "(n)" jika >1), serta flag gaya.
  const gantiInfo = (b) => {
    const isTiada = b.guruGanti === TIADA;
    const isKosong = !b.guruGanti;
    if (isTiada) return { text: 'TIADA PENGGANTI', isMulti: false, isTiada, isKosong };
    if (isKosong) return { text: '—', isMulti: false, isTiada, isKosong };
    const key = String(b.guruGanti).trim().toUpperCase();
    const cnt = reliefCount[key] || 1;
    const isMulti = cnt > 1;
    return { text: isMulti ? `${b.guruGanti} (${cnt})` : b.guruGanti, isMulti, isTiada, isKosong };
  };

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 40, bottom: 18, left: 40, right: 40 },
    bufferPages: true,
    info: { Title: `Jadual Waktu Guru Ganti ${fmtTarikh(tarikhDate)}`, Author: namaSekolah },
  });
  doc.pipe(res);

  const pageW = doc.page.width; // 841.89
  const pageH = doc.page.height; // 595.28
  const ML = 40;
  const MR = 40;
  const contentW = pageW - ML - MR;

  const wFix = 34 + 198 + 78 + 80 + 132; // Bil+Guru+Kelas+Subjek+Masa
  const cols = [
    { key: 'bil', label: 'Bil', w: 34, align: 'center' },
    { key: 'guru', label: 'Guru Tidak Hadir', w: 198, align: 'left' },
    { key: 'kelas', label: 'Kelas', w: 78, align: 'center' },
    { key: 'subjek', label: 'Subjek', w: 80, align: 'center' },
    { key: 'masa', label: 'Masa', w: 132, align: 'center' },
    { key: 'ganti', label: 'Guru Ganti', w: contentW - wFix, align: 'left' },
  ];

  const ROW_PAD = 3;
  const HEAD_H = 20;
  const bottomLimit = pageH - 46;

  function headerDokumen() {
    if (fs.existsSync(LOGO)) {
      try {
        doc.image(LOGO, ML, 32, { fit: [56, 60] });
      } catch {
        /* abaikan jika logo gagal */
      }
    }
    const tx = ML + 70;
    doc.fillColor(HIJAU_GELAP).font('Helvetica-Bold').fontSize(20).text('JADUAL WAKTU GURU GANTI', tx, 34);
    doc.fillColor(TEKS).font('Helvetica-Bold').fontSize(10.5).text(`Tarikh: ${fmtTarikh(tarikhDate)} (${hari})`, tx, 60);
    doc.fillColor('#445b54').font('Helvetica-Bold').fontSize(10.5).text(namaSekolah, tx, 75);

    doc.moveTo(ML, 98).lineTo(pageW - MR, 98).strokeColor(GARIS).lineWidth(1).stroke();

    const guruAbsen = new Set(baris.map((b) => b.guruTakHadir)).size;
    const slot = baris.length;
    const gantiPakai = new Set(
      baris.filter((b) => b.guruGanti && b.guruGanti !== TIADA).map((b) => String(b.guruGanti).toUpperCase())
    ).size;

    doc.font('Helvetica').fontSize(9).fillColor('#55665f');
    const teks = `Guru Tidak Hadir: ${guruAbsen}        Slot Relief: ${slot}        Guru Ganti Digunakan: ${gantiPakai}        Dijana Oleh: ${dijanaOleh || '-'}        Masa Jana: ${fmtMasaJana(masaJana)}`;
    doc.text(teks, ML, 106, { width: contentW });
    return 120;
  }

  function headerJadual(y) {
    doc.rect(ML, y, contentW, HEAD_H).fill(HIJAU);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9.5);
    let x = ML;
    for (const c of cols) {
      doc.text(c.label, x + 5, y + 6, { width: c.w - 10, align: c.align });
      x += c.w;
    }
    return y + HEAD_H;
  }

  function tinggiBaris(b) {
    const gi = gantiInfo(b);
    doc.font('Helvetica').fontSize(9.5);
    const hGuru = doc.heightOfString(b.guruTakHadir || '-', { width: cols[1].w - 10 });
    doc.font(gi.isMulti || gi.isTiada ? 'Helvetica-Bold' : 'Helvetica');
    const hGanti = doc.heightOfString(gi.text, { width: cols[5].w - 10 });
    return Math.max(14, hGuru, hGanti) + ROW_PAD * 2;
  }

  function drawGrid(top, bottom) {
    doc.strokeColor(GARIS).lineWidth(0.8);
    doc.rect(ML, top, contentW, bottom - top).stroke();
    let x = ML;
    for (let k = 0; k < cols.length - 1; k++) {
      x += cols[k].w;
      doc.moveTo(x, top).lineTo(x, bottom).stroke();
    }
  }

  // ── Kandungan ──
  let y = headerDokumen();

  // Ringkasan: Guru Menerima >1 Relief (hanya jika ada; relief automatik sahaja)
  if (multiList.length) {
    doc.fillColor(HIJAU_GELAP).font('Helvetica-Bold').fontSize(10).text('Guru Menerima >1 Relief:', ML, y);
    y = doc.y + 2;
    const teksMulti = multiList.map((m) => `\u2022  ${m.nama} (${m.count})`).join('        ');
    doc.fillColor(TEKS).font('Helvetica').fontSize(9.5).text(teksMulti, ML, y, { width: contentW });
    y = doc.y + 10;
  }

  if (baris.length === 0) {
    doc.font('Helvetica').fontSize(12).fillColor('#80958e');
    doc.text('Tiada slot relief untuk tarikh ini.', ML, y + 30, { width: contentW, align: 'center' });
  } else {
    let pageTableTop = y;
    y = headerJadual(y);
    doc.font('Helvetica').fontSize(9.5);

    baris.forEach((b, i) => {
      const rh = tinggiBaris(b);
      if (y + rh > bottomLimit) {
        drawGrid(pageTableTop, y);
        doc.addPage();
        y = 44;
        pageTableTop = y;
        y = headerJadual(y);
        doc.font('Helvetica').fontSize(9.5);
      }

      if (i % 2 === 1) doc.rect(ML, y, contentW, rh).fill(ZEBRA);
      doc.moveTo(ML, y + rh).lineTo(pageW - MR, y + rh).strokeColor('#e3ebe8').lineWidth(0.5).stroke();

      const gi = gantiInfo(b);
      const cells = {
        bil: String(i + 1),
        guru: b.guruTakHadir || '-',
        kelas: b.kelas || '-',
        subjek: b.subjek || '-',
        masa: fmtMasaAmPm(b.masa) || '-',
        ganti: gi.text,
      };
      let x = ML;
      for (const c of cols) {
        if (c.key === 'ganti') {
          doc.fillColor(gi.isKosong ? '#b42318' : gi.isTiada ? '#8a6d12' : TEKS);
          doc.font(gi.isTiada || gi.isMulti ? 'Helvetica-Bold' : 'Helvetica');
        } else {
          doc.fillColor(TEKS);
          doc.font(c.key === 'kelas' ? 'Helvetica-Bold' : 'Helvetica');
        }
        doc.fontSize(9.5).text(cells[c.key], x + 5, y + ROW_PAD, { width: c.w - 10, align: c.align });
        x += c.w;
      }
      y += rh;
    });

    drawGrid(pageTableTop, y);
  }

  // ── PERTUKARAN KELAS (SUKA SAMA SUKA) — seksyen tambahan ──
  // Slot yang diambil alih secara persetujuan (BUKAN relief). Hanya dipaparkan
  // jika ada data; jadual relief di atas TIDAK diubah.
  if (pertukaran && pertukaran.length) {
    const swFix = 30 + 44 + 78 + 90 + 130; // Bil+Slot+Kelas+Subjek+Masa
    const wAsal = 196; // Guru Asal
    const swCols = [
      { key: 'bil', label: 'Bil', w: 30, align: 'center' },
      { key: 'slot', label: 'Slot', w: 44, align: 'center' },
      { key: 'kelas', label: 'Kelas', w: 78, align: 'center' },
      { key: 'subjek', label: 'Subjek', w: 90, align: 'center' },
      { key: 'masa', label: 'Masa', w: 130, align: 'center' },
      { key: 'asal', label: 'Guru Asal', w: wAsal, align: 'left' },
      { key: 'ganti', label: 'Guru Ambil Alih', w: contentW - swFix - wAsal, align: 'left' },
    ];

    const swTajuk = (yy) => {
      doc.fillColor(HIJAU_GELAP).font('Helvetica-Bold').fontSize(13)
        .text('PERTUKARAN KELAS (SUKA SAMA SUKA)', ML, yy);
      doc.fillColor('#55665f').font('Helvetica-Oblique').fontSize(8.5)
        .text('Kelas diambil alih secara persetujuan antara guru — bukan relief, tidak dijana semula.', ML, yy + 17);
      return yy + 32;
    };
    const swHeadJadual = (yy) => {
      doc.rect(ML, yy, contentW, HEAD_H).fill(HIJAU);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9.5);
      let x = ML;
      for (const c of swCols) { doc.text(c.label, x + 5, yy + 6, { width: c.w - 10, align: c.align }); x += c.w; }
      return yy + HEAD_H;
    };
    const swGrid = (top, bottom) => {
      doc.strokeColor(GARIS).lineWidth(0.8);
      doc.rect(ML, top, contentW, bottom - top).stroke();
      let x = ML;
      for (let k = 0; k < swCols.length - 1; k++) { x += swCols[k].w; doc.moveTo(x, top).lineTo(x, bottom).stroke(); }
    };

    // Jarak selepas jadual relief; halaman baharu jika ruang tak cukup.
    y += 22;
    if (y + 32 + HEAD_H + 18 > bottomLimit) { doc.addPage(); y = 44; }
    y = swTajuk(y);
    let swTop = y;
    y = swHeadJadual(y);

    pertukaran.forEach((p, i) => {
      const wGanti = contentW - swFix - wAsal;
      doc.font('Helvetica').fontSize(9.5);
      const hAsal = doc.heightOfString(p.guruAsal || '-', { width: wAsal - 10 });
      doc.font('Helvetica-Bold').fontSize(9.5);
      const hGanti = doc.heightOfString(p.guruGanti || '-', { width: wGanti - 10 });
      const rh = Math.max(14, hAsal, hGanti) + ROW_PAD * 2;

      if (y + rh > bottomLimit) {
        swGrid(swTop, y);
        doc.addPage();
        y = 44;
        swTop = y;
        y = swHeadJadual(y);
      }

      if (i % 2 === 1) doc.rect(ML, y, contentW, rh).fill(ZEBRA);
      doc.moveTo(ML, y + rh).lineTo(pageW - MR, y + rh).strokeColor('#e3ebe8').lineWidth(0.5).stroke();

      const cells = {
        bil: String(i + 1),
        slot: p.slot || '-',
        kelas: p.kelas || '-',
        subjek: p.subjek || '-',
        masa: fmtMasaAmPm(p.masa) || '-',
        asal: p.guruAsal || '-',
        ganti: p.guruGanti || '-',
      };
      let x = ML;
      for (const c of swCols) {
        const isGanti = c.key === 'ganti';
        doc.fillColor(isGanti ? HIJAU_GELAP : TEKS);
        doc.font(c.key === 'kelas' || isGanti ? 'Helvetica-Bold' : 'Helvetica');
        doc.fontSize(9.5).text(cells[c.key], x + 5, y + ROW_PAD, { width: c.w - 10, align: c.align });
        x += c.w;
      }
      y += rh;
    });
    swGrid(swTop, y);
  }

  // ── Tandatangan (muka surat akhir) ──
  if (y > pageH - 110) {
    doc.addPage();
    y = 60;
  }
  const sigY = pageH - 92;
  doc.strokeColor('#33433d').lineWidth(0.8);
  doc.moveTo(ML, sigY).lineTo(ML + 220, sigY).stroke();
  doc.moveTo(pageW - MR - 220, sigY).lineTo(pageW - MR, sigY).stroke();
  doc.fillColor(TEKS).font('Helvetica').fontSize(10);
  doc.text('Disediakan oleh', ML, sigY + 6, { width: 220, align: 'center' });
  doc.text('Disahkan oleh (Pengetua)', pageW - MR - 220, sigY + 6, { width: 220, align: 'center' });

  // ── Footer setiap muka surat: nota + nombor ──
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#8a9a94');
    doc.text(
      'Dokumen dijana secara automatik oleh Sistem Auto Jana Jadual Guru Ganti',
      ML,
      pageH - 30,
      { width: contentW - 140, align: 'left', lineBreak: false }
    );
    doc.font('Helvetica').fontSize(8).fillColor('#55665f');
    doc.text(`Muka surat ${i - range.start + 1} / ${range.count}`, pageW - MR - 140, pageH - 30, {
      width: 140,
      align: 'right',
    });
  }

  doc.end();
}
