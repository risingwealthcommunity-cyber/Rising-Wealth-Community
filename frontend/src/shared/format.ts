export const inr = (value: string | number): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value));

export const label = (value: string): string =>
  value
    .toLowerCase()
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

/** Wallet / ledger type names as members should read them. */
const TYPE_LABELS: Record<string, string> = {
  TEAM_PERFORMANCE_BONUS: 'Team performance bonus',
  LEADERSHIP_TARGET_BONUS: 'Leadership bonus',
  LEADERSHIP_BONUS: 'Leadership pool',
  CAMPAIGN_REWARD: 'Campaign reward',
  MONTHLY_ROYALTY: 'Monthly royalty',
  ADMIN_DEDUCTION: 'Deducted by admin',
  WALLET_TRANSFER: 'Moved to activation wallet',
  WITHDRAWAL: 'Withdrawal'
};
export const typeLabel = (type: string): string => TYPE_LABELS[type] ?? label(type);

export const date =(value: string): string => new Date(value).toLocaleString('en-IN');
