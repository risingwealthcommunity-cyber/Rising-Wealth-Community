import type { ReactNode } from 'react';

/** Small stroke icons for the app shell (no icon library needed). */
const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

export const Icon = {
  dashboard: svg(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  book: svg(<><path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h10" /></>),
  trophy: svg(<><path d="M8 4h8v5a4 4 0 0 1-8 0z" /><path d="M8 6H5a2 2 0 0 0 2 4M16 6h3a2 2 0 0 1-2 4M12 13v4M8 20h8M10 17h4" /></>),
  users: svg(<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 5.3a3 3 0 0 1 0 5.4M18 14.8c1.8.7 3 2.4 3 5.2" /></>),
  plus: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>),
  star: svg(<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z" />),
  bars: svg(<path d="M5 20V10M12 20V4M19 20v-7" />),
  calendar: svg(<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  bolt: svg(<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />),
  wallet: svg(<><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><rect x="4" y="8" width="16" height="11" rx="2.5" /><circle cx="16" cy="13.5" r="1.2" /></>),
  shield: svg(<path d="M12 3 5 6v5.5c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6z" />),
  logout: svg(<><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="M15 8l4 4-4 4M19 12H9" /></>),
  menu: svg(<path d="M4 7h16M4 12h16M4 17h16" />),
  chevron: svg(<path d="m7 10 5 5 5-5" />),
  key: svg(<><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2 2" /></>)
};
