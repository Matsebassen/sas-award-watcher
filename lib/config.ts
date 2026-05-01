export const ROUTE = {
  outbound: { from: 'SVG', to: 'SEL' },
  inbound: { from: 'SEL', to: 'SVG' },
} as const;

export const ROUTE_KEY = `${ROUTE.outbound.from}-${ROUTE.outbound.to}`;

export const MAX_POINTS = 30000;

export const MIN_STAY_DAYS = Number.parseInt(
  process.env.MIN_STAY_DAYS ?? '14',
  10,
);
export const MAX_STAY_DAYS = Number.parseInt(
  process.env.MAX_STAY_DAYS ?? '30',
  10,
);

// Months to fetch from SAS. Each fetch returns both outbound + inbound for that
// calendar month. Include enough trailing months to cover the longest possible
// return for outbounds late in the window. Default targets March/April 2027.
export const WATCH_MONTHS: string[] = (
  process.env.WATCH_MONTHS ?? '202703,202704,202705'
)
  .split(',')
  .map((s) => s.trim())
  .filter((s) => /^\d{6}$/.test(s));
