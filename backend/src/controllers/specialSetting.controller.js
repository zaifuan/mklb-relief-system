// ════════════════════════════════════════════════════════════
//  Controller: specialSetting (Tetapan Khas Jadual — harian)
//  TEACHER_EXCLUSION / CLASS_EXCLUSION / PRIORITY_CLASS untuk satu tarikh.
//  Akses: SUPER_ADMIN + ADMIN (sama seperti jana relief).
// ════════════════════════════════════════════════════════════

import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { writeAudit, getClientIp } from '../lib/audit.js';
import { masaKeMinitAuto } from '../lib/absenceWindow.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function tarikhKeUtc(s) {
  if (!DATE_RE.test(String(s || ''))) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const isFreeKelas = (k) => {
  const u = String(k || '').trim().toUpperCase();
  return u === 'FREE' || u === '' || u === '-';
};

// GET /api/special-settings/options → senarai guru & kelas untuk dropdown
export async function options(req, res) {
  try {
    const [teachers, schedules] = await Promise.all([
      prisma.teacher.findMany({ orderBy: { nama: 'asc' }, select: { nama: true } }),
      prisma.teacherSchedule.findMany({ select: { kelas: true }, distinct: ['kelas'] }),
    ]);
    const kelasSet = new Set();
    for (const s of schedules) {
      const k = String(s.kelas || '').trim();
      if (!isFreeKelas(k)) kelasSet.add(k);
    }
    const classes = [...kelasSet].sort((a, b) => a.localeCompare(b, 'ms', { numeric: true }));
    res.json({ teachers: teachers.map((t) => t.nama), classes });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}

// GET /api/special-settings?tarikh=YYYY-MM-DD → dikumpulkan ikut jenis
export async function list(req, res) {
  try {
    const tarikhStr = String(req.query.tarikh || '').trim();
    const tarikhDate = tarikhKeUtc(tarikhStr);
    if (!tarikhDate) return res.status(400).json({ mesej: 'Tarikh tidak sah' });

    const rows = await prisma.dailySpecialSetting.findMany({
      where: { tarikh: tarikhDate },
      orderBy: { id: 'asc' },
      select: { id: true, jenis: true, target: true, scope: true, masaMula: true, masaTamat: true },
    });

    res.json({
      tarikh: tarikhStr,
      teacherExclusions: rows.filter((r) => r.jenis === 'TEACHER_EXCLUSION'),
      classExclusions: rows.filter((r) => r.jenis === 'CLASS_EXCLUSION'),
      priorityClasses: rows.filter((r) => r.jenis === 'PRIORITY_CLASS'),
    });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}

const addSchema = z
  .object({
    tarikh: z.string().regex(DATE_RE, 'Tarikh tidak sah'),
    jenis: z.enum(['TEACHER_EXCLUSION', 'CLASS_EXCLUSION', 'PRIORITY_CLASS']),
    target: z.string().trim().min(1).optional(),
    targets: z.array(z.string().trim().min(1)).optional(),
    scope: z.enum(['FULL_DAY', 'TIME_RANGE']).default('FULL_DAY'),
    masaMula: z.string().trim().optional(),
    masaTamat: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.target && !(val.targets && val.targets.length)) {
      ctx.addIssue({ path: ['target'], code: 'custom', message: 'Sila pilih sekurang-kurangnya satu guru atau kelas' });
    }
    if (val.scope === 'TIME_RANGE') {
      if (!val.masaMula || masaKeMinitAuto(val.masaMula) === null) {
        ctx.addIssue({ path: ['masaMula'], code: 'custom', message: 'Masa mula tidak sah' });
      }
      if (val.masaTamat && masaKeMinitAuto(val.masaTamat) === null) {
        ctx.addIssue({ path: ['masaTamat'], code: 'custom', message: 'Masa tamat tidak sah' });
      }
      const m = val.masaMula ? masaKeMinitAuto(val.masaMula) : null;
      const t = val.masaTamat ? masaKeMinitAuto(val.masaTamat) : null;
      if (m !== null && t !== null && t <= m) {
        ctx.addIssue({ path: ['masaTamat'], code: 'custom', message: 'Masa tamat mesti selepas masa mula' });
      }
    }
  });

// POST /api/special-settings → tambah (single `target` atau multi `targets`),
// dengan scope FULL_DAY / TIME_RANGE. Idempotent ikut (tarikh, jenis, target).
export async function add(req, res) {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ mesej: 'Data tidak sah', isu: parsed.error.flatten().fieldErrors });
  }
  try {
    const { tarikh, jenis, scope } = parsed.data;
    const tarikhDate = tarikhKeUtc(tarikh);

    const rawList = parsed.data.targets?.length ? parsed.data.targets : parsed.data.target ? [parsed.data.target] : [];
    const targets = [...new Set(rawList.map((t) => t.trim()).filter(Boolean))];
    if (targets.length === 0) return res.status(400).json({ mesej: 'Sila pilih guru atau kelas' });

    const isRange = scope === 'TIME_RANGE';
    const masaMula = isRange ? parsed.data.masaMula.trim() : null;
    const masaTamat = isRange ? parsed.data.masaTamat?.trim() || null : null; // null = Tamat sekolah

    const items = [];
    for (const target of targets) {
      const row = await prisma.dailySpecialSetting.upsert({
        where: { tarikh_jenis_target: { tarikh: tarikhDate, jenis, target } },
        update: { scope, masaMula, masaTamat },
        create: { tarikh: tarikhDate, jenis, target, scope, masaMula, masaTamat },
        select: { id: true, jenis: true, target: true, scope: true, masaMula: true, masaTamat: true },
      });
      items.push(row);
    }

    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'SPECIAL_SETTING_ADD',
      entity: 'SPECIAL_SETTING',
      detail: { tarikh, jenis, scope, masaMula, masaTamat, targets },
      ip: getClientIp(req),
    });
    res.status(201).json({ success: true, dicipta: items.length, items });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}

// DELETE /api/special-settings/:id → padam satu tetapan
export async function remove(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ mesej: 'ID tidak sah' });
    const existing = await prisma.dailySpecialSetting.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ mesej: 'Tetapan tidak dijumpai' });

    await prisma.dailySpecialSetting.delete({ where: { id } });
    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'SPECIAL_SETTING_DELETE',
      entity: 'SPECIAL_SETTING',
      detail: { id, jenis: existing.jenis, target: existing.target },
      ip: getClientIp(req),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}
