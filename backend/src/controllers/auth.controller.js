// ════════════════════════════════════════════════════════════
//  Controller: auth
//  login / logout / me
// ════════════════════════════════════════════════════════════

import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { signToken } from '../lib/jwt.js';
import { writeAudit, getClientIp } from '../lib/audit.js';

const loginSchema = z.object({
  username: z.string().min(1, 'Username diperlukan'),
  password: z.string().min(1, 'Kata laluan diperlukan'),
});

// POST /api/auth/login
export async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      mesej: 'Sila isi username dan kata laluan',
      isu: parsed.error.flatten().fieldErrors,
    });
  }

  const { username, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { username: username.trim() },
    include: { role: true, adminAssignment: true },
  });

  // Mesej generik untuk elak enumerasi akaun
  const gagal = () => res.status(401).json({ mesej: 'Username atau kata laluan salah' });

  if (!user || !user.isActive) return gagal();

  const sah = await bcrypt.compare(password, user.passwordHash);
  if (!sah) return gagal();

  const token = signToken({
    sub: user.id,
    username: user.username,
    role: user.role.nama,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  await writeAudit({
    userId: user.id,
    action: 'LOGIN',
    entity: 'AUTH',
    detail: { username: user.username, role: user.role.nama },
    ip: getClientIp(req),
  });

  res.json({
    token,
    user: {
      id: user.id,
      nama: user.nama,
      username: user.username,
      role: user.role.nama,
      hariBertugas: user.adminAssignment?.hariBertugas ?? null,
    },
  });
}

// POST /api/auth/logout  (authenticate dahulu)
export async function logout(req, res) {
  await writeAudit({
    userId: req.user?.id ?? null,
    action: 'LOGOUT',
    entity: 'AUTH',
    detail: req.user ? { username: req.user.username } : null,
    ip: getClientIp(req),
  });
  res.json({ mesej: 'Log keluar berjaya' });
}

// GET /api/auth/me  (authenticate dahulu)
export async function me(req, res) {
  const u = req.user;
  res.json({
    id: u.id,
    nama: u.nama,
    username: u.username,
    role: u.role.nama,
    permissions: u.role.permissions ?? {},
    hariBertugas: u.adminAssignment?.hariBertugas ?? null,
    lastLogin: u.lastLogin,
  });
}
