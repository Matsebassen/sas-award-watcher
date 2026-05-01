# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
nvm use            # Node 20+ (Next 16 + Playwright). Shell may default to 18.
npm run dev        # Dashboard dev server at http://localhost:3000
npm run check      # Run the watcher once (Playwright + SAS + Upstash + Resend)
npm run build      # Production build of the dashboard (Turbopack); also runs TS typecheck
npm run lint       # ESLint via flat config
```

`npm run check` reads from `.env.local`. Load it into your shell first:

```bash
set -a && source .env.local && set +a
npm run check
```

For schema-drift / "why zero results" debugging, dump raw SAS responses for specific months:

```bash
set -a && source .env.local && set +a
npx tsx scripts/debug.ts 202703 202704 202705
```

If `npm install` fails with `Cannot find module '@tailwindcss/oxide-...'`, native binaries were installed under a different Node version. Fix with `rm -rf node_modules package-lock.json && npm install` under Node 20+.

## Architecture

This watcher tracks **bookable round-trip pairs** — not single dates — between SVG and Seoul. A "trip pair" is a (outbound, inbound) date combination where both legs are 30k-pt standard awards and the stay in Seoul is between `MIN_STAY_DAYS` and `MAX_STAY_DAYS`.

### Why GitHub Actions (not Vercel)

`sas.no` is behind Cloudflare with TLS fingerprinting. Node `fetch`, `curl`, and even `curl-impersonate` from a residential IP get a custom 403 ("Denied boarding"). Real headless Chromium via Playwright passes because it sends a real Chrome TLS handshake. So the watcher runs from a GHA runner via `page.evaluate(fetch(...))`. Vercel only hosts the read-only dashboard.

```
GitHub Actions (hourly cron, .github/workflows/check.yml)
   └─► npm run check  →  scripts/check.ts
          ├─► Playwright Chromium → goto sas.no/ (warmup) → page.evaluate fetch
          ├─► lib/check.ts:runCheck (sequential per month)
          │     · merges outbound + inbound calendars across all WATCH_MONTHS
          │     · lib/trip.ts:findValidPairs generates (out,in) pairs
          │     · diff vs Upstash alerted-pairs set, dedup
          ├─► lib/notify.ts:sendTripEmail (grouped by outbound date)
          └─► persist directional snapshot + alert log to Upstash

Browser ─► /  (app/page.tsx, on Vercel)  ─► reads from Upstash, recomputes pairs
```

### Module boundaries

- `lib/config.ts` — single source of truth: `ROUTE` (outbound + inbound objects), `MAX_POINTS`, `MIN_STAY_DAYS`, `MAX_STAY_DAYS`, `WATCH_MONTHS` (env-overridable list of YYYYMM).
- `lib/sas.ts` — `Fetcher` type and `fetchMonth(outFrom, outTo, yyyymm, fetcher) → DirectionalSnapshot { outbound, inbound }`. **Important**: a single SAS call returns both directions; we parse both. `parseDayMap` defaults `isStandardAward` to `false` when the field is absent (most days don't carry it).
- `lib/trip.ts` — pure logic: `findValidPairs(outbound, inbound, opts)` and `pairKey({outDate, retDate})`. Used by both the watcher and the dashboard.
- `lib/check.ts` — orchestrator. Iterates `WATCH_MONTHS` sequentially, merges directional calendars, generates pairs, diffs vs `alerted:pairs:SVG-SEL`, sends email, persists. **Re-arm logic**: when a previously-alerted pair is no longer valid (either leg disappeared or repriced), its dedup entry is removed so a fresh re-appearance triggers another email.
- `lib/storage.ts` — Upstash reads/writes. Two snapshot keys (`snapshot:SVG-SEL:outbound` / `:inbound`), one pair-dedup set, one alerts list, one meta object. `getAlertedPairs` casts each value to `String` because Upstash auto-coerces numeric-looking strings to numbers, which breaks `Set<string>.has()`.
- `lib/notify.ts` — Resend wrapper. Groups pairs by outbound date for readability. From-address defaults to `onboarding@resend.dev` so no domain verification is needed.
- `scripts/check.ts` — runtime entry point. Launches Chromium with `--disable-blink-features=AutomationControlled`, warms `sas.no/`, builds a `Fetcher` that delegates to `page.evaluate(fetch(...))`, calls `runCheck`.
- `scripts/debug.ts` — manual diagnostic. Takes one or more `YYYYMM` args; prints standard-award dates per direction.

### Data shape

SAS response (verified against real API):

```jsonc
{
  "outbound": {
    "20260825": { "totalPrice": 30000, "isStandardAward": true },
    "20260826": { "totalPrice": 81458 }   // no isStandardAward = not a standard award
  },
  "inbound":  { ... },                    // same shape; SEL → SVG
  "offerId": "..."
}
```

`isStandardAward` is only present on standard-award days. Treat absence as `false`.

### Detection logic

A pair triggers an alert iff:
- `outbound[outDate].isStandardAward === true && totalPrice <= MAX_POINTS`
- `inbound[retDate].isStandardAward === true && totalPrice <= MAX_POINTS`
- `MIN_STAY_DAYS ≤ daysBetween(outDate, retDate) ≤ MAX_STAY_DAYS`

The boolean is the SAS-authoritative marker; the price guard protects against schema drift.

### Configuration boundaries

- All env vars in `.env.example`. `RESEND_*` and `UPSTASH_*` are required for the runner. `WATCH_MONTHS`, `MIN_STAY_DAYS`, `MAX_STAY_DAYS` have defaults in `lib/config.ts`.
- Dashboard on Vercel needs `UPSTASH_*` plus `WATCH_MONTHS`/`MIN_STAY_DAYS`/`MAX_STAY_DAYS` so it renders the right window.
- GitHub Actions uses **secrets** for credentials and **variables** (`vars.WATCH_MONTHS` etc.) for the watch window.

## Things that will trip you up

- **Don't try to call SAS with `fetch()`, `axios`, or `curl` from any non-browser environment** — 403. Only real Chromium via Playwright works.
- **Don't add a Vercel API route** that calls SAS; same blocking. The check **must** run from the GHA runner.
- **Don't make SAS fetches parallel** with `Promise.all` — anti-scraping kicks in. `runCheck` runs months sequentially.
- **Don't trust Upstash auto-typing** for sets/lists of YYYYMMDD strings — cast back to `String` on read.
- SAS only loads schedules ~330 days ahead; months further out come back empty. That's not a parser bug.
- The dashboard page (`app/page.tsx`) exports `dynamic = 'force-dynamic'`. Without that, it would be statically prerendered and stale.
- `next.config.ts` pins `turbopack.root` to silence a multi-lockfile warning caused by an unrelated `package-lock.json` in the user's home directory.
