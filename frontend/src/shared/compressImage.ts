/** The server accepts about 650 KB of picture per report, so screenshots are shrunk in the browser first. */
const MAX_BYTES = 640_000;

const toBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsDataURL(blob);
  });

export async function compressImage(file: File): Promise<{ fileName: string; fileData: string }> {
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
      if (blob && blob.size <= MAX_BYTES) return { fileName: file.name.replace(/\.[^.]+$/, '') + '.jpg', fileData: await toBase64(blob) };
      scale *= 0.75;
    }
    throw new Error('That picture is too large. Try a smaller screenshot.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
