import { useEffect, useState } from 'react';

const LINE_1 = 'Rising Wealth';
const LINE_2 = 'Community';
const TOTAL = LINE_1.length + LINE_2.length;

/**
 * Brand name that types itself out letter by letter, then keeps a blinking caret.
 * The full text is always laid out (invisibly) so nothing shifts while typing, and the
 * name is exposed to screen readers in one piece. Users who prefer reduced motion get
 * the finished text straight away.
 */
export default function TypedWordmark() {
  const [count, setCount] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? TOTAL : 0
  );

  useEffect(() => {
    if (count >= TOTAL) return;
    // Short pause before the first letter, then a steady rhythm.
    const timer = window.setTimeout(() => setCount((c) => c + 1), count === 0 ? 600 : 70);
    return () => window.clearTimeout(timer);
  }, [count]);

  const typed1 = LINE_1.slice(0, count);
  const typed2 = LINE_2.slice(0, Math.max(0, count - LINE_1.length));
  const caretOnFirst = count < LINE_1.length;
  const caret = <i className="tw-caret" />;

  return (
    <span className="lp-logo-text" aria-label={`${LINE_1} ${LINE_2}`}>
      <span className="tw-line" aria-hidden="true">
        <span className="tw-ghost">{LINE_1}</span>
        <span className="tw-typed">
          {typed1}
          {caretOnFirst && caret}
        </span>
      </span>
      <small className="tw-line" aria-hidden="true">
        <span className="tw-ghost">{LINE_2}</span>
        <span className="tw-typed">
          {typed2}
          {!caretOnFirst && caret}
        </span>
      </small>
    </span>
  );
}
