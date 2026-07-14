// ════════════════════════════════════════════════════════════
//  Controller: specialRestriction (Sekatan Khas Relief — halaman Super Admin)
//  SSOT tunggal untuk sekatan relief KEKAL (menggantikan KATEGORI_EXEMPT /
//  NAMA_EXEMPT / magic target "LELAKI" — lihat reliefConfig.js & audit).
//  Akses: SUPER_ADMIN SAHAJA (bukan ADMIN — lihat routes).
// ════════════════════════════════════════════════════════════

import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { writeAudit, getClientIp } from '../lib/audit.js';
import { masaKeMinitAuto } from '../lib/absenceWindow.js';
import { normalkanMasa } from '../lib/timeUtil.js';
import { ALL_HARI, sortHari, sameHariSet } from '../lib/hariUtil.js';

const restrictionSchema = z
  .object({
    teacherId: z.coerce.number().int().positive({ message: 'Sila pilih guru' }),
    restrictionType: z.enum(['FULL_WEEK', 'SPECIFIC_DAYS', 'SPECIFIC_TIME'], {
      errorMap: () => ({ message: 'Jenis sekatan tidak sah' }),
    }),
    hariList: z.array(z.enum(ALL_HARI)).optional().default([]),
    masaDari: z.string().trim().optional().nullable(),
    masaHingga: z.string().trim().optional().nullable(),
    catatan: z.string().trim().max(500).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.restrictionType !== 'FULL_WEEK' && (!val.hariList || val.hariList.length === 0)) {
      ctx.addIssue({ path: ['hariList'], code: 'custom', message: 'Sila pilih sekurang-kurangnya satu hari' });
    }
    if (val.restrictionType === 'SPECIFIC_TIME') {
      const m = val.masaDari ? masaKeMinitAuto(val.masaDari) : null;
      const t = val.masaHingga ? masaKeMinitAuto(val.masaHingga) : null;
      if (!val.masaDari || m === null) {
        ctx.addIssue({ path: ['masaDari'], code: 'custom', message: 'Masa mula tidak sah' });
      }
      if (!val.masaHingga || t === null) {
        ctx.addIssue({ path: ['masaHingga'], code: 'custom', message: 'Masa tamat tidak sah' });
      }
      if (m !== null && t !== null && t <= m) {
        ctx.addIssue({ path: ['masaHingga'], code: 'custom', message: 'Masa tamat mesti selepas masa mula' });
      }
    }
  });

// Paksa bentuk kanonik ikut jenis — tidak kira apa client hantar untuk
// medan yang tidak relevan (mis. hari/masa untuk FULL_WEEK diabaikan).
function canonicalizeByType(data) {
  if (data.restrictionType === 'FULL_WEEK') {
    return { hariList: [], masaDari: null, masaHingga: null };
  }
  const hari = sortHari(data.hariList || []);
  if (data.restrictionType === 'SPECIFIC_DAYS') {
    return { hariList: hari, masaDari: null, masaHingga: null };
  }
  return { hariList: hari, masaDari: normalkanMasa(data.masaDari), masaHingga: normalkanMasa(data.masaHingga) };
}

