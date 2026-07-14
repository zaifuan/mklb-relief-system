// ════════════════════════════════════════════════════════════
//  reliefConfig.js — muat CONFIG enjin relief dari pangkalan data.
//
//    • SEKATAN_KHAS         ← special_restrictions (isActive = true) — SSOT TUNGGAL
//    • hadDefault           ← system_settings['relief_had_default']        (1)
//    • thresholdPass2       ← system_settings['threshold_pass2']           (10)
//    • tier2MaxSlotMengajar ← system_settings['tier2_max_slot_mengajar']   (2)
//
//  BERSARA (2026-07-14 — "Sekatan Khas Relief"): KATEGORI_EXEMPT
//  (teacher_categories.isReliefExempt) dan NAMA_EXEMPT (system_settings
//  ['nama_exempt']) TIDAK LAGI dibaca di sini. Kedua-duanya dikembalikan
//  sentiasa kosong supaya candidate.service.js (tidak diubah) kekal selamat.
//  Data lama sudah dimigrasikan kepada rekod special_restrictions individu
//  (jenis FULL_WEEK) — lihat prisma/migrateSpecialRestrictions.js.
//  Jangan tambah semula pembacaan isReliefExempt / nama_exempt di sini;
//  itu akan mewujudkan dua sumber sekatan aktif serentak (lihat audit).
// ════════════════════════════════════════════════════════════

import prisma from '../lib/prisma.js';
import { expandRestriction } from './restrictionExpansion.js';

export { expandRestriction };

// Baca satu setting Json → nombor (dengan fallback)
function bacaNombor(map, key, fallback) {
  const v = map[key];
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function loadReliefConfig() {
  const [sekatanRows, settingRows] = await Promise.all([
    prisma.specialRestriction.findMany({
      where: { isActive: true },
      include: { teacher: { select: { nama: true } } },
    }),
    prisma.systemSetting.findMany({
      where: { key: { in: ['relief_had_default', 'threshold_pass2', 'tier2_max_slot_mengajar'] } },
    }),
  ]);

  const settingMap = {};
  for (const r of settingRows) settingMap[r.key] = r.value;

  // SEKATAN_KHAS — satu-satunya sumber sekatan khas relief (Sekatan Khas Relief, Super Admin)
  const SEKATAN_KHAS = sekatanRows.map(expandRestriction);

  return {
    KATEGORI_EXEMPT: [], // BERSARA — kekal kosong (lihat nota atas)
    NAMA_EXEMPT: [], // BERSARA — kekal kosong (lihat nota atas)
    SEKATAN_KHAS,
    hadDefault: bacaNombor(settingMap, 'relief_had_default', 1),
    thresholdPass2: bacaNombor(settingMap, 'threshold_pass2', 10),
    tier2MaxSlotMengajar: bacaNombor(settingMap, 'tier2_max_slot_mengajar', 2),
  };
}
