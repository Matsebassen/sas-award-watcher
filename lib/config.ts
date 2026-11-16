export type Route = {
  key: string; // e.g. 'SVG-SEL' | 'SVG-OPO' — also the Upstash key namespace
  name: string; // destination shown in the dashboard, e.g. 'Seoul'
  outbound: { from: string; to: string };
  inbound: { from: string; to: string };
  maxPoints: number;
  minStayDays: number;
  maxStayDays: number;
  watchMonths: string[];
  watchPairs: boolean;
  watchSingles: boolean;
};

export const MAX_POINTS = 45000;

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

// SVG ↔ Seoul. Keeps the original unprefixed env overrides so its behavior and
// the GitHub Actions `vars.*` wiring are unchanged. Months to fetch: each fetch
// returns both directions for that calendar month; include enough trailing
// months to cover the longest return for outbounds late in the window.
const SEL: Route = {
  key: 'SVG-SEL',
  name: 'Seoul',
  outbound: { from: 'SVG', to: 'SEL' },
  inbound: { from: 'SEL', to: 'SVG' },
  maxPoints: MAX_POINTS,
  minStayDays: parseIntEnv(process.env.MIN_STAY_DAYS, 14),
  maxStayDays: parseIntEnv(process.env.MAX_STAY_DAYS, 30),
  watchMonths: parseMonths(process.env.WATCH_MONTHS, '202703,202704,202705'),
  watchPairs: true,
  watchSingles: true,
};

// SVG ↔ Porto, October 2027. Both legs inside October, so one month to fetch.
const OPO: Route = {
  key: 'SVG-OPO',
  name: 'Porto',
  outbound: { from: 'SVG', to: 'OPO' },
  inbound: { from: 'OPO', to: 'SVG' },
  maxPoints: parseIntEnv(process.env.OPO_MAX_POINTS, MAX_POINTS),
  minStayDays: parseIntEnv(process.env.OPO_MIN_STAY_DAYS, 3),
  maxStayDays: parseIntEnv(process.env.OPO_MAX_STAY_DAYS, 10),
  watchMonths: parseMonths(process.env.OPO_WATCH_MONTHS, '202710'),
  watchPairs: true,
  watchSingles: true,
};

export const ROUTES: Route[] = [SEL, OPO];

// Fallback route for the dashboard and scripts/debug.ts when none is picked.
export const DEFAULT_ROUTE: Route = ROUTES[0];
