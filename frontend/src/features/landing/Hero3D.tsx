import { Suspense, lazy, useEffect, useRef, useState } from 'react';

// The 3D bundle (three.js) is a separate chunk: it is only downloaded after the page
// has painted, so the headline and buttons never wait for it.
const HeroScene = lazy(() => import('./money/HeroScene'));

function canUse3D(): boolean {
  try {
    if (!window.matchMedia('(min-width: 900px)').matches) return false; // phones/tablets: static
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if (!window.matchMedia('(hover: hover)').matches) return false; // hover is the whole point
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function Hero3D() {
  const [enabled] = useState(canUse3D);
  const [mount, setMount] = useState(false);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  // Start loading when the browser is idle, after first paint.
  useEffect(() => {
    if (!enabled) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setMount(true));
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setMount(true), 200);
    return () => window.clearTimeout(id);
  }, [enabled]);

  // Stop rendering when scrolled out of view or the tab is hidden.
  useEffect(() => {
    const el = box.current;
    if (!el || !enabled) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    const onVis = () => setVisible(!document.hidden && el.getBoundingClientRect().bottom > 0);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled]);

  return (
    <div ref={box} className={`lp-3d ${ready ? 'ready' : ''}`} aria-hidden="true">
      {enabled && mount && (
        <Suspense fallback={null}>
          <HeroScene visible={visible} onReady={() => setReady(true)} />
        </Suspense>
      )}
    </div>
  );
}
