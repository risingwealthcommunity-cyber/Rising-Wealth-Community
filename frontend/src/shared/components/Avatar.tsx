import type { ReactNode } from 'react';

/** The preset avatars a member can choose from. Keys are stored on the account (a1..a12). */
type HairStyle = 'short' | 'long' | 'bun' | 'curly' | 'bald' | 'mohawk' | 'spiky' | 'slick' | 'afro' | 'bob';
type Gear = 'none' | 'shades' | 'headphones' | 'beard' | 'glasses' | 'cap' | 'hood' | 'earring';

interface Preset {
  bg: [string, string];
  skin: string;
  hair: string;
  shirt: string;
  style: HairStyle;
  gear: Gear[];
}

const PRESETS: Record<string, Preset> = {
  a1: { bg: ['#6ee7f9', '#3b82f6'], skin: '#f1c9a5', hair: '#1f1a17', shirt: '#111827', style: 'slick', gear: ['shades'] },
  a2: { bg: ['#f9a8d4', '#a855f7'], skin: '#e0a982', hair: '#1b1512', shirt: '#be185d', style: 'long', gear: ['headphones'] },
  a3: { bg: ['#86efac', '#16a34a'], skin: '#8d5a3c', hair: '#0f0d0c', shirt: '#14532d', style: 'afro', gear: ['shades'] },
  a4: { bg: ['#fde68a', '#f59e0b'], skin: '#f6d6b8', hair: '#92400e', shirt: '#374151', style: 'bun', gear: ['glasses'] },
  a5: { bg: ['#c4b5fd', '#6366f1'], skin: '#c68863', hair: '#241a14', shirt: '#312e81', style: 'short', gear: ['hood'] },
  a6: { bg: ['#67e8f9', '#0e7490'], skin: '#5e3b27', hair: '#0b0a0a', shirt: '#0f766e', style: 'mohawk', gear: ['earring'] },
  a7: { bg: ['#fdba74', '#ea580c'], skin: '#f1c9a5', hair: '#b45309', shirt: '#7c2d12', style: 'bob', gear: ['shades'] },
  a8: { bg: ['#e5e7eb', '#6b7280'], skin: '#d9a47e', hair: '#e5e7eb', shirt: '#1f2937', style: 'short', gear: ['beard'] },
  a9: { bg: ['#bef264', '#65a30d'], skin: '#8d5a3c', hair: '#1a1210', shirt: '#3f6212', style: 'spiky', gear: ['headphones'] },
  a10: { bg: ['#fca5a5', '#dc2626'], skin: '#e0a982', hair: '#2b2118', shirt: '#991b1b', style: 'short', gear: ['cap'] },
  a11: { bg: ['#93c5fd', '#1d4ed8'], skin: '#f6d6b8', hair: '#3a2a1a', shirt: '#1e3a8a', style: 'curly', gear: ['glasses', 'beard'] },
  a12: { bg: ['#9ca3af', '#111827'], skin: '#c68863', hair: '#0f0d0c', shirt: '#000000', style: 'bald', gear: ['shades', 'beard'] }
};

export const AVATAR_KEYS = Object.keys(PRESETS);

function hair(p: Preset): ReactNode {
  const c = p.hair;
  switch (p.style) {
    case 'long':
      return (
        <>
          <path d="M27 48c-2-20 8-31 23-31s25 11 23 31v26H67V46H33v28H27z" fill={c} />
          <path d="M32 44c3-9 10-14 18-14s15 5 18 14c-6-3-11-4-18-4s-12 1-18 4z" fill={c} />
        </>
      );
    case 'bob':
      return (
        <>
          <path d="M29 56c-3-22 5-36 21-36s24 14 21 36c-2 3-6 3-8 0V44H37v12c-2 3-6 3-8 0z" fill={c} />
        </>
      );
    case 'bun':
      return (
        <>
          <circle cx="50" cy="18" r="9" fill={c} />
          <path d="M31 44c0-11 8-18 19-18s19 7 19 18c-5-5-11-8-19-8s-14 3-19 8z" fill={c} />
        </>
      );
    case 'curly':
      return (
        <g fill={c}>
          <circle cx="34" cy="35" r="8" />
          <circle cx="43" cy="27" r="9" />
          <circle cx="57" cy="27" r="9" />
          <circle cx="66" cy="35" r="8" />
          <circle cx="50" cy="31" r="10" />
        </g>
      );
    case 'afro':
      return (
        <g fill={c}>
          <circle cx="50" cy="32" r="24" />
          <circle cx="30" cy="42" r="10" />
          <circle cx="70" cy="42" r="10" />
        </g>
      );
    case 'mohawk':
      return <path d="M44 34c-1-10 1-20 6-24 5 4 7 14 6 24z" fill={c} />;
    case 'spiky':
      return <path d="M31 42l2-14 7 8 4-14 6 12 6-12 4 14 7-8 2 14c-5-6-11-9-19-9s-14 3-19 9z" fill={c} />;
    case 'slick':
      return <path d="M30 44c-1-14 8-24 21-24 12 0 20 8 19 24-3-9-9-14-19-14-8 0-17 4-21 14z" fill={c} />;
    case 'bald':
      return null;
    default:
      return <path d="M30 44c0-12 8-20 20-20s20 8 20 20c-4-7-10-10-20-10s-16 3-20 10z" fill={c} />;
  }
}

