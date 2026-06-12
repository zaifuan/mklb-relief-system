// ════════════════════════════════════════════════════════════
//  Middleware: authenticate
//  Sahkan header Authorization: Bearer <token>, muat user segar.
// ════════════════════════════════════════════════════════════

import { verifyToken } from '../lib/jwt.js';
import prisma from '../lib/prisma.js';

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

    if (!token) {
      return res.status(401).json({ mesej: 'Tidak dibenarkan: token tiada' });
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return res.status(401).json({ mesej: 'Sesi tamat atau token tidak sah' });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true, adminAssignment: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ mesej: 'Akaun tidak aktif atau tidak wujud' });
    }

    req.user = user;
    req.userRole = user.role?.nama;
    next();
  } catch (err) {
    res.status(500).json({ mesej: 'Ralat pengesahan', error: err.message });
  }
}
