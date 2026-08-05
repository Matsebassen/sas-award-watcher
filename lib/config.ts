export type Route = {
  key: string; // e.g. 'SVG-SEL' | 'SVG-BCN' — also the Upstash key namespace
  outbound: { from: string; to: string };
  inbound: { from: string; to: string };
  maxPoints: number;
  minStayDays: number;
  maxStayDays: number;
  watchMonths: string[];
  watchPairs: boolean;
  watchSingles: boolean;
  // Optional exact-date allow-lists (YYYYMMDD). When set, detection only ever
  // considers these dates for that leg — e.g. a single specific round trip
  // instead of every valid pair in the month. Undefined = whole month.
  outboundDates?: string[];
  inboundDates?: string[];
};

export const MAX_POINTS = 30000;

// Parse a comma-separated YYYYMM env var, falling back to a default list.
// GitHub Actions sets an unset `vars.X` to "" (not undefined), so a blank value
// must also fall back — otherwise the route would parse to zero months.
function parseMonths(raw: string | undefined, fallback: string): string[] {
  const src = raw && raw.trim().length > 0 ? raw : fallback;
  return src
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{6}$/.test(s));
}

function parseIntEnv(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isNaN(n) ? fallback : n;
}

// Parse a comma-separated YYYYMMDD allow-list, falling back to a default list.
// Same blank-is-unset handling as parseMonths (GHA sets unset vars to "").
function parseDates(raw: string | undefined, fallback: string): string[] {
  const src = raw && raw.trim().length > 0 ? raw : fallback;
  return src
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{8}$/.test(s));
}

// SVG ↔ Seoul. Keeps the original unprefixed env overrides so its behavior and
// the GitHub Actions `vars.*` wiring are unchanged. Months to fetch: each fetch
// returns both directions for that calendar month; include enough trailing
// months to cover the longest return for outbounds late in the window.
const SEL: Route = {
  key: 'SVG-SEL',
  outbound: { from: 'SVG', to: 'SEL' },
  inbound: { from: 'SEL', to: 'SVG' },
  maxPoints: MAX_POINTS,
  minStayDays: parseIntEnv(process.env.MIN_STAY_DAYS, 14),
  maxStayDays: parseIntEnv(process.env.MAX_STAY_DAYS, 30),
  watchMonths: parseMonths(process.env.WATCH_MONTHS, '202703,202704,202705'),
  watchPairs: true,
  watchSingles: true,
};

// SVG ↔ Barcelona. Watching one specific round trip: out Thu 22 Oct 2026, back
// Sun/Mon 25–26 Oct 2026. The date allow-lists restrict detection to exactly
// these legs; the stay window still applies (22→25 = 3d, 22→26 = 4d, both in
// range). Pairs only — a bare one-way on these dates isn't of interest.
const BCN: Route = {
  key: 'SVG-BCN',
  outbound: { from: 'SVG', to: 'BCN' },
  inbound: { from: 'BCN', to: 'SVG' },
  maxPoints: MAX_POINTS,
  minStayDays: parseIntEnv(process.env.BCN_MIN_STAY_DAYS, 2),
  maxStayDays: parseIntEnv(process.env.BCN_MAX_STAY_DAYS, 7),
  watchMonths: parseMonths(process.env.BCN_WATCH_MONTHS, '202610'),
  watchPairs: true,
  watchSingles: false,
  outboundDates: parseDates(process.env.BCN_OUTBOUND_DATES, '20261022'),
  inboundDates: parseDates(process.env.BCN_INBOUND_DATES, '20261025,20261026'),
};

export const ROUTES: Route[] = [SEL, BCN];

// The dashboard renders a single route for now.
export const DEFAULT_ROUTE: Route = ROUTES[0];
