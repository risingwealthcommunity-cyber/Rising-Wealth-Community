import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useAuth } from '../auth';
import { DEFAULT_CONTACT, useSiteContent } from '../site';
import AboutSection from './AboutSection';
import ContactSection from './ContactSection';
import CtaBanner from './CtaBanner';
import FaqSection from './FaqSection';
import FeaturesSection from './FeaturesSection';
import Hero3D from './Hero3D';
import MilestonesSection from './MilestonesSection';
import ReviewsSection from './ReviewsSection';
import { PageTextProvider, useT } from './pageText';
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
  const { content } = useSiteContent();
  return (
    <PageTextProvider texts={content.pageText?.texts}>
      <LandingBody />
    </PageTextProvider>
  );
}

function LandingBody() {
  const t = useT();
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
          <p className="lp-sub">{t('hero.sub')}</p>
          <div className="lp-actions">
            {!user && (
              <Link className="lp-cta" to="/register">
                {t('hero.cta')} {'↗'}
              </Link>
            )}
            <a className="lp-ghost" href="#plans">
              {t('hero.plans')}
            </a>
          </div>
          <span className="lp-hint">{t('hero.hint')}</span>
        </div>
      </section>

      <AboutSection assets={content.assets} />
      <FeaturesSection assets={content.assets} />
      <MilestonesSection milestones={content.milestones} assets={content.assets} />

      <section className="lp-section" id="how">
        <h2>{t('how.title')}</h2>
        <div className="lp-steps">
          {[1, 2, 3].map((n) => (
            <div key={n}>
              <b>{`0${n}`}</b>
              <h3>{t(`how.${n}.title`)}</h3>
              <p>{t(`how.${n}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <ReviewsSection reviews={content.reviews} assets={content.assets} />

      <section className="lp-section" id="plans">
        <h2>{t('plans.title')}</h2>
        <div className="lp-plans">
          {PLANS.map((p, i) => (
            <div key={p.name} className={`lp-plan ${p.featured ? 'featured' : ''}`}>
              <span className="lp-plan-name">{t(`plan.${i + 1}.name`, p.name)}</span>
              <strong>{t(`plan.${i + 1}.price`, p.price)}</strong>
              <p>{t(`plan.${i + 1}.note`, p.note)}</p>
              <ul>
                {p.perks.map((perk, k) => (
                  <li key={perk}>{t(`plan.${i + 1}.perk${k + 1}`, perk)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <TeamSection team={content.team} assets={content.assets} />
      <FaqSection />
      <ContactSection contact={contact} isAdmin={user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'} />
      <CtaBanner signedIn={Boolean(user)} />

      <SiteFooter contact={contact} hasTeam={hasTeam} hasCertificate={Boolean(content.assets.certificate)} />
    </div>
  );
}
