// ════════════════════════════════════════════════════════════
//  Audit helper — tulis rekod ke jadual audit_logs.
//  Tidak menggagalkan permintaan utama jika gagal log.
//  K04-S: pulangkan true/false supaya pemanggil boleh MELAPORKAN kegagalan
//  (pemanggil sedia ada mengabaikan nilai pulangan — tingkah laku tidak berubah).
// ════════════════════════════════════════════════════════════

import prisma from './prisma.js';

export async function writeAudit({ userId = null, action, entity = null, detail = null, ip = null }) {
  try {
    await prisma.auditLog.create({
      data: { userId, action, entity, detail, ip },
    });
    return true;
  } catch (err) {
    console.error('AuditLog gagal ditulis:', err.message);
    return false;
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
