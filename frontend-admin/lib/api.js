import { getToken, clearToken } from './auth.js';

// Base = ORIGIN backend (tanpa /api). Laluan di bawah sudah termasuk /api.
// Ujian lokal: http://localhost:4000 · Prod (Fasa 9): https://adminjadual.byzaifuan.com
const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* tiada badan JSON */
  }

  if (!res.ok) {
    if (res.status === 401) clearToken();
    const err = new Error(data?.mesej || `Ralat ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

// Muat turun binari (cth: PDF) dengan auth. Pulang Blob.
async function requestBlob(path, { auth = true } = {}) {
  const headers = {};
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, { method: 'GET', headers });
  if (!res.ok) {
    if (res.status === 401) clearToken();
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* tiada JSON */
    }
    const err = new Error(data?.mesej || `Ralat ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.blob();
}

function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  login: (username, password) =>
    request('/api/auth/login', { method: 'POST', body: { username, password }, auth: false }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),

  accounts: {
    get: () => request('/api/admin/accounts'),
    update: (payload) => request('/api/admin/accounts', { method: 'PATCH', body: payload }),
  },

  specialSettings: {
    options: () => request('/api/special-settings/options'),
    list: (tarikh) => request(`/api/special-settings?tarikh=${encodeURIComponent(tarikh)}`),
    create: (payload) => request('/api/special-settings', { method: 'POST', body: payload }),
    remove: (id) => request(`/api/special-settings/${id}`, { method: 'DELETE' }),
  },

  // Pilihan awam (senarai guru + label sebab/jenis) untuk dropdown penapis
  publicOptions: () => request('/api/absence/public/options', { auth: false }),

  // Dashboard ketidakhadiran (Fasa 5)
  adminAbsence: {
    list: (params) => request(`/api/admin/absence${qs(params)}`),
    summary: () => request('/api/admin/absence/summary'),
    get: (id) => request(`/api/admin/absence/${id}`),
    updateStatus: (id, status) =>
      request(`/api/admin/absence/${id}/status`, { method: 'PATCH', body: { status } }),
    cancelGroup: (groupReference) =>
      request(`/api/admin/absence/group/${encodeURIComponent(groupReference)}/cancel`, { method: 'PATCH' }),
    remove: (id) => request(`/api/admin/absence/${id}`, { method: 'DELETE' }),
  },

  // Jadual Relief (Fasa 6 jana + Fasa 7 semakan)
  relief: {
    get: (tarikh) => request(`/api/relief/${tarikh}`),
    generate: (tarikh) => request('/api/relief/generate', { method: 'POST', body: { tarikh } }),
    confirm: (id) => request(`/api/relief/assignment/${id}/confirm`, { method: 'PATCH' }),
    cancel: (id) => request(`/api/relief/assignment/${id}/cancel`, { method: 'PATCH' }),
    updateTeacher: (id, guruGanti) =>
      request(`/api/relief/assignment/${id}/teacher`, { method: 'PATCH', body: { guruGanti } }),
    confirmAll: (tarikh) => request(`/api/relief/${tarikh}/confirm-all`, { method: 'PATCH' }),
    pdf: (tarikh) => requestBlob(`/api/relief/${tarikh}/pdf`),
  },

  // Telegram snapshot ketidakhadiran (Fasa 8) + tetapan/status (Fasa 7)
  telegram: {
    preview: (tarikh) => request(`/api/telegram/snapshot/preview${qs({ tarikh })}`),
    send: (tarikh) => request('/api/telegram/snapshot/send', { method: 'POST', body: { tarikh } }),
    settings: {
      get: () => request('/api/telegram/settings'),
      update: (body) => request('/api/telegram/settings', { method: 'PATCH', body }),
    },
    status: () => request('/api/telegram/status'),
  },

  // Sync Google Sheet (master data) — run hanya SUPER_ADMIN
  sync: {
    run: () => request('/api/sync/run', { method: 'POST' }),
    status: () => request('/api/sync/status'),
  },
};