function gear(p: Preset): ReactNode {
  return p.gear.map((g) => {
    switch (g) {
      case 'shades':
        return (
          <g key={g}>
            <rect x="33" y="42" width="14" height="9" rx="3" fill="#0b0f19" />
            <rect x="53" y="42" width="14" height="9" rx="3" fill="#0b0f19" />
            <path d="M47 46h6" stroke="#0b0f19" strokeWidth="2" />
            <path d="M36 44l5 0" stroke="#ffffff" strokeOpacity=".45" strokeWidth="1.6" strokeLinecap="round" />
          </g>
        );
      case 'glasses':
        return (
          <g key={g} fill="none" stroke="#111827" strokeWidth="1.8">
            <circle cx="42" cy="47" r="6.5" />
            <circle cx="58" cy="47" r="6.5" />
            <path d="M48.5 47h3" />
          </g>
        );
      case 'headphones':
        return (
          <g key={g}>
            <path d="M29 48c-3-24 10-32 21-32s24 8 21 32" fill="none" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
            <rect x="24" y="44" width="9" height="16" rx="4" fill="#0f172a" />
            <rect x="67" y="44" width="9" height="16" rx="4" fill="#0f172a" />
            <rect x="26" y="48" width="3" height="8" rx="1.5" fill="#38bdf8" />
            <rect x="71" y="48" width="3" height="8" rx="1.5" fill="#38bdf8" />
          </g>
        );
      case 'beard':
        return <path key={g} d="M32 52c0 14 8 20 18 20s18-6 18-20c-3 5-8 7-18 7s-15-2-18-7z" fill={p.hair} opacity=".95" />;
      case 'cap':
        return (
          <g key={g}>
            <path d="M30 38c0-12 8-19 20-19s20 7 20 19z" fill="#111827" />
            <path d="M28 38h50c0 3-4 4-8 4H31c-2 0-3-1-3-4z" fill="#111827" />
            <circle cx="50" cy="25" r="2" fill="#f8fafc" />
          </g>
        );
      case 'earring':
        return <circle key={g} cx="32" cy="55" r="2.4" fill="#fbbf24" />;
      default:
        return null;
    }
  });
}

/** A round avatar: the chosen preset, or the member's initials when none is set. */
export function Avatar({ avatar, name, size = 64 }: { avatar?: string | null; name: string; size?: number }) {
  // a member's own photo: the server sets this address, it is never typed in
  if (avatar && avatar.includes('/api/site/assets/avatar-')) {
    return <img src={avatar} alt={name} width={size} height={size} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block' }} loading="lazy" decoding="async" />;
  }
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
  const gid = `avbg-${avatar}`;
  const hooded = p.gear.includes('hood');
  return (
    <svg className="avatar-svg" width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Avatar">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={p.bg[0]} />
          <stop offset="1" stopColor={p.bg[1]} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${gid})`} />
      {/* back hair sits behind the head */}
      {(p.style === 'long' || p.style === 'bob' || p.style === 'afro') && hair(p)}
      <path d="M12 100c2-22 16-32 38-32s36 10 38 32z" fill={p.shirt} />
      {hooded && <path d="M30 76c6 6 14 9 20 9s14-3 20-9c-2-8-8-12-20-12s-18 4-20 12z" fill={p.shirt} stroke="#ffffff" strokeOpacity=".18" />}
      <rect x="44" y="58" width="12" height="14" rx="4" fill={p.skin} />
      <ellipse cx="50" cy="46" rx="18" ry="20" fill={p.skin} />
      <circle cx="32" cy="48" r="3.2" fill={p.skin} />
      <circle cx="68" cy="48" r="3.2" fill={p.skin} />
      {p.style !== 'long' && p.style !== 'bob' && p.style !== 'afro' && hair(p)}
      {p.style === 'long' || p.style === 'bob' || p.style === 'afro' ? <ellipse cx="50" cy="46" rx="18" ry="20" fill={p.skin} /> : null}
      {p.style === 'long' || p.style === 'bob' || p.style === 'afro' ? <FrontHair p={p} /> : null}
      {!p.gear.includes('shades') && (
        <>
          <circle cx="43" cy="47" r="1.9" fill="#1b1512" />
          <circle cx="57" cy="47" r="1.9" fill="#1b1512" />
        </>
      )}
      <path d="M43 56c3 3.5 11 3.5 14 0" stroke="#1b1512" strokeWidth="1.9" fill="none" strokeLinecap="round" />
      {gear(p)}
    </svg>
  );
}

/** Fringe drawn over the face for styles whose back hair sits behind the head. */
function FrontHair({ p }: { p: Preset }) {
  if (p.style === 'afro') return <path d="M32 40c3-9 10-13 18-13s15 4 18 13c-5-4-11-6-18-6s-13 2-18 6z" fill={p.hair} />;
  return <path d="M31 44c2-10 9-15 19-15s17 5 19 15c-5-5-11-7-19-7s-14 2-19 7z" fill={p.hair} />;
}
