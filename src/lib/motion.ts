/**
 * Motion layer — Lenis for smooth scroll, GSAP for everything else.
 *
 * Markup opts in with data attributes rather than per-page scripts:
 *
 *   data-anim="lines"     animate .line-i children up out of their mask
 *   data-anim="fade"      opacity + lift
 *   data-anim="stagger"   lift [data-anim-child] one after another
 *   data-anim="clip"      wipe in from the bottom edge
 *   data-anim="parallax"  drift on scroll, speed from data-speed
 *   data-anim-delay="0.2" seconds of extra delay
 *   data-anim-hero        played by the hero timeline instead of on scroll
 */

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

export const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const EASE = 'expo.out';

/* -------------------------------------------------------------------------- */
/* "The site has been entered" — the preloader owns this moment.               */
/* -------------------------------------------------------------------------- */

let entered = false;
const waiting: Array<() => void> = [];

export function markEntered() {
  if (entered) return;
  entered = true;
  waiting.splice(0).forEach((fn) => fn());
  window.dispatchEvent(new CustomEvent('bg:enter'));
  // The loader changed the layout while it was up — re-measure before any
  // scroll trigger gets a chance to fire against stale positions.
  requestAnimationFrame(() => ScrollTrigger.refresh());
}

export function whenEntered(fn: () => void) {
  entered ? fn() : waiting.push(fn);
}

/* -------------------------------------------------------------------------- */
/* Smooth scroll                                                              */
/* -------------------------------------------------------------------------- */

let lenis: Lenis | null = null;

export function getLenis() {
  return lenis;
}

function initSmoothScroll() {
  if (reducedMotion) return;

  lenis = new Lenis({
    duration: 1.15,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    touchMultiplier: 1.6,
  });

  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis?.raf(time * 1000));
  // Lag smoothing stays ON. Turning it off (the usual Lenis snippet) makes GSAP
  // fast-forward by the full elapsed time after any main-thread stall — one
  // shader compile and the loader and the whole mattress drop jump to the end.

  // Held still until the preloader hands over.
  if (document.querySelector('[data-loader]')) lenis.stop();

  // Anchor links have to go through Lenis or they fight each other.
  document.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement)?.closest?.('a[href^="#"], a[href^="/#"]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    const hash = href.slice(href.indexOf('#'));
    if (hash.length < 2) return;
    const target = document.querySelector(hash);
    if (!target) return;
    event.preventDefault();
    lenis?.scrollTo(target as HTMLElement, { offset: -96, duration: 1.4 });
  });
}

/* -------------------------------------------------------------------------- */
/* Reveals                                                                    */
/* -------------------------------------------------------------------------- */

const delayOf = (el: HTMLElement) => parseFloat(el.dataset.animDelay || '0') || 0;

/** Play one element's reveal immediately. Returns a tween so the hero can chain. */
export function playReveal(el: HTMLElement, delay = delayOf(el)): gsap.core.Tween | gsap.core.Timeline {
  const kind = el.dataset.anim;

  if (kind === 'lines') {
    gsap.set(el, { opacity: 1 });
    // `y: 0` is not redundant. GSAP parses the CSS translateY(110%) into its own
    // `y` in pixels, and would then stack yPercent on top of it — leaving the
    // line one full height low when the tween ends. Pinning y kills that.
    return gsap.fromTo(
      el.querySelectorAll('.line-i'),
      { yPercent: 110, y: 0 },
      { yPercent: 0, y: 0, duration: 1.25, ease: EASE, stagger: 0.09, delay }
    );
  }

  if (kind === 'stagger') {
    gsap.set(el, { opacity: 1 });
    return gsap.fromTo(
      el.querySelectorAll('[data-anim-child]'),
      { opacity: 0, y: 34 },
      { opacity: 1, y: 0, duration: 1, ease: EASE, stagger: 0.08, delay }
    );
  }

  if (kind === 'clip') {
    return gsap.fromTo(
      el,
      { opacity: 1, clipPath: 'inset(0% 0% 100% 0%)' },
      { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.3, ease: EASE, delay }
    );
  }

  return gsap.fromTo(
    el,
    { opacity: 0, y: 28 },
    { opacity: 1, y: 0, duration: 1.1, ease: EASE, delay }
  );
}

function showInstantly(el: HTMLElement) {
  gsap.set(el, { opacity: 1, y: 0, clipPath: 'none' });
  gsap.set(el.querySelectorAll('.line-i'), { yPercent: 0, y: 0 });
  gsap.set(el.querySelectorAll('[data-anim-child]'), { opacity: 1, y: 0 });
}

