/** Everything an admin can open, with what it does in plain words. The sidebar and the dashboard shortcuts both use this. */
export const ADMIN_LINKS: { to: string; label: string; icon: 'globe' | 'megaphone' | 'file' | 'users' | 'wallet' | 'star' | 'receipt' | 'book' | 'mail' | 'shield' | 'medal'; end?: boolean }[] = [
  { to: '/admin', label: 'Admin overview', icon: 'shield', end: true },
  { to: '/admin/site', label: 'Landing page changes', icon: 'globe' },
  { to: '/admin/campaigns', label: 'Upload campaign', icon: 'megaphone' },
  { to: '/admin/reports', label: 'Reports', icon: 'file' },
  { to: '/admin/members', label: 'Users', icon: 'users' },
  { to: '/admin/withdrawals', label: 'Funds & withdrawals', icon: 'wallet' },
  { to: '/admin/bonuses', label: 'Bonuses', icon: 'star' },
  { to: '/admin/income', label: 'Income summary', icon: 'receipt' },
  { to: '/admin/training', label: 'Training library', icon: 'book' },
  { to: '/admin/contact', label: 'Contact messages', icon: 'mail' },
  { to: '/admin/operations', label: 'Perks & live', icon: 'medal' }
];
