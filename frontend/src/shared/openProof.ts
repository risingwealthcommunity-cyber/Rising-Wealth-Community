import { api } from './api/apiClient';

/** Opens a proof picture in a new tab. It is fetched with the signed-in session, so only people allowed to see it can. */
export async function openProofAt(path: string): Promise<void> {
  const r = await api<{ mime: string; data: string }>(path);
  if (!r.data) return;
  const bytes = Uint8Array.from(atob(r.data.data), (c) => c.charCodeAt(0));
  window.open(URL.createObjectURL(new Blob([bytes], { type: r.data.mime })), '_blank', 'noopener');
}
