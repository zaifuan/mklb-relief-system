// ════════════════════════════════════════════════════════════
//  absenceWindow.js — julat masa tidak hadir untuk SEPARUH_HARI.
//  Fungsi TULEN (tiada I/O) → mudah diuji unit; diguna oleh enjin relief.
//
//  Konsep: separuh hari = JULAT [masaMula, masaTamat).
//    • SEPANJANG_HARI            → [0, 1440)  (sepanjang hari)
//    • SEPARUH_HARI + masaMula   → [masaMula, masaTamat || 1440)
//    • masaTamat null/kosong     → "Tamat sekolah" = 1440
//  Guru hanya "tidak hadir" dalam julat ini:
//    - slot yang BERTINDIH julat sahaja perlu diganti
//    - guru itu hanya dikecualikan sebagai guru ganti dalam julat ini
//  Fallback selamat: SEPARUH_HARI tanpa masaMula sah → [0,1440] (sepanjang hari)
//  supaya tidak tersilap anggap "hadir" sedangkan data tak lengkap.
// ════════════════════════════════════════════════════════════

import { masaKeMinit, masaBertindih } from './timeUtil.js';

const HUJUNG_HARI = 1440; // 24:00 dalam minit ("Tamat sekolah")

// Parser masa fleksibel → minit dari tengah malam.
//   • "HH:MM" (24-jam, kolon)      → borang baharu: "07:00", "15:00"
//   • format sekolah (titik, kuirk 12-jam) → rekod lama: "8.00", "1.00"
//   Kedua-dua menghasilkan minit MUTLAK yang sama (cth "15:00" = "3.00" = 900),
//   jadi perbandingan dengan masa slot jadual (format sekolah) kekal tepat.
export function masaKeMinitAuto(masa) {
  if (!masa) return null;
  const s = String(masa).trim();
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const h = +m24[1];
    const mi = +m24[2];
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }
  return masaKeMinit(s); // fallback: format sekolah (kuirk 12-jam)
}

export function julatTidakHadir(jenis, masaMula, masaTamat) {
  if (String(jenis || '').toUpperCase() !== 'SEPARUH_HARI') {
    return { masaMula: 0, masaTamat: HUJUNG_HARI };
  }
  const m = masaKeMinitAuto(masaMula);
  if (m === null) {
    // separuh hari tanpa masa sah → anggap sepanjang hari (selamat)
    return { masaMula: 0, masaTamat: HUJUNG_HARI };
  }
  const t = masaTamat ? masaKeMinitAuto(masaTamat) : null;
  return { masaMula: m, masaTamat: t !== null && t > m ? t : HUJUNG_HARI };
}

// true jika slot [sMula,sTamat) bertindih julat tidak hadir.
export function slotDalamJulat(sMula, sTamat, julat) {
  if (sMula === null || sTamat === null) return false;
  return masaBertindih(sMula, sTamat, julat.masaMula, julat.masaTamat);
}

export { HUJUNG_HARI };