function initReveals() {
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-anim]'));

  for (const el of items) {
    if (el.dataset.anim === 'scene') continue;

    if (reducedMotion) {
      showInstantly(el);
      continue;
    }

    if (el.dataset.anim === 'parallax') {
      const speed = parseFloat(el.dataset.speed || '0.12');
      gsap.to(el, {
        yPercent: speed * 100,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
      });
      continue;
    }

    // The hero plays its own children once the loader lifts.
    if (el.hasAttribute('data-anim-hero')) continue;

    ScrollTrigger.create({
      trigger: el,
      start: 'top 88%',
      once: true,
      onEnter: () => playReveal(el),
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Header — retracts going down, comes back going up                          */
/* -------------------------------------------------------------------------- */

function initHeader() {
  const header = document.querySelector<HTMLElement>('[data-header]');
  if (!header || reducedMotion) return;

  let last = window.scrollY;
  let hidden = false;

  const update = (y: number) => {
    header.classList.toggle('is-stuck', y > 24);
    if (y < 120) {
      if (hidden) {
        gsap.to(header, { yPercent: 0, duration: 0.5, ease: EASE });
        hidden = false;
      }
      last = y;
      return;
    }
    if (y > last + 6 && !hidden) {
      gsap.to(header, { yPercent: -110, duration: 0.5, ease: EASE });
      hidden = true;
    } else if (y < last - 6 && hidden) {
      gsap.to(header, { yPercent: 0, duration: 0.5, ease: EASE });
      hidden = false;
    }
    last = y;
  };

  if (lenis) lenis.on('scroll', ({ scroll }: { scroll: number }) => update(scroll));
  else window.addEventListener('scroll', () => update(window.scrollY), { passive: true });
}

/* -------------------------------------------------------------------------- */
/* Marquee                                                                    */
/* -------------------------------------------------------------------------- */

function initMarquees() {
  document.querySelectorAll<HTMLElement>('[data-marquee]').forEach((track) => {
    const speed = parseFloat(track.dataset.marqueeSpeed || '28');
    const item = track.firstElementChild as HTMLElement | null;
    if (!item) return;

    // Duplicate until the track is at least twice the viewport, so the loop never gaps.
    const original = item.outerHTML;
    while (track.scrollWidth < window.innerWidth * 2) track.insertAdjacentHTML('beforeend', original);

    if (reducedMotion) return;

    const distance = item.offsetWidth;
    const tween = gsap.to(track, {
      x: -distance,
      duration: distance / speed,
      ease: 'none',
      repeat: -1,
    });

    // Scrolling nudges it along — a small thing that makes the page feel alive.
    ScrollTrigger.create({
      trigger: track,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: (self) => {
        gsap.to(tween, { timeScale: 1 + Math.min(3, Math.abs(self.getVelocity()) / 900), duration: 0.3, overwrite: true });
      },
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Cursor                                                                     */
/* -------------------------------------------------------------------------- */

function initCursor() {
  if (reducedMotion || window.matchMedia('(hover: none)').matches) return;

  const dot = document.createElement('div');
  dot.className = 'cursor cursor__dot';
  const ring = document.createElement('div');
  ring.className = 'cursor cursor__ring';
  document.body.append(ring, dot);

  const setDotX = gsap.quickTo(dot, 'x', { duration: 0.12, ease: 'power3.out' });
  const setDotY = gsap.quickTo(dot, 'y', { duration: 0.12, ease: 'power3.out' });
  const setRingX = gsap.quickTo(ring, 'x', { duration: 0.5, ease: 'power3.out' });
  const setRingY = gsap.quickTo(ring, 'y', { duration: 0.5, ease: 'power3.out' });

  let shown = false;
  window.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    if (!shown) {
      gsap.to([dot, ring], { opacity: 1, duration: 0.3 });
      shown = true;
    }
    setDotX(event.clientX - 3);
    setDotY(event.clientY - 3);
    setRingX(event.clientX - 20);
    setRingY(event.clientY - 20);
  });

  const interactive = 'a, button, input, select, textarea, summary, label, [data-cursor]';
  document.addEventListener('pointerover', (event) => {
    const hit = (event.target as HTMLElement)?.closest?.(interactive);
    ring.classList.toggle('is-active', Boolean(hit));
  });

  document.addEventListener('pointerleave', () => gsap.to([dot, ring], { opacity: 0, duration: 0.2 }));
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */

let booted = false;

export function initMotion() {
  if (booted) return;
  booted = true;

  document.documentElement.classList.add('has-js');

  initSmoothScroll();
  initReveals();
  initHeader();
  initMarquees();
  initCursor();

  ScrollTrigger.refresh();
  window.addEventListener('load', () => ScrollTrigger.refresh());

  // Pages without a preloader should never wait for one.
  if (!document.querySelector('[data-loader]')) markEntered();
}

export { gsap, ScrollTrigger };
