// Pembungkus fetch untuk endpoint awam borang ketidakhadiran.
const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* tiada badan JSON */
  }

  if (!res.ok) {
    const err = new Error(data?.mesej || `Ralat ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  options: () => request('/api/absence/public/options'),
  submit: (payload) => request('/api/absence', { method: 'POST', body: payload }),
  check: (guruNama, tarikh) =>
    request(`/api/absence/public/check?guruNama=${encodeURIComponent(guruNama)}&tarikh=${encodeURIComponent(tarikh)}`),
  cancel: (id, guruNama) =>
    request(`/api/absence/public/${id}/cancel`, { method: 'PATCH', body: { guruNama } }),
};
