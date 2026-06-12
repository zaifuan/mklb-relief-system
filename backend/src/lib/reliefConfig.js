// ════════════════════════════════════════════════════════════
//  reliefConfig.js — muat CONFIG enjin relief dari pangkalan data.
//
//  Dalam GAS, nilai ini hardcode dalam objek CONFIG (main.gs). Di sini
//  ia dibaca dari DB supaya boleh diubah tanpa deploy semula:
//    • KATEGORI_EXEMPT      ← teacher_categories.isReliefExempt = true
//    • NAMA_EXEMPT          ← system_settings['nama_exempt'] (Json array)
//    • SEKATAN_KHAS         ← special_restrictions (isActive = true)
//    • hadDefault           ← system_settings['relief_had_default']        (1)
//    • thresholdPass2       ← system_settings['threshold_pass2']           (10)
//    • tier2MaxSlotMengajar ← system_settings['tier2_max_slot_mengajar']   (2)
//
//  Nilai seed sepadan dengan pemalar GAS asal → tingkah laku 100% sama.
// ════════════════════════════════════════════════════════════

import prisma from '../lib/prisma.js';

const norm = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');

// Baca satu setting Json → nombor (dengan fallback)
function bacaNombor(map, key, fallback) {
  const v = map[key];
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function loadReliefConfig() {
  const [kategoriExempt, sekatanRows, settingRows] = await Promise.all([
    prisma.teacherCategory.findMany({ where: { isReliefExempt: true } }),
    prisma.specialRestriction.findMany({ where: { isActive: true } }),
    prisma.systemSetting.findMany({
      where: {
        key: {
          in: ['nama_exempt', 'relief_had_default', 'threshold_pass2', 'tier2_max_slot_mengajar'],
        },
      },
    }),
  ]);

  const settingMap = {};
  for (const r of settingRows) settingMap[r.key] = r.value;

  // KATEGORI_EXEMPT — senarai nama kategori (uppercase)
  const KATEGORI_EXEMPT = kategoriExempt.map((c) => norm(c.nama));

  // NAMA_EXEMPT — Json array nama penuh guru (uppercase, normalize ruang)
  let NAMA_EXEMPT = [];
  const ne = settingMap['nama_exempt'];
  if (Array.isArray(ne)) NAMA_EXEMPT = ne.map(norm);

  // SEKATAN_KHAS — selaras struktur yang dijangka adaSekatanKhas()
  //   { nama, hari: [..], mulaDari, mulaHingga }
  const SEKATAN_KHAS = sekatanRows.map((s) => ({
    nama: s.target, // nama penuh ATAU "LELAKI"
    hari: (s.hariList || []).map((h) => String(h).trim().toUpperCase()),
    mulaDari: s.masaDari,
    mulaHingga: s.masaHingga,
  }));

  return {
    KATEGORI_EXEMPT,
    NAMA_EXEMPT,
    SEKATAN_KHAS,
    hadDefault: bacaNombor(settingMap, 'relief_had_default', 1),
    thresholdPass2: bacaNombor(settingMap, 'threshold_pass2', 10),
    tier2MaxSlotMengajar: bacaNombor(settingMap, 'tier2_max_slot_mengajar', 2),
  };
}
