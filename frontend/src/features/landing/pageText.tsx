import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/** Every sentence on the home page an admin can change, with what it says until they do. */
export interface PageTextItem {
  key: string;
  label: string;
  group: string;
  text: string;
  long?: boolean;
}

const item = (group: string, key: string, label: string, text: string, long = false): PageTextItem => ({ group, key, label, text, long });

export const PAGE_TEXTS: PageTextItem[] = [
  // top of the page
  item('Top of the page', 'hero.sub', 'Text under the big heading', 'A dynamic community dedicated to financial growth, meaningful opportunities, and collective success. Empowering individuals through knowledge, collaboration, and growth-driven initiatives to unlock their true potential and build a prosperous future together.', true),
  item('Top of the page', 'hero.cta', 'Start button', 'Start free'),
  item('Top of the page', 'hero.plans', 'See plans button', 'See plans'),
  item('Top of the page', 'hero.hint', 'Small hint', 'Hover the notes and coins'),

  // about
  item('About', 'about.title', 'Heading', 'About Rising Wealth Community'),
  item('About', 'about.p1', 'First paragraph', 'Rising Wealth Community is a learning-and-earning community built on a simple belief: people grow faster when they grow together.', true),
  item('About', 'about.p2', 'Second paragraph', 'You start free as a Trainee, learn through live trainings and community support, and earn from Demat referrals. When you are ready, the PRO and ELITE packages unlock package income, passive levels, bonus pools and rank rewards.', true),
  item('About', 'about.p3', 'Third paragraph', 'Everything is tracked in the open. Your wallet, your team and every payout sit in your dashboard, so you always know where your income comes from.', true),
  item('About', 'about.v1.title', 'Value 1: title', 'Transparency'),
  item('About', 'about.v1.text', 'Value 1: text', 'Your wallet, your team and every payout are visible in your dashboard.'),
  item('About', 'about.v2.title', 'Value 2: title', 'Community support'),
  item('About', 'about.v2.text', 'Value 2: text', 'Live trainings and a team that grows alongside you.'),
  item('About', 'about.v3.title', 'Value 3: title', 'Shared success'),
  item('About', 'about.v3.text', 'Value 3: text', 'When members earn, the whole community moves forward.'),
  item('About', 'about.msme', 'Registration line', 'Registered under MSME, Government of India.'),

  // why join
  item('Why join', 'features.title', 'Heading', 'Why join Rising Wealth'),
  item('Why join', 'features.sub', 'Line under the heading', 'Everything you need to learn, earn and grow, in one place.'),
  item('Why join', 'feature.1.title', 'Card 1: title', 'Start free'),
  item('Why join', 'feature.1.text', 'Card 1: text', 'Join as a Trainee at no cost and start earning from Demat referrals. Upgrade only when you are ready.', true),
  item('Why join', 'feature.2.title', 'Card 2: title', 'Build your team'),
  item('Why join', 'feature.2.text', 'Card 2: text', 'Grow a two-leg team. New members join under you, and your team’s activity builds your income.', true),
  item('Why join', 'feature.3.title', 'Card 3: title', 'Passive levels'),
  item('Why join', 'feature.3.text', 'Card 3: text', 'PRO unlocks 7 passive levels and ELITE all 12, so your income grows with your team’s activity.', true),
  item('Why join', 'feature.4.title', 'Card 4: title', 'Weekly payouts'),
  item('Why join', 'feature.4.text', 'Card 4: text', 'Pool bonuses are worked out every week and credited to your wallet, where every payout is visible.', true),

  // numbers, how, reviews
  item('Milestones', 'milestones.title', 'Heading', 'Our milestones'),
  item('Milestones', 'milestones.sub', 'Line under the heading', 'Proud of our community’s collective achievements.'),
  item('How you earn', 'how.title', 'Heading', 'How you earn'),
  item('How you earn', 'how.1.title', 'Step 1: title', 'Join and learn'),
  item('How you earn', 'how.1.text', 'Step 1: text', 'Sign up free with a sponsor link and start as a Trainee.'),
  item('How you earn', 'how.2.title', 'Step 2: title', 'Refer and earn'),
  item('How you earn', 'how.2.text', 'Step 2: text', 'Earn from Demat referrals, and from your team’s activity down 5 passive levels.'),
  item('How you earn', 'how.3.title', 'Step 3: title', 'Upgrade and grow'),
  item('How you earn', 'how.3.text', 'Step 3: text', 'PRO and ELITE unlock package income, more levels, pools and 16 rank rewards.'),
  item('Reviews', 'reviews.title', 'Heading', 'What our members say'),
  item('Reviews', 'reviews.sub', 'Line under the heading', 'Real stories from real people in our community.'),

  // plans
  item('Plans', 'plans.title', 'Heading', 'Pick your plan'),
  item('Plans', 'plan.1.name', 'Plan 1: name', 'Trainee'),
  item('Plans', 'plan.1.price', 'Plan 1: price', 'Free'),
  item('Plans', 'plan.1.note', 'Plan 1: short line', 'Free entry. Earn from Demat referrals.'),
  item('Plans', 'plan.1.perk1', 'Plan 1: point 1', 'Demat referral income'),
  item('Plans', 'plan.1.perk2', 'Plan 1: point 2', '5 passive levels on referrals'),
  item('Plans', 'plan.1.perk3', 'Plan 1: point 3', 'Team and wallet dashboard'),
  item('Plans', 'plan.2.name', 'Plan 2: name', 'PRO'),
  item('Plans', 'plan.2.price', 'Plan 2: price', '₹2,499'),
  item('Plans', 'plan.2.note', 'Plan 2: short line', 'Package income, 7 passive levels and bonuses.'),
  item('Plans', 'plan.2.perk1', 'Plan 2: point 1', '35% direct income'),
  item('Plans', 'plan.2.perk2', 'Plan 2: point 2', 'Passive levels 1–7'),
  item('Plans', 'plan.2.perk3', 'Plan 2: point 3', 'Weekly and performance pools'),
  item('Plans', 'plan.3.name', 'Plan 3: name', 'ELITE'),
  item('Plans', 'plan.3.price', 'Plan 3: price', '₹4,999'),
  item('Plans', 'plan.3.note', 'Plan 3: short line', 'All 12 passive levels and higher eligibility.'),
  item('Plans', 'plan.3.perk1', 'Plan 3: point 1', '35% direct income'),
  item('Plans', 'plan.3.perk2', 'Plan 3: point 2', 'Passive levels 1–12'),
  item('Plans', 'plan.3.perk3', 'Plan 3: point 3', 'Leadership pool and rank rewards'),

  // bottom
  item('Team, contact and the closing banner', 'team.title', 'Team: heading', 'Meet our team'),
  item('Team, contact and the closing banner', 'team.sub', 'Team: line under the heading', 'The leaders driving our community forward.'),
  item('Team, contact and the closing banner', 'contact.title', 'Contact: heading', 'Get in touch'),
  item('Team, contact and the closing banner', 'contact.sub', 'Contact: line under the heading', 'Have questions? We would love to hear from you.'),
  item('Team, contact and the closing banner', 'cta.title', 'Closing banner: heading', 'Your income journey starts here'),
  item('Team, contact and the closing banner', 'cta.text', 'Closing banner: text', 'Join free as a Trainee, learn with the community, and upgrade only when you are ready.', true),
  item('Team, contact and the closing banner', 'cta.join', 'Closing banner: join button', 'Join now'),
  item('Team, contact and the closing banner', 'cta.member', 'Closing banner: member button', 'Already a member?')
];

const DEFAULTS: Record<string, string> = Object.fromEntries(PAGE_TEXTS.map((i) => [i.key, i.text]));

const PageTextContext = createContext<Record<string, string>>({});

/** Wraps the home page: the texts an admin changed, over the built-in ones. */
export function PageTextProvider({ texts, children }: { texts: Record<string, string> | null | undefined; children: ReactNode }) {
  return <PageTextContext.Provider value={texts ?? {}}>{children}</PageTextContext.Provider>;
}

/** `t('hero.cta')`: the admin's text if they set one, otherwise the built-in one. */
export function useT(): (key: string, fallback?: string) => string {
  const texts = useContext(PageTextContext);
  return (key, fallback) => {
    const own = texts[key];
    if (typeof own === 'string' && own.trim()) return own;
    return DEFAULTS[key] || fallback || '';
  };
}
