// src/lib/api.js
// Central API client — all fetch calls go through here.
// In Docker: nginx proxies /api/* → backend container, so we use a relative path.
// In local dev: set VITE_API_URL=http://localhost:8000/api/v1 in frontend/.env.local

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';
// In Docker nginx proxies /ws → worker-standard:8001. Derive from window.location so it always
// works regardless of protocol (ws vs wss) and host.
const _wsProto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
const _wsHost  = typeof window !== 'undefined' ? window.location.host : 'localhost:5173';
const WS_BASE  = import.meta.env.VITE_WS_URL  || `${_wsProto}://${_wsHost}/ws`;

// ── Token management ──────────────────────────────────────
let _token = localStorage.getItem('access_token') || null;

export const setToken = (t) => { _token = t; localStorage.setItem('access_token', t); };
export const clearToken = () => { _token = null; localStorage.removeItem('access_token'); };
export const getToken = () => _token;

// ── Request helper ────────────────────────────────────────
async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      window.location.href = '/login';
    }
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export const api = {
  get:    (path)         => request(path),
  post:   (path, body)   => request(path, { method: 'POST',   body: JSON.stringify(body) }),
  patch:  (path, body)   => request(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete: (path)         => request(path, { method: 'DELETE' }),
};

// ── WebSocket singleton ───────────────────────────────────
let _ws = null;
let _handlers = new Set();

export function connectWS() {
  if (_ws && _ws.readyState <= 1) return; // already open or connecting
  _ws = new WebSocket(WS_BASE);
  _ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      _handlers.forEach(h => h(msg));
    } catch { /* ignore malformed messages */ }
  };
  _ws.onclose = () => setTimeout(connectWS, 3000); // auto-reconnect
}

export function onWSMessage(handler) {
  _handlers.add(handler);
  return () => _handlers.delete(handler); // returns cleanup fn
}

// ── Auth ──────────────────────────────────────────────────
export const auth = {
  signup: (email, password, full_name) => api.post('/auth/signup', { email, password, full_name }),
  login:  async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    setToken(data.access_token);
    return data;
  },
  logout: () => clearToken(),
  me: ()     => api.get('/auth/me'),
};

// ── Organizations ─────────────────────────────────────────
export const orgs = {
  list: (page = 1, page_size = 50) =>
    api.get(`/orgs?page=${page}&page_size=${page_size}`),
  get:    (id)       => api.get(`/orgs/${id}`),
  create: (body)     => api.post('/orgs', body),
  update: (id, body) => api.patch(`/orgs/${id}`, body),
  delete: (id)       => api.delete(`/orgs/${id}`),
};

// ── Projects ──────────────────────────────────────────────
export const projects = {
  list:   (orgId, page = 1) =>
    api.get(`/orgs/${orgId}/projects?page=${page}&page_size=50`),
  get:    (orgId, id)       => api.get(`/orgs/${orgId}/projects/${id}`),
  create: (orgId, body)     => api.post(`/orgs/${orgId}/projects`, body),
  update: (orgId, id, body) => api.patch(`/orgs/${orgId}/projects/${id}`, body),
  delete: (orgId, id)       => api.delete(`/orgs/${orgId}/projects/${id}`),
  stats:  (orgId, id)       => api.get(`/orgs/${orgId}/projects/${id}/stats`),
};

// ── Queues ────────────────────────────────────────────────
export const queues = {
  list:   (orgId, projectId, page = 1) =>
    api.get(`/orgs/${orgId}/projects/${projectId}/queues?page=${page}&page_size=50`),
  get:    (orgId, projectId, id)       =>
    api.get(`/orgs/${orgId}/projects/${projectId}/queues/${id}`),
  create: (orgId, projectId, body)     =>
    api.post(`/orgs/${orgId}/projects/${projectId}/queues`, body),
  update: (orgId, projectId, id, body) =>
    api.patch(`/orgs/${orgId}/projects/${projectId}/queues/${id}`, body),
  pause:  (orgId, projectId, id) =>
    api.patch(`/orgs/${orgId}/projects/${projectId}/queues/${id}`, { is_paused: true }),
  resume: (orgId, projectId, id) =>
    api.patch(`/orgs/${orgId}/projects/${projectId}/queues/${id}`, { is_paused: false }),
};

// ── Jobs ──────────────────────────────────────────────────
export const jobs = {
  list:   (queueId, params = {}) => {
    const q = new URLSearchParams({ page: 1, page_size: 50, ...params }).toString();
    return api.get(`/queues/${queueId}/jobs?${q}`);
  },
  get:    (queueId, jobId)  => api.get(`/queues/${queueId}/jobs/${jobId}`),
  create: (queueId, body)   => api.post(`/queues/${queueId}/jobs`, body),
  batch:  (queueId, jobs)   => api.post(`/queues/${queueId}/jobs/batch`, { jobs }),
  cancel: (queueId, jobId)  => api.post(`/queues/${queueId}/jobs/${jobId}/cancel`),
  // Returns a raw fetch Response for file download (not JSON)
  exportLogs: (queueId, jobId, format) => {
    const headers = { 'Content-Type': 'application/json' };
    if (_token) headers['Authorization'] = `Bearer ${_token}`;
    return fetch(`${API_BASE}/queues/${queueId}/jobs/${jobId}/logs/export?format=${format}`, { headers });
  },
};

// ── DLQ ──────────────────────────────────────────────────
export const dlq = {
  list:  (queueId, page = 1) => api.get(`/dlq/queues/${queueId}/dlq?page=${page}&page_size=50`),
  retry: (dlqId)             => api.post(`/dlq/${dlqId}/retry`),
};

// ── Workers ───────────────────────────────────────────────
export const workers = {
  list: (page = 1) => api.get(`/workers?page=${page}&page_size=50`),
};

// ── Health ────────────────────────────────────────────────
export const health = {
  system: () => api.get('/health/system'),
  throughput: () => api.get('/health/throughput'),
};

// ── Members ───────────────────────────────────────────────
export const members = {
  list: (orgId) => api.get(`/orgs/${orgId}/members`),
  create: (orgId, body) => api.post(`/orgs/${orgId}/members`, body),
};
