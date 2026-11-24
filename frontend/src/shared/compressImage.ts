import { api } from './api/apiClient';

/** The server accepts about 650 KB of picture per report, so screenshots are shrunk in the browser first. */
const MAX_BYTES = 640_000;

const toBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsDataURL(blob);
  });

/**
 * Sends the picture straight to storage with a one-time address from the server, and returns its key. Returns null when the server
 * is not set up for direct upload (or the upload could not be made), and the picture is then sent inside the request instead.
 */
async function uploadDirect(blob: Blob): Promise<string | null> {
  try {
    const r = await api<{ direct: boolean; url?: string; key?: string }>('/uploads/sign', { method: 'POST', body: { mime: blob.type, size: blob.size } });
    if (!r.data?.direct || !r.data.url || !r.data.key) return null;
    const put = await fetch(r.data.url, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob });
    return put.ok ? r.data.key : null;
  } catch {
    return null;
  }
}

/**
 * Shrinks a picture to fit under `maxBytes` (a square-ish picture no bigger than `maxSide` pixels), as base64 JPEG for the server.
 * Used for profile photos, which may weigh at most 100 KB.
 */
export async function shrinkImage(file: File, maxBytes = 100 * 1024, maxSide = 512): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a picture (PNG, JPG or WebP).');
  if (file.size > 15_000_000) throw new Error('That file is too big. Choose a smaller picture.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That file is not a picture we can read.'));
      el.src = url;
    });
    let scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    for (let attempt = 0; attempt < 8; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Your browser cannot prepare this picture.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', Math.max(0.45, 0.85 - attempt * 0.07)));
      if (blob && blob.size <= maxBytes) return toBase64(blob);
      scale *= 0.8;
    }
    throw new Error('We could not make that picture small enough. Try another one.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Videos go straight to storage (they are too big for a normal request). Needs storage to be set up on the server. */
const MAX_VIDEO = 100_000_000;
const VIDEO_EXT: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', '3gp': 'video/3gpp', mpg: 'video/mpeg', mpeg: 'video/mpeg', flv: 'video/x-flv', ogv: 'video/ogg' };

/** The video type of a file: what the browser says, or (when it says nothing) what its name says. Null if it is not a video. */
export function videoTypeOf(file: File): string | null {
  if (file.type.startsWith('video/')) return file.type;
  if (file.type === '') return VIDEO_EXT[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
  return null;
}

async function uploadVideo(file: File, type: string): Promise<string> {
  if (file.size > MAX_VIDEO) throw new Error('That video is too large. The most is 100 MB.');
  const r = await api<{ direct: boolean; url?: string; key?: string }>('/uploads/sign', { method: 'POST', body: { mime: type, size: file.size } });
  if (!r.data?.direct || !r.data.url || !r.data.key) throw new Error('Video upload is not available right now. Send a photo instead.');
  const put = await fetch(r.data.url, { method: 'PUT', headers: { 'Content-Type': type }, body: file });
  if (!put.ok) throw new Error('The video could not be uploaded. Check your connection and try again.');
  return r.data.key;
}

/** A photo is shrunk and sent; a video is uploaded straight to storage. Either way the result goes into the request. */
export async function prepareProof(file: File): Promise<{ fileName: string; fileData?: string; fileKey?: string }> {
  const video = videoTypeOf(file);
  if (video) return { fileName: file.name.slice(0, 120), fileKey: await uploadVideo(file, video) };
  return compressImage(file);
}

export async function compressImage(file: File): Promise<{ fileName: string; fileData?: string; fileKey?: string }> {
  if (!file.type.startsWith('image/')) throw new Error('Upload a screenshot (PNG, JPG or WebP).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That file is not a picture we can read.'));
      el.src = url;
    });

    let scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Your browser cannot prepare this picture.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', Math.max(0.5, 0.82 - attempt * 0.06)));
      if (blob && blob.size <= MAX_BYTES) {
        const fileName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
        const fileKey = await uploadDirect(blob);
        return fileKey ? { fileName, fileKey } : { fileName, fileData: await toBase64(blob) };
      }
      scale *= 0.75;
    }
    throw new Error('That picture is too large. Try a smaller screenshot.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
