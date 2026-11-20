const LABELS = ['Too short', 'Weak', 'Okay', 'Good', 'Strong'];

/** Rough strength guide. Only the 8 character minimum is enforced; the rest is advice. */
export function passwordScore(pw: string): number {
  if (pw.length < 8) return 0;
  let score = 1;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z\d]/.test(pw) && /\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw) || (pw.length >= 14 && /\d/.test(pw))) score++;
  return Math.min(score, 4);
}

export default function PasswordMeter({ password }: { password: string }) {
  if (!password) return null;
  const score = passwordScore(password);
  return (
    <div className="au-meter" data-score={score} aria-live="polite">
      <div className="au-meter-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <i key={n} className={n <= score ? 'on' : ''} />
        ))}
      </div>
      <span>{LABELS[score]}</span>
    </div>
  );
}
