export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  [key: string]: unknown;
}

const BASE = '/api';

let refreshing: Promise<boolean> | null = null;

const doRefresh = (): Promise<boolean> =>
  fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false);

/**
 * Renews the session. Calls from one tab share a single request, and a browser-wide lock keeps other tabs from
 * rotating the refresh token at the same moment (the loser would present a used token and get logged out).
 */
const refreshSession = (): Promise<boolean> => {
  if (!refreshing) {
    const run = navigator.locks ? (navigator.locks.request('rwc-refresh', doRefresh) as unknown as Promise<boolean>) : doRefresh();
    refreshing = run.finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
};

/** Auth calls never trigger a refresh (login, refresh itself...) except /auth/me, which restores a session after a reload. */
const canRefresh = (path: string) => !path.startsWith('/auth/') || path === '/auth/me';

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
  retry = true
): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  // Access token expired: refresh once, then retry the original request.
  if (res.status === 401 && retry && canRefresh(path)) {
    if (await refreshSession()) return api<T>(path, options, false);
  }

  const json = (await res.json().catch(() => ({}))) as ApiResponse<T>;
  if (!res.ok) throw new ApiError(json.message ?? 'Something went wrong', res.status);
  return json;
}

/** Upload a file as the raw request body (used for admin image uploads). */
export async function apiUpload<T = unknown>(path: string, file: File, retry = true): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': file.type },
    body: file
  });
  if (res.status === 401 && retry && (await refreshSession())) return apiUpload<T>(path, file, false);

  const json = (await res.json().catch(() => ({}))) as ApiResponse<T>;
  if (!res.ok) throw new ApiError(json.message ?? 'Upload failed', res.status);
  return json;
}
