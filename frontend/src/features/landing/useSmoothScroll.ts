import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

gsap.registerPlugin(ScrollTrigger);

/**
 * Lenis smooth scrolling driven by GSAP's ticker (one shared animation loop), plus the
 * landing page's intro and scroll-reveal animations. Everything is scoped to `scope` and
 * fully undone on unmount. Skipped entirely for users who prefer reduced motion.
 */
export function useSmoothScroll(scope: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    // In-page links (#plans, #how) glide instead of jumping.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]') as HTMLAnchorElement | null;
      const id = a?.getAttribute('href');
      if (!a || !id || id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target as HTMLElement, { offset: -20, duration: 1.3 });
    };
    document.addEventListener('click', onClick);

    const ctx = gsap.context(() => {
      // Intro
      gsap.from('.lp-nav', { y: -24, opacity: 0, duration: 0.8, ease: 'power3.out' });
      gsap.from('.lp-hero h1 > span', { yPercent: 45, opacity: 0, duration: 1, ease: 'power3.out', stagger: 0.12, delay: 0.1 });
      gsap.from('.lp-sub, .lp-actions, .lp-hint', {
        y: 24, opacity: 0, duration: 0.8, ease: 'power2.out', stagger: 0.1, delay: 0.45
      });

      // 3D layer drifts slower than the page.
      gsap.to('.lp-3d', {
        yPercent: 10,
        ease: 'none',
        scrollTrigger: { trigger: '.lp-hero', start: 'top top', end: 'bottom top', scrub: true }
      });

      // Reveal on scroll
      gsap.utils.toArray<HTMLElement>('.lp-section h2').forEach((el) => {
        gsap.from(el, {
          y: 32, opacity: 0, duration: 0.8, ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 90%', once: true }
        });
      });
      const cards = '.lp-steps > div, .lp-plan, .lp-values li, .lp-about-copy > p, .lp-about-media';
      gsap.set(cards, { y: 40, opacity: 0 });
      ScrollTrigger.batch(cards, {
        start: 'top 90%',
        once: true,
        onEnter: (els) =>
          gsap.to(els, { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out', stagger: 0.12, clearProps: 'transform' })
      });
    }, scope);

    return () => {
      ctx.revert();
      document.removeEventListener('click', onClick);
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
    };
  }, [scope]);
}