// Cari sekatan AKTIF sedia ada yang SAMA TEPAT (guru+jenis+hari+masa).
async function findDuplicate({ teacherId, restrictionType, hariList, masaDari, masaHingga, excludeId }) {
  const candidates = await prisma.specialRestriction.findMany({
    where: { teacherId, restrictionType, isActive: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  return candidates.find(
    (c) => sameHariSet(c.hariList, hariList) && c.masaDari === masaDari && c.masaHingga === masaHingga
  );
}

// GET /api/special-restrictions/options → guru AKTIF sahaja, utk dropdown searchable
export async function options(req, res) {
  try {
    const teachers = await prisma.teacher.findMany({
      where: { isActive: true },
      orderBy: { nama: 'asc' },
      select: { id: true, nama: true },
    });
    res.json({ teachers });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}

// GET /api/special-restrictions → SEMUA (aktif + tidak aktif), utk jadual Super Admin
export async function list(req, res) {
  try {
    const rows = await prisma.specialRestriction.findMany({
      orderBy: [{ isActive: 'desc' }, { id: 'asc' }],
      include: { teacher: { select: { nama: true, isActive: true } } },
    });
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        teacherId: r.teacherId,
        nama: r.teacher?.nama || r.target,
        teacherActive: r.teacher ? r.teacher.isActive : null, // null = rekod warisan tanpa padanan Teacher
        restrictionType: r.restrictionType,
        hariList: r.hariList,
        masaDari: r.masaDari,
        masaHingga: r.masaHingga,
        isActive: r.isActive,
        catatan: r.catatan,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}

// POST /api/special-restrictions
export async function create(req, res) {
  const parsed = restrictionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ mesej: 'Data tidak sah', isu: parsed.error.flatten().fieldErrors });
  }
  try {
    const { teacherId, restrictionType, catatan } = parsed.data;
    const teacher = await prisma.teacher.findUnique({ where: { id: teacherId } });
    if (!teacher) return res.status(404).json({ mesej: 'Guru tidak dijumpai' });
    if (!teacher.isActive) {
      return res.status(400).json({ mesej: 'Guru ini tidak aktif — tidak boleh menambah sekatan baharu' });
    }

    const canon = canonicalizeByType(parsed.data);
    const dup = await findDuplicate({ teacherId, restrictionType, ...canon });
    if (dup) {
      return res.status(409).json({ mesej: 'Sekatan yang sama tepat (guru, jenis, hari, waktu) sudah wujud dan aktif' });
    }

    const row = await prisma.specialRestriction.create({
      data: { teacherId, target: teacher.nama, restrictionType, ...canon, catatan: catatan || null },
    });

    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'SPECIAL_RESTRICTION_ADD',
      entity: 'SPECIAL_RESTRICTION',
      detail: { id: row.id, teacherId, nama: teacher.nama, restrictionType, ...canon },
      ip: getClientIp(req),
    });
    res.status(201).json({ success: true, item: row });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}

// PATCH /api/special-restrictions/:id
export async function update(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ mesej: 'ID tidak sah' });

  const parsed = restrictionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ mesej: 'Data tidak sah', isu: parsed.error.flatten().fieldErrors });
  }
  try {
    const existing = await prisma.specialRestriction.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ mesej: 'Sekatan tidak dijumpai' });

    const { teacherId, restrictionType, catatan } = parsed.data;
    const teacher = await prisma.teacher.findUnique({ where: { id: teacherId } });
    if (!teacher) return res.status(404).json({ mesej: 'Guru tidak dijumpai' });
    if (!teacher.isActive) {
      return res.status(400).json({ mesej: 'Guru ini tidak aktif — tidak boleh menetapkan sekatan kepadanya' });
    }

    const canon = canonicalizeByType(parsed.data);
    const dup = await findDuplicate({ teacherId, restrictionType, ...canon, excludeId: id });
    if (dup) {
      return res.status(409).json({ mesej: 'Sekatan yang sama tepat (guru, jenis, hari, waktu) sudah wujud dan aktif' });
    }

    const row = await prisma.specialRestriction.update({
      where: { id },
      data: { teacherId, target: teacher.nama, restrictionType, ...canon, catatan: catatan || null },
    });

    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'SPECIAL_RESTRICTION_UPDATE',
      entity: 'SPECIAL_RESTRICTION',
      detail: { id, teacherId, nama: teacher.nama, restrictionType, ...canon },
      ip: getClientIp(req),
    });
    res.json({ success: true, item: row });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}

async function setActive(req, res, isActive) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ mesej: 'ID tidak sah' });
  try {
    const existing = await prisma.specialRestriction.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ mesej: 'Sekatan tidak dijumpai' });

    if (isActive && existing.teacherId) {
      const dup = await findDuplicate({
        teacherId: existing.teacherId,
        restrictionType: existing.restrictionType,
        hariList: existing.hariList,
        masaDari: existing.masaDari,
        masaHingga: existing.masaHingga,
        excludeId: id,
      });
      if (dup) {
        return res.status(409).json({ mesej: 'Tidak boleh aktifkan — sekatan sama tepat sudah aktif bagi guru ini' });
      }
    }

    const row = await prisma.specialRestriction.update({ where: { id }, data: { isActive } });
    await writeAudit({
      userId: req.user?.id ?? null,
      action: isActive ? 'SPECIAL_RESTRICTION_ACTIVATE' : 'SPECIAL_RESTRICTION_DEACTIVATE',
      entity: 'SPECIAL_RESTRICTION',
      detail: { id },
      ip: getClientIp(req),
    });
    res.json({ success: true, item: row });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}

// PATCH /api/special-restrictions/:id/activate
export async function activate(req, res) {
  return setActive(req, res, true);
}

// PATCH /api/special-restrictions/:id/deactivate
export async function deactivate(req, res) {
  return setActive(req, res, false);
}

// DELETE /api/special-restrictions/:id
export async function remove(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ mesej: 'ID tidak sah' });
    const existing = await prisma.specialRestriction.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ mesej: 'Sekatan tidak dijumpai' });

    await prisma.specialRestriction.delete({ where: { id } });
    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'SPECIAL_RESTRICTION_DELETE',
      entity: 'SPECIAL_RESTRICTION',
      detail: { id, target: existing.target, restrictionType: existing.restrictionType },
      ip: getClientIp(req),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}
