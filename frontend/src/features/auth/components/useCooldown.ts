import { useCallback, useEffect, useState } from 'react';

/** A countdown in whole seconds, used to space out "resend" buttons. */
export function useCooldown(): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left]);

  const start = useCallback((seconds: number) => setLeft(seconds), []);
  return [left, start];
}
