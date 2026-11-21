import { useState } from 'react';

export type Msg = { type: 'success' | 'error'; text: string } | null;

/** Runs a form action: tracks "busy" and turns the result or the error into a message to show. */
export function useRun() {
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<{ message?: string } | void>, okText?: string): Promise<boolean> => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fn();
      setMsg({ type: 'success', text: okText ?? (res && res.message) ?? 'Done' });
      return true;
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message || 'Something went wrong' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { msg, setMsg, busy, run };
}

/** "1500" or "1500.5" typed by a member -> a number, or NaN when it is not a plain amount. */
export const toAmount = (text: string): number => (/^\d+(\.\d{1,2})?$/.test(text.trim()) ? Number(text) : Number.NaN);
