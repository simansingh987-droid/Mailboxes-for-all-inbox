const TOKEN_KEY = 'acm-token';

export const auth = {
  get: () => {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  },
  set: (t) => {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
  },
};

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

export async function api(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    signal,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(auth.get() && { Authorization: `Bearer ${auth.get()}` }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/login') onUnauthorized();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const attachmentUrl = (id, index, inline) =>
  `/api/messages/${encodeURIComponent(id)}/attachments/${index}?token=${encodeURIComponent(auth.get())}${inline ? '&inline=1' : ''}`;

export const eventsUrl = () => `/api/events?token=${encodeURIComponent(auth.get())}`;

export const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
