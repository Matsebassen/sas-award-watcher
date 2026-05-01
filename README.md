# SAS Award Watcher

A small project that polls SAS's Eurobonus calendar API every hour via a real headless Chromium and emails you the moment a **bookable round-trip** between SVG and Seoul opens at 30k pts each way — both legs available, with 14–30 day stay in Seoul.

## How it works

```
GitHub Actions (hourly cron)
   └─► npm run check  (scripts/check.ts)
          ├─► Playwright launches headless Chromium
          ├─► page.goto('https://www.sas.no/')   # warm Cloudflare cookies
          ├─► page.evaluate(fetch(API_URL)) for each watched month
          │     · single API call returns BOTH outbound & inbound calendars
          ├─► merge per-direction calendars across months
          ├─► generate (out, in) trip pairs that satisfy:
          │     · both legs isStandardAward at ≤ MAX_POINTS
          │     · MIN_STAY_DAYS ≤ stay ≤ MAX_STAY_DAYS
          ├─► dedup against alerted-pairs set in Upstash
          ├─► email new pairs via Resend (grouped by outbound date)
          └─► persist directional snapshot + alert log to Upstash

Browser ─► /  (Vercel, app/page.tsx)  ─► dashboard reads from Upstash
```

### Why Playwright in GHA (not Vercel Cron)

`sas.no` is behind Cloudflare with TLS fingerprinting. Node `fetch`, `curl`, and even `curl-impersonate` get a "Denied boarding" 403. The only reliable bypass is real headless Chromium running the fetch from inside the page (`page.evaluate(fetch(...))`). Vercel functions can't do this — Vercel only hosts the dashboard.

A trip pair is alerted once. If either leg later disappears, the dedup entry is cleared so a *new* re-appearance triggers another email.

## Setup

### 1. Sign up for the services

- **Resend** — get an API key.
- **Upstash** — create a Redis database, copy the REST URL + token.

### 2. Add GitHub Actions secrets

In **Repo → Settings → Secrets and variables → Actions → Secrets**:

- `RESEND_API_KEY`
- `RESEND_TO_EMAIL` — your gmail
- `RESEND_FROM_EMAIL` (optional)
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

To override defaults from `lib/config.ts`, add **Repository Variables** (same page, Variables tab):

- `WATCH_MONTHS` — comma-separated YYYYMM, e.g. `202703,202704,202705`
- `MIN_STAY_DAYS` (default `14`)
- `MAX_STAY_DAYS` (default `30`)

Then trigger the `Hourly SAS award check` workflow once via the **Actions** tab → **Run workflow**.

### 3. Deploy the dashboard to Vercel (optional)

Import the repo on Vercel; set `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and the same `WATCH_MONTHS` / `MIN_STAY_DAYS` / `MAX_STAY_DAYS` (so the dashboard renders the right window).

## Adjusting the watch window

Currently set to **March 2027 → April 2027** travel (with May for late-April returns). To **add October 2027** once that schedule opens (~Nov 2026), update `WATCH_MONTHS`:

```
WATCH_MONTHS=202703,202704,202705,202710,202711,202712
```

The defaults live in `lib/config.ts` and can be overridden via env at any layer (`.env.local` for dev, GH Variables for the workflow, Vercel env for the dashboard).

## Local development

```bash
nvm use                          # uses Node 20 (or 24)
npm install
npx playwright install chromium  # one-time, ~200MB
npm run check                    # run the watcher once
npm run dev                      # dashboard at http://localhost:3000

# Diagnose an unexpected zero result for one or more months:
npx tsx scripts/debug.ts 202703 202704
```

`npm run check` reads `.env.local`; load it into the shell first:

```bash
set -a && source .env.local && set +a
npm run check
```

## Notes & caveats

- The SAS endpoint is undocumented. Response shape: `{outbound: {YYYYMMDD: {totalPrice, isStandardAward?}}, inbound: {...}}`. If it drifts, `lib/sas.ts:parseDayMap` and `lib/sas.ts:extractDirectional` are the place to adjust.
- SAS only loads schedules ~330 days ahead. Months further out return empty calendars — not an error, just early.
- Standard award detection: `isStandardAward === true && totalPrice <= MAX_POINTS`. The boolean is the SAS-authoritative marker; the price guard protects against schema drift.
- Total runtime per check is typically 5–20s. Well under GHA's free-tier minute budget for hourly.
