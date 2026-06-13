// ════════════════════════════════════════════════════════════
//  Controller: accounts (Tetapan Akaun — SUPER_ADMIN sahaja)
//  Urus dua akaun umum: SUPER_ADMIN & ADMIN (username + kata laluan).
//  Kata laluan kekal hashing bcrypt sedia ada; tidak simpan plaintext.
// ════════════════════════════════════════════════════════════

import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { writeAudit, getClientIp } from '../lib/audit.js';

const USERNAME_RE = /^[a-z0-9_]+$/;

const akaunSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, 'Username wajib diisi')
    .regex(USERNAME_RE, 'Username hanya boleh mengandungi huruf kecil, nombor, dan underscore (_)'),
  password: z.string().optional(), // kosong = kekal kata laluan lama
});

const updateSchema = z.object({
  superAdmin: akaunSchema,
  admin: akaunSchema,
});

// Akaun aktif mengikut peranan (satu akaun umum setiap peranan)
async function activeByRole(nama) {
  return prisma.user.findFirst({
    where: { isActive: true, role: { nama } },
    orderBy: { id: 'asc' },
    include: { role: true },
  });
}

// GET /api/admin/accounts  → username sahaja (kata laluan tidak pernah dihantar)
export async function getAccounts(req, res) {
  try {
    const [su, ad] = await Promise.all([activeByRole('SUPER_ADMIN'), activeByRole('ADMIN')]);
    res.json({
      superAdmin: su ? { id: su.id, username: su.username } : null,
      admin: ad ? { id: ad.id, username: ad.username } : null,
    });
  } catch (err) {
    res.status(500).json({ mesej: err.message });
  }
}

// PATCH /api/admin/accounts  → kemas kini username/kata laluan kedua-dua akaun
export async function updateAccounts(req, res) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ mesej: 'Data tidak sah', isu: parsed.error.flatten().fieldErrors });
  }

  try {
    const [su, ad] = await Promise.all([activeByRole('SUPER_ADMIN'), activeByRole('ADMIN')]);
    if (!su || !ad) return res.status(404).json({ mesej: 'Akaun Super Admin atau Admin tidak dijumpai.' });

    const suUser = parsed.data.superAdmin.username.trim();
    const adUser = parsed.data.admin.username.trim();

    if (suUser.toLowerCase() === adUser.toLowerCase()) {
      return res.status(409).json({ mesej: 'Username Super Admin dan Admin tidak boleh sama.' });
    }

    // Pertembungan dengan akaun LAIN (selain dua akaun umum ini)
    for (const uname of [suUser, adUser]) {
      const bentrok = await prisma.user.findFirst({
        where: { username: uname, id: { notIn: [su.id, ad.id] } },
        select: { id: true },
      });
      if (bentrok) return res.status(409).json({ mesej: `Username "${uname}" telah digunakan akaun lain.` });
    }

    // Kata laluan kosong → kekal (tidak diubah)
    const suData = { username: suUser };
    if (parsed.data.superAdmin.password && parsed.data.superAdmin.password.length > 0) {
      suData.passwordHash = await bcrypt.hash(parsed.data.superAdmin.password, 10);
    }
    const adData = { username: adUser };
    if (parsed.data.admin.password && parsed.data.admin.password.length > 0) {
      adData.passwordHash = await bcrypt.hash(parsed.data.admin.password, 10);
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: su.id }, data: suData }),
      prisma.user.update({ where: { id: ad.id }, data: adData }),
    ]);

    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'ACCOUNT_UPDATE',
      entity: 'AUTH',
      detail: {
        superAdmin: { username: suUser, passwordChanged: !!suData.passwordHash },
        admin: { username: adUser, passwordChanged: !!adData.passwordHash },
      },
      ip: getClientIp(req),
    });

    res.json({
      success: true,
      mesej: 'Akaun berjaya dikemas kini.',
      superAdmin: { username: suUser },
      admin: { username: adUser },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ mesej: 'Username telah digunakan. Sila guna username lain.' });
    }
    res.status(500).json({ mesej: err.message });
  }
}
