// ════════════════════════════════════════════════════════════
//  Middleware: authorize(...roles)
//  Contoh: authorize('SUPER_ADMIN')
//          authorize('SUPER_ADMIN', 'ADMIN')
//  Mesti digunakan SELEPAS authenticate.
// ════════════════════════════════════════════════════════════

export function authorize(...allowedRoles) {
  return (req, res, next) => {
    const role = req.userRole || req.user?.role?.nama;

    if (!role) {
      return res.status(401).json({ mesej: 'Tidak dibenarkan' });
    }

    if (allowedRoles.length && !allowedRoles.includes(role)) {
      return res.status(403).json({ mesej: 'Akses ditolak: peranan tidak mencukupi' });
    }

    next();
  };
}
