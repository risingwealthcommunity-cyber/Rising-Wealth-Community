import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useAuth } from '../auth';
import { DEFAULT_CONTACT, useSiteContent } from '../site';
import AboutSection from './AboutSection';
import ContactSection from './ContactSection';
import CtaBanner from './CtaBanner';
import FeaturesSection from './FeaturesSection';
import Hero3D from './Hero3D';
import MilestonesSection from './MilestonesSection';
import ReviewsSection from './ReviewsSection';
import SiteFooter from './SiteFooter';
import TeamSection from './TeamSection';
import TypedWordmark from './TypedWordmark';
import { useSmoothScroll } from './useSmoothScroll';
import './landing.css';

const PLANS = [
  {
    name: 'Trainee',
    price: 'Free',
    note: 'Free entry. Earn from Demat referrals.',
    perks: ['Demat referral income', '5 passive levels on referrals', 'Team and wallet dashboard']
  },
  {
    name: 'PRO',
    price: '₹2,499',
    note: 'Package income, 7 passive levels and bonuses.',
    perks: ['35% direct income', 'Passive levels 1–7', 'Weekly and performance pools']
  },
  {
    name: 'ELITE',
    price: '₹4,999',
    note: 'All 12 passive levels and higher eligibility.',
    perks: ['35% direct income', 'Passive levels 1–12', 'Leadership pool and rank rewards'],
    featured: true
  }
];

export default function LandingPage() {
  const { user } = useAuth();
  const root = useRef<HTMLDivElement>(null);
  const { content, failed } = useSiteContent();
  useSmoothScroll(root);

  const contact = {
    ...DEFAULT_CONTACT,
    ...(content.contact ?? {}),
    // an empty saved key falls back to the .env one
    formKey: content.contact?.formKey || DEFAULT_CONTACT.formKey
  };
  const hasContact = Boolean(contact.phone || contact.whatsapp || contact.email);
  const hasTeam = (content.team?.length ?? 0) > 0;

  // The home page hides the browser scrollbar; app pages keep theirs.
  useEffect(() => {
    document.documentElement.classList.add('lp-no-scrollbar');
    return () => document.documentElement.classList.remove('lp-no-scrollbar');
  }, []);

  // Admin content (photos, team, reviews) changes the page height after load: re-measure scroll triggers.
  useEffect(() => {
    const t = window.setTimeout(() => ScrollTrigger.refresh(), 400);
    return () => window.clearTimeout(t);
  }, [content]);

  return (
    <div className="lp" id="top" ref={root}>
      {import.meta.env.DEV && failed && (
        <div className="lp-devwarn" role="status">
          Cannot reach the backend, so admin content (team, reviews, photos) is not loading. Start it with{' '}
          <code>npm run dev</code> in the <code>backend</code> folder, then refresh. (Only you see this, in development.)
        </div>
      )}
      <header className="lp-nav">
        <Link to="/" className="lp-logo">
          <img className="lp-logo-img" src="/logo.png" alt="" width={54} height={54} />
          <TypedWordmark />
        </Link>
        <nav className="lp-nav-pill">
          <a href="#about">About</a>
          <a href="#plans">Plans</a>
          <a href="#how">How it works</a>
          {hasTeam && <a href="#team">Team</a>}
          {hasContact && <a href="#contact">Contact</a>}
        </nav>
        <div className="lp-nav-right">
          {user ? (
            <Link className="lp-cta small" to="/dashboard">
              Dashboard
            </Link>
          ) : (
            <>
              <Link className="lp-login" to="/login">
                Log in
              </Link>
              <Link className="lp-cta small" to="/register">
                Start free {'→'}
              </Link>
            </>
          )}
        </div>
      </header>

      <section className="lp-hero">
        <Hero3D />
        <div className="lp-hero-copy">
          <h1 aria-label="Empowering Financial Growth">
            <span className="l1">Empowering</span>
            <span className="l2 outline">Financial</span>
            <span className="l3">
              <span className="grad">Growth</span>
            </span>
          </h1>
          <p className="lp-sub">
            A dynamic community dedicated to financial growth, meaningful opportunities, and collective success.
            Empowering individuals through knowledge, collaboration, and growth-driven initiatives to unlock their true
            potential and build a prosperous future together.
          </p>
          <div className="lp-actions">
            {!user && (
              <Link className="lp-cta" to="/register">
                Start free {'↗'}
              </Link>
            )}
            <a className="lp-ghost" href="#plans">
              See plans
            </a>
          </div>
          <span className="lp-hint">Hover the notes and coins</span>
        </div>
      </section>

      <AboutSection assets={content.assets} />
      <FeaturesSection assets={content.assets} />
      <MilestonesSection milestones={content.milestones} assets={content.assets} />

      <section className="lp-section" id="how">
        <h2>How you earn</h2>
        <div className="lp-steps">
          <div>
            <b>01</b>
            <h3>Join and learn</h3>
            <p>Sign up free with a sponsor link and start as a Trainee.</p>
          </div>
          <div>
            <b>02</b>
            <h3>Refer and earn</h3>
            <p>Earn from Demat referrals, and from your team's activity down 5 passive levels.</p>
          </div>
          <div>
            <b>03</b>
            <h3>Upgrade and grow</h3>
            <p>PRO and ELITE unlock package income, more levels, pools and 16 rank rewards.</p>
          </div>
        </div>
      </section>

      <section className="lp-section" id="plans">
        <h2>Pick your plan</h2>
        <div className="lp-plans">
          {PLANS.map((p) => (
            <div key={p.name} className={`lp-plan ${p.featured ? 'featured' : ''}`}>
              <span className="lp-plan-name">{p.name}</span>
              <strong>{p.price}</strong>
              <p>{p.note}</p>
              <ul>
                {p.perks.map((perk) => (
                  <li key={perk}>{perk}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <TeamSection team={content.team} assets={content.assets} />
      <ContactSection contact={contact} isAdmin={user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'} />
      <ReviewsSection reviews={content.reviews} assets={content.assets} />
      <CtaBanner signedIn={Boolean(user)} />

      <SiteFooter contact={contact} hasTeam={hasTeam} hasCertificate={Boolean(content.assets.certificate)} />
    </div>
  );
}
