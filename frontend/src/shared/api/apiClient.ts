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

const refreshSession = (): Promise<boolean> => {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
};

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
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
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
