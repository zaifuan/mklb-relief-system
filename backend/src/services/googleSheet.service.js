// ════════════════════════════════════════════════════════════
//  googleSheet.service — sambungan Google Sheets API (baca sahaja)
//  Auth: Service Account JWT (jsonwebtoken) → akses token OAuth2.
//  Tiada dependency baharu (guna jsonwebtoken + fetch terbina Node 20).
// ════════════════════════════════════════════════════════════

import jwt from 'jsonwebtoken';
import { SHEET_ID, HEADER_ROW, normalizeHeader } from './sheetConfig.js';

const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const SA_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

let cachedToken = null; // { token, exp (saat) }

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  if (!SA_EMAIL || !SA_KEY) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY belum ditetapkan dalam .env');
  }

  const assertion = jwt.sign(
    { iss: SA_EMAIL, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
    SA_KEY,
    { algorithm: 'RS256' }
  );

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gagal dapatkan token Google (${res.status}): ${t}`);
  }

  const data = await res.json();
  cachedToken = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return cachedToken.token;
}

// Baca satu tab → { headers: [..], rows: [{HEADER: nilai}, ..] }
export async function fetchTab(tabName) {
  if (!SHEET_ID) throw new Error('GOOGLE_SHEET_ID belum ditetapkan dalam .env');

  const token = await getAccessToken();
  const range = `${tabName}!A1:Z`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}` +
    `/values/${encodeURIComponent(range)}?majorDimension=ROWS`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gagal baca tab "${tabName}" (${res.status}): ${t}`);
  }

  const data = await res.json();
  const values = data.values || [];
  if (values.length < HEADER_ROW) return { headers: [], rows: [] };

  const headers = (values[HEADER_ROW - 1] || []).map(normalizeHeader);
  const dataRows = values.slice(HEADER_ROW);

  const rows = dataRows.map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = (r[i] ?? '').toString().trim();
    });
    return obj;
  });

  return { headers, rows };
}
