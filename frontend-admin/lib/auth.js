// Pengurusan token dalam cookie biasa:
// - dibaca oleh middleware.js untuk guard laluan
// - dihantar sebagai header Bearer oleh lib/api.js

const TOKEN_KEY = 'token';
const MAX_AGE = 8 * 60 * 60; // 8 jam, sama dengan JWT_EXPIRES_IN

export function setToken(token) {
  const secure =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`;
}

export function getToken() {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + TOKEN_KEY + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

export function clearToken() {
  document.cookie = `${TOKEN_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
}
