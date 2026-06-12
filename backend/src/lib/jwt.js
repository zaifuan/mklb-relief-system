// ════════════════════════════════════════════════════════════
//  JWT helper — jana & sahkan token. Secret & tempoh dari .env.
// ════════════════════════════════════════════════════════════

import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

if (!SECRET) {
  console.warn('⚠️  JWT_SECRET tidak ditetapkan dalam .env — sila tetapkan sebelum guna auth.');
}

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token) {
  // Membaling ralat jika token tidak sah atau tamat tempoh
  return jwt.verify(token, SECRET);
}
