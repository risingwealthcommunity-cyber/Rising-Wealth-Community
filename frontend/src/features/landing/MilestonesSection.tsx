import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { DEFAULT_MILESTONES } from '../site';
import type { Milestone, SiteAssets } from '../site';

gsap.registerPlugin(ScrollTrigger);

/** "9K+" -> { pre: '', num: 9, dec: 0, post: 'K+' };  "₹27L+" -> { pre: '₹', num: 27, post: 'L+' } */
function parseStat(v: string) {
  const m = v.match(/^(\D*?)(\d[\d,]*\.?\d*)(.*)$/);
  if (!m) return null;
  return { pre: m[1], num: parseFloat(m[2].replace(/,/g, '')), dec: (m[2].split('.')[1] ?? '').length, post: m[3] };
}

/**
 * Change what a React-rendered element displays WITHOUT replacing its text node. Assigning
 * textContent would detach the node React holds, and later updates (such as the admin's saved
 * numbers arriving after first paint) would silently stop showing.
 */
function setText(el: HTMLElement, value: string) {
  if (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE) el.firstChild.nodeValue = value;
  else el.textContent = value;
}

export default function MilestonesSection({ milestones, assets }: { milestones: Milestone[] | null; assets: SiteAssets }) {
  const items = milestones && milestones.length > 0 ? milestones : DEFAULT_MILESTONES;
  const root = useRef<HTMLDivElement>(null);
  const itemsKey = JSON.stringify(items);

  // Count each number up from zero the first time it scrolls into view.
  useEffect(() => {
    const box = root.current;
    if (!box || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const triggers: ScrollTrigger[] = [];
    const tweens: gsap.core.Tween[] = [];
    const nodes = Array.from(box.querySelectorAll<HTMLElement>('[data-stat]'));
    // Final values come from the props, never from the DOM: by the time an effect re-runs, React has
    // already written the new text, and reading it back (or restoring an old copy) would be stale.
    const finals = items.map((m) => m.value);

    nodes.forEach((el, i) => {
      const parsed = parseStat(finals[i] ?? '');
      if (!parsed) return;
      const fmt = (n: number) =>
        parsed.pre + n.toLocaleString('en-IN', { minimumFractionDigits: parsed.dec, maximumFractionDigits: parsed.dec }) + parsed.post;
      setText(el, fmt(0));
      const state = { n: 0 };
      triggers.push(
        ScrollTrigger.create({
          trigger: el,
          start: 'top 92%',
          once: true,
          onEnter: () => {
            tweens.push(
              gsap.to(state, {
                n: parsed.num,
                duration: 1.8,
                ease: 'power2.out',
                onUpdate: () => {
                  setText(el, fmt(state.n));
                },
                onComplete: () => {
                  setText(el, finals[i]);
                }
              })
            );
          }
        })
      );
    });

    // No text restore here on purpose. If the numbers change, React has already written the new text
    // and this effect runs again for it; on unmount there is nothing left to restore.
    return () => {
      triggers.forEach((t) => t.kill());
      tweens.forEach((t) => t.kill());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  return (
    <section className="lp-section" id="milestones">
      <h2>Our milestones</h2>
      <p className="lp-section-sub">Proud of our community&rsquo;s collective achievements.</p>
      <div className="lp-stats" ref={root}>
        {items.map((m, i) => {
          const bg = assets[`milestone-${i + 1}`];
          return (
            <div className="lp-stat" key={i}>
              {bg && <img className="lp-stat-bg" src={bg.url} alt="" loading="lazy" decoding="async" />}
              <div className="lp-stat-body">
                <strong data-stat>{m.value}</strong>
                <span>{m.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
