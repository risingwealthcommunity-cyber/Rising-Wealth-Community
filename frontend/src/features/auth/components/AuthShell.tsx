import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { CheckIcon } from './Icons';
import './auth.css';

const POINTS = ['Free to start as a Trainee', 'A transparent wallet, team and payout history', 'Passive levels, pools and rank rewards as you grow'];

interface Props {
  title: string;
  subtitle?: ReactNode;
  /** Round icon shown above the title (status screens). */
  icon?: ReactNode;
  /** Rotate the icon (loading state). */
  spin?: boolean;
  children: ReactNode;
  /** Small line under the card, for example "New here? Create account". */
  footer?: ReactNode;
}

/** Two-pane layout for every auth page: brand panel on the left, the form card on the right. */
export default function AuthShell({ title, subtitle, icon, spin, children, footer }: Props) {
  return (
    <div className="au">
      <aside className="au-brand">
        <div className="au-brand-top">
          <Link to="/" className="au-logo">
            <img src="/logo.png" alt="" width={46} height={46} />
            <span>
              Rising Wealth
              <small>Community</small>
            </span>
          </Link>
          <Link to="/" className="au-back">
            {'←'} Home
          </Link>
        </div>

        <div className="au-brand-body">
          <h2 className="au-headline">
            Empowering
            <span>Financial</span>
            Growth
          </h2>
          <ul className="au-points">
            {POINTS.map((p) => (
              <li key={p}>
                <CheckIcon size={18} />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="au-notes" aria-hidden="true">
          <span className="au-note n1">{'₹'}</span>
          <span className="au-note n2">{'₹'}</span>
        </div>

        <div className="au-brand-foot">
          {'©'} {new Date().getFullYear()} Rising Wealth Community
        </div>
      </aside>

      <main className="au-main">
        <div className="au-card">
          {icon && <div className={`au-icon${spin ? ' spin' : ''}`}>{icon}</div>}
          <div className="au-head">
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {children}
        </div>
        {footer && <div className="au-foot">{footer}</div>}
      </main>
    </div>
  );
}
