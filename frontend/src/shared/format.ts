export const inr = (value: string | number): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value));

export const label = (value: string): string =>
  value
    .toLowerCase()
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

export const date = (value: string): string => new Date(value).toLocaleString('en-IN');
