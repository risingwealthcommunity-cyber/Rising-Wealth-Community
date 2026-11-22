import { z } from 'zod';
import { RANKS } from '../income/plan.config';

const text = (max: number, min = 0) => z.string().trim().min(min).max(max);

/** Only https links, so a stored value can never be a javascript: URL. */
const httpsUrl = text(200).refine((v) => v === '' || /^https:\/\/[^\s]+$/i.test(v), 'Links must start with https://');
const phone = text(20).refine((v) => v === '' || /^[+\d][\d\s-]{5,18}$/.test(v), 'Enter a valid phone number');
const email = text(80).refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email');

/** Web3Forms access keys are public by design (they ship to the browser); this only checks the shape. */
const formKey = text(60).refine((v) => v === '' || /^[A-Za-z0-9-]{8,60}$/.test(v), 'The form key looks wrong. Paste the access key exactly as Web3Forms shows it');

export const milestonesSchema = z.object({
  items: z
    .array(z.object({ value: text(12, 1), label: text(40, 1) }))
    .min(1, 'Add at least one milestone')
    .max(6, 'At most 6 milestones')
});

export const teamSchema = z.object({
  items: z
    .array(z.object({ id: z.string().optional(), name: text(60, 1), role: text(60, 1), bio: text(400) }))
    .max(12, 'At most 12 team members')
});

export const reviewsSchema = z.object({
  items: z
    .array(z.object({ id: z.string().optional(), name: text(60, 1), tag: text(40) }))
    .max(30, 'At most 30 reviews')
});

export const trainingSchema = z.object({
  items: z
    .array(
      z.object({
        title: text(80, 1),
        description: text(300),
        url: httpsUrl.refine((v) => v !== '', 'Add a link starting with https://'),
        /** The lowest package that can open this lesson. TRAINEE = everyone. */
        tier: z.enum(['TRAINEE', 'PRO', 'ELITE']).default('TRAINEE')
      })
    )
    .max(50, 'At most 50 lessons')
});

export const paymentSchema = z.object({
  upiId: text(60).refine((v) => v === '' || /^[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}$/.test(v), 'Enter a valid UPI ID, like name@bank'),
  payeeName: text(60),
  note: text(300)
});

export const rankPerksSchema = z.object({
  items: z
    .array(
      z.object({
        rank: z.string().refine((v) => RANKS.some((r) => r.rank === v), 'Unknown rank'),
        title: text(80, 1),
        description: text(300)
      })
    )
    .max(RANKS.length, 'One perk per rank')
});

export const weeklyBonusSchema = z.object({
  /** Rupees paid for each weight-1 share at least (3 PRO sales = 1 share = this amount; an ELITE share counts double). */
  minPerShare: z.number().min(0).max(1000)
});

/** The rupee reward of each Team Performance target (5) and each Leadership target (8), in order. Applies to targets completed from now on. */
export const bonusRewardsSchema = z.object({
  team: z.array(z.number().min(0).max(10_000_000)).length(5),
  leadership: z.array(z.number().min(0).max(10_000_000)).length(8)
});

export const contactSchema = z.object({
  phone,
  whatsapp: phone,
  email,
  instagram: httpsUrl,
  youtube: httpsUrl,
  facebook: httpsUrl,
  telegram: httpsUrl,
  formKey: formKey.default('')
});

export const SETTING_SCHEMAS = {
  milestones: milestonesSchema,
  team: teamSchema,
  reviews: reviewsSchema,
  contact: contactSchema,
  training: trainingSchema,
  payment: paymentSchema,
  rankPerks: rankPerksSchema,
  weeklyBonus: weeklyBonusSchema,
  bonusRewards: bonusRewardsSchema
} as const;

export type SettingName = keyof typeof SETTING_SCHEMAS;
