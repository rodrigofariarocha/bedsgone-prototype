# Bedsgone

Mattress pickup booking site — Astro + Tailwind + three.js. Static, no backend required.

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
npm run preview  # serve the built site
```

## Pages

| Route   | What it is                                                           |
| ------- | -------------------------------------------------------------------- |
| `/`     | Landing page — 3D mattress drop, booking card, pricing, coverage, FAQ |
| `/book` | The five-step booking wizard with a live price                        |

## The pricing model

Deliberately blunt, and the whole site is built around it:

- **$70** — the mattress is left outside (curb, driveway, garage, front yard)
- **$100** — the crew comes inside and carries it out, any floor, stairs included

Size, type and age never change the price, so the form never asks. The only
extras that exist are **+$30** per mattress after the first, **+$25** for a
same-day or next-day slot, and **+$25** if you are outside the daily routes.

All of it lives in **`src/lib/config.ts`** — `PICKUP_SPOTS`, `EXTRA_MATTRESS`,
`RUSH_FEE`, `OUT_OF_AREA_FEE`, plus the time windows, scheduling rules and the
`METROS` list that powers the ZIP checker. The math is in **`src/lib/quote.ts`**
(`buildQuote`), as pure functions with no DOM, so it can later run on a server
or in tests unchanged.

## The booking wizard

`src/components/BookingWizard.astro`. Five steps:

1. **Pickup** — how many mattresses, and outside or inside. This is the price.
2. **Address** — street, city, state, ZIP, with live coverage feedback, plus
   parking and gate-code notes.
3. **Date & time** — quick-pick chips for the soonest openings, any date within
   30 days, two-hour windows.
4. **Details** — name, email, phone, SMS opt-in, notes.
5. **Review** — a per-section summary with Edit links, then confirm.

The price recalculates on every keystroke. Drafts are saved to `localStorage`,
so a reload does not lose the form. `/book?spot=inside&zip=90038` pre-fills.

## Connecting a backend

The form is frontend-only today. There is exactly one place to wire a server in —
`submitBooking()` at the bottom of `BookingWizard.astro`:

```js
await fetch('/api/bookings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
```

`payload` is `{ reference, submittedAt, booking, quote }`. A Supabase insert, a
Resend email or a Formspree endpoint all drop in at that call without touching
anything else. Submitted bookings are currently logged to the console and kept
in `localStorage` under `bedsgone:bookings` so you can inspect them in a demo.

## Motion

- **`src/lib/motion.ts`** — Lenis smooth scroll plus a small GSAP reveal system
  driven by `data-anim` attributes (`lines`, `fade`, `stagger`, `clip`,
  `parallax`). Also the sticky header, the marquee and the custom cursor.
- **`src/lib/mattress-scene.ts`** — the hero mattress in three.js. It falls in
  from the left under gravity over ~3s, lands, compresses once and stays put.
  Deliberately no bounce. Loaded with a dynamic `import()`, so three.js never
  reaches a device that cannot render it.
- Everything is disabled under `prefers-reduced-motion`.

Two things worth knowing if you touch the motion code:

- `gsap.ticker.lagSmoothing(0)` — the snippet most Lenis guides tell you to add —
  must stay **off**. With it, one main-thread stall makes GSAP fast-forward and
  the loader and the whole drop jump straight to the end.
- Custom CSS lives inside `@layer base` / `@layer components` in `global.css`.
  Unlayered CSS outranks every Tailwind utility, so a plain `.btn` would quietly
  beat `px-5` and `.link-underline` would beat `hidden`.

## Brand

- Logo is rebuilt as SVG in `src/components/LogoMark.astro` (the pickup, leaf and
  recycling loop) and `src/components/Logo.astro` (wordmark and full lockup). It
  scales cleanly from the 30px favicon to the loader.
- Colours are tokens in `src/styles/global.css` under `@theme` — `brand`,
  `brand-deep`, `brand-dark`, `sand-50…300`, `ink`, `line`.

## Visual checks

`playwright` is a devDependency purely for screenshotting the built site during
development (`npm run preview`, then drive Chromium against `localhost:4321`).
Nothing in the shipped site depends on it.

## Deploy

`npm run build` and upload `dist/` anywhere static — Vercel, Netlify, S3, cPanel.
