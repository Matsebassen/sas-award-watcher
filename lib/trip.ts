import type { CalendarMap } from './sas';

export type TripPair = {
  outDate: string; // YYYYMMDD
  retDate: string; // YYYYMMDD
  outPrice: number;
  retPrice: number;
  stayDays: number;
};

export function pairKey(p: { outDate: string; retDate: string }): string {
  return `${p.outDate}-${p.retDate}`;
}

export function findValidPairs(
  outbound: CalendarMap,
  inbound: CalendarMap,
  opts: { maxPoints: number; minStayDays: number; maxStayDays: number },
): TripPair[] {
  const pairs: TripPair[] = [];
  const outQualifying = Object.entries(outbound)
    .filter(([, day]) => day.isStandardAward && day.totalPrice <= opts.maxPoints)
    .sort(([a], [b]) => a.localeCompare(b));
  const inQualifying = Object.entries(inbound)
    .filter(([, day]) => day.isStandardAward && day.totalPrice <= opts.maxPoints)
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [outDate, out] of outQualifying) {
    for (const [retDate, ret] of inQualifying) {
      const stay = daysBetween(outDate, retDate);
      if (stay < opts.minStayDays) continue;
      if (stay > opts.maxStayDays) continue;
      pairs.push({
        outDate,
        retDate,
        outPrice: out.totalPrice,
        retPrice: ret.totalPrice,
        stayDays: stay,
      });
    }
  }
  return pairs;
}

export function daysBetween(yyyymmddA: string, yyyymmddB: string): number {
  const a = parseDate(yyyymmddA);
  const b = parseDate(yyyymmddB);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function parseDate(yyyymmdd: string): Date {
  return new Date(
    Date.UTC(
      Number.parseInt(yyyymmdd.slice(0, 4), 10),
      Number.parseInt(yyyymmdd.slice(4, 6), 10) - 1,
      Number.parseInt(yyyymmdd.slice(6, 8), 10),
    ),
  );
}
