import type { ReactNode } from 'react';

/** The preset avatars a member can choose from. Keys are stored on the account (a1..a12). */
interface Preset {
  bg: string;
  skin: string;
  hair: string;
  shirt: string;
  style: 'short' | 'long' | 'bun' | 'cap' | 'curly' | 'bald';
}

const PRESETS: Record<string, Preset> = {
  a1: { bg: '#dbe4f0', skin: '#f1c9a5', hair: '#2b2118', shirt: '#2f3a4a', style: 'short' },
  a2: { bg: '#f0dfe3', skin: '#e0a982', hair: '#1b1512', shirt: '#7a4455', style: 'long' },
  a3: { bg: '#dcebdd', skin: '#8d5a3c', hair: '#0f0d0c', shirt: '#2e5a43', style: 'curly' },
  a4: { bg: '#efe6d2', skin: '#f6d6b8', hair: '#8a5a2b', shirt: '#4a4f57', style: 'bun' },
  a5: { bg: '#e2dcf0', skin: '#c68863', hair: '#241a14', shirt: '#4b3f7a', style: 'cap' },
  a6: { bg: '#d9edf0', skin: '#5e3b27', hair: '#0b0a0a', shirt: '#1f6a73', style: 'short' },
  a7: { bg: '#f3e1d3', skin: '#f1c9a5', hair: '#a8472b', shirt: '#8a4a2b', style: 'long' },
  a8: { bg: '#e4e6ea', skin: '#d9a47e', hair: '#d9dde3', shirt: '#1f2937', style: 'short' },
  a9: { bg: '#e7efd5', skin: '#8d5a3c', hair: '#1a1210', shirt: '#59702a', style: 'bun' },
  a10: { bg: '#f1dcdc', skin: '#e0a982', hair: '#2b2118', shirt: '#9b3b3b', style: 'cap' },
  a11: { bg: '#dde3f4', skin: '#f6d6b8', hair: '#3a2a1a', shirt: '#33498f', style: 'curly' },
  a12: { bg: '#e3e3e3', skin: '#c68863', hair: '#0f0d0c', shirt: '#111827', style: 'bald' }
};

export const AVATAR_KEYS = Object.keys(PRESETS);

function hair(p: Preset): ReactNode {
  switch (p.style) {
    case 'long':
      return (
        <>
          <path d="M26 40c0-14 8-22 24-22s24 8 24 22v30H70V44H30v26H26z" fill={p.hair} />
          <path d="M30 42c4-9 12-13 20-13s16 4 20 13c-6-3-12-4-20-4s-14 1-20 4z" fill={p.hair} />
        </>
      );
    case 'bun':
      return (
        <>
          <circle cx="50" cy="19" r="9" fill={p.hair} />
          <path d="M31 42c0-10 8-16 19-16s19 6 19 16c-5-5-11-7-19-7s-14 2-19 7z" fill={p.hair} />
        </>
      );
    case 'cap':
      return (
        <>
          <path d="M30 40c0-11 8-18 20-18s20 7 20 18z" fill={p.shirt} />
          <path d="M28 40h46c0 3-3 4-6 4H30c-2 0-2-2-2-4z" fill={p.shirt} />
        </>
      );
    case 'curly':
      return (
        <g fill={p.hair}>
          <circle cx="34" cy="34" r="8" />
          <circle cx="44" cy="27" r="9" />
          <circle cx="57" cy="27" r="9" />
          <circle cx="66" cy="34" r="8" />
          <circle cx="50" cy="31" r="10" />
        </g>
      );
    case 'bald':
      return null;
    default:
      return <path d="M30 42c0-12 8-19 20-19s20 7 20 19c-4-6-10-9-20-9s-16 3-20 9z" fill={p.hair} />;
  }
}

/** A round avatar: the chosen preset, or the member's initials when none is set. */
export function Avatar({ avatar, name, size = 64 }: { avatar?: string | null; name: string; size?: number }) {
  const p = avatar ? PRESETS[avatar] : undefined;
  if (!p) {
    const text = name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
    return (
      <span className="avatar-initials" style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">
        {text}
      </span>
    );
  }
  return (
    <svg className="avatar-svg" width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Avatar">
      <rect width="100" height="100" fill={p.bg} />
      <path d="M14 100c2-20 16-30 36-30s34 10 36 30z" fill={p.shirt} />
      <rect x="44" y="58" width="12" height="14" rx="4" fill={p.skin} />
      <ellipse cx="50" cy="46" rx="18" ry="20" fill={p.skin} />
      {hair(p)}
      <circle cx="43" cy="47" r="1.8" fill="#1b1512" />
      <circle cx="57" cy="47" r="1.8" fill="#1b1512" />
      <path d="M44 56c3 3 9 3 12 0" stroke="#1b1512" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}
