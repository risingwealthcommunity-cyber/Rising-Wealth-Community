import * as THREE from 'three';

/**
 * All money artwork is drawn on a <canvas> at runtime, so the hero downloads no
 * image files at all (nothing to slow the page down).
 */

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return { c, g };
}

function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface NoteStyle {
  label: string; // "500"
  from: string;
  to: string;
  accent: string;
}

export const NOTE_STYLES: NoteStyle[] = [
  { label: '500', from: '#2b1d06', to: '#8c6514', accent: '#ffd966' },
  { label: '100', from: '#1f1604', to: '#70500e', accent: '#f6c64a' },
  { label: '2000', from: '#3a2808', to: '#b88a1e', accent: '#fff0a8' }
];

export function makeNoteTexture(style: NoteStyle): THREE.CanvasTexture {
  const W = 1024;
  const H = 448;
  const { c, g } = canvas(W, H);

  const base = g.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, style.from);
  base.addColorStop(1, style.to);
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);

  // Guilloche-style concentric line work.
  g.strokeStyle = 'rgba(255,228,150,0.14)';
  g.lineWidth = 1.2;
  for (const cx of [W * 0.24, W * 0.8]) {
    for (let r = 10; r < 430; r += 9) {
      g.beginPath();
      g.arc(cx, H * 0.5, r, 0, Math.PI * 2);
      g.stroke();
    }
  }

  // Frame.
  g.strokeStyle = style.accent;
  g.globalAlpha = 0.9;
  g.lineWidth = 6;
  g.strokeRect(18, 18, W - 36, H - 36);
  g.lineWidth = 2;
  g.strokeRect(34, 34, W - 68, H - 68);
  g.globalAlpha = 1;

  // Centre medallion with a rupee sign.
  g.beginPath();
  g.arc(W * 0.5, H * 0.5, 118, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = style.accent;
  g.stroke();
  g.fillStyle = style.accent;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 150px "Segoe UI", Arial, sans-serif';
  g.fillText('₹', W * 0.5, H * 0.52);

  // Denomination in the corners.
  g.font = '900 92px "Arial Black", Impact, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(style.label, 70, H - 70);
  g.textAlign = 'right';
  g.textBaseline = 'top';
  g.fillText(style.label, W - 70, 62);

  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = '700 26px "Courier New", monospace';
  g.globalAlpha = 0.8;
  g.fillText('RWC REWARD NOTE', W * 0.5, 82);
  g.globalAlpha = 1;

  return toTexture(c);
}

export function makeCoinTexture(): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = canvas(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 20, S / 2, S / 2, S / 2);
  grad.addColorStop(0, '#fff4c8');
  grad.addColorStop(1, '#e2b244');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);

  g.strokeStyle = '#8a5f00';
  g.lineWidth = 14;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 34, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 4;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 70, 0, Math.PI * 2);
  g.stroke();

  // Symmetric star emblem: reads correctly on both faces of a spinning coin.
  g.fillStyle = '#8a5f00';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 150 : 62;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const px = S / 2 + Math.cos(a) * r;
    const py = S / 2 + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
  return toTexture(c);
}

/** Transparent glowing rupee sign that sits on the big slab. */
export function makeRupeeTexture(): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = canvas(S, S);
  const grad = g.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, '#ffd24a');
  grad.addColorStop(1, '#e09a10');
  g.fillStyle = grad;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 400px "Segoe UI", Arial, sans-serif';
  g.shadowColor = 'rgba(224,160,20,0.4)';
  g.shadowBlur = 30;
  g.fillText('₹', S / 2, S / 2 + 16);
  return toTexture(c);
}
