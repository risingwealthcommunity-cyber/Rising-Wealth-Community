/** The income streams members see, always all of them (a stream with nothing earned yet shows Rs 0). */
export const STREAMS: { key: string; label: string; types: string[]; color: string }[] = [
  { key: 'demat', label: 'Demat Referral Income', types: ['DEMAT_DIRECT'], color: '#14b8a6' },
  { key: 'direct', label: 'Direct Package Income', types: ['DIRECT_INCOME'], color: '#3b82f6' },
  { key: 'passive', label: 'Passive Income', types: ['PASSIVE_INCOME', 'DEMAT_PASSIVE'], color: '#8b5cf6' },
  { key: 'weekly', label: 'Weekly Bonus', types: ['WEEKLY_BONUS'], color: '#22c55e' },
  { key: 'leadership', label: 'Leadership Bonus', types: ['LEADERSHIP_TARGET_BONUS', 'LEADERSHIP_BONUS'], color: '#f59e0b' },
  { key: 'team', label: 'Team Performance Bonus', types: ['TEAM_PERFORMANCE_BONUS'], color: '#f43f5e' },
  { key: 'campaign', label: 'Monthly Royalty', types: ['CAMPAIGN_REWARD'], color: '#0ea5e9' }
];

export interface Stream {
  key: string;
  label: string;
  color: string;
  amount: number;
}

export function streamsOf(breakdown: { type: string; amount: number }[]): Stream[] {
  const known = new Set(STREAMS.flatMap((x) => x.types));
  const rows: Stream[] = STREAMS.map((x) => ({
    key: x.key,
    label: x.label,
    color: x.color,
    amount: breakdown.filter((b) => x.types.includes(b.type)).reduce((sum, b) => sum + b.amount, 0)
  }));
  const other = breakdown.filter((b) => !known.has(b.type)).reduce((sum, b) => sum + b.amount, 0);
  if (other > 0) rows.push({ key: 'other', label: 'Other bonuses', color: '#e3e6ea', amount: other });
  return rows;
}
