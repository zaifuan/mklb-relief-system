// ════════════════════════════════════════════════════════════
//  Audit helper — tulis rekod ke jadual audit_logs.
//  Tidak menggagalkan permintaan utama jika gagal log.
// ════════════════════════════════════════════════════════════

import prisma from './prisma.js';

export async function writeAudit({ userId = null, action, entity = null, detail = null, ip = null }) {
  try {
    await prisma.auditLog.create({
      data: { userId, action, entity, detail, ip },
    });
  } catch (err) {
    console.error('AuditLog gagal ditulis:', err.message);
  }
}

// Dapatkan IP sebenar klien (mengambil kira Cloudflare / reverse proxy)
export function getClientIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.ip ||
    null
  );
}
