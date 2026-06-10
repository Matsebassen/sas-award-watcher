import {
  fetchMonth,
  type CalendarMap,
  type DirectionalSnapshot,
  type Fetcher,
} from './sas';
import {
  ROUTE,
  MAX_POINTS,
  MIN_STAY_DAYS,
  MAX_STAY_DAYS,
  WATCH_MONTHS,
} from './config';
import {
  findValidPairs,
  findValidSingleLegs,
  pairKey,
  singleLegKey,
  type LegDirection,
  type TripPair,
} from './trip';
import { sendTripEmail, sendSingleLegEmail, type SingleLegAlert } from './notify';
import {
  getDirectionalSnapshot,
  setDirectionalSnapshot,
  getAlertedPairs,
  addAlertedPairs,
  removeAlertedPairs,
  getAlertedSingleLegs,
  addAlertedSingleLegs,
  removeAlertedSingleLegs,
  appendAlerts,
  setMeta,
} from './storage';

export type CheckResult = {
  ok: true;
  watchedMonths: string[];
  outboundDays: number;
  inboundDays: number;
  validPairs: number;
  newAlerts: TripPair[];
  rearmed: string[];
  newSingleLegs: SingleLegAlert[];
  rearmedSingleLegs: string[];
  failedMonths: string[];
  durationMs: number;
};

export async function runCheck(fetcher: Fetcher): Promise<CheckResult> {
  const start = Date.now();
  const mergedOut: CalendarMap = {};
  const mergedIn: CalendarMap = {};

  // A blocked month must not fail the whole run (Cloudflare blocks are
  // per-fetch and probabilistic) — but it also must not be read as "all its
  // awards disappeared". Failed months are excluded from re-arm and backfilled
  // into the persisted snapshot below.
  const failedMonths: string[] = [];
  for (const yyyymm of WATCH_MONTHS) {
    try {
      const data = await fetchMonth(
        ROUTE.outbound.from,
        ROUTE.outbound.to,
        yyyymm,
        fetcher,
      );
      Object.assign(mergedOut, data.outbound);
      Object.assign(mergedIn, data.inbound);
    } catch (err) {
      console.error(
        `[check] month ${yyyymm} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      failedMonths.push(yyyymm);
    }
  }
  if (failedMonths.length === WATCH_MONTHS.length) {
    throw new Error(`all watched months failed: ${failedMonths.join(', ')}`);
  }
  const failedMonthSet = new Set(failedMonths);
  const inFailedMonth = (yyyymmdd: string): boolean =>
    failedMonthSet.has(yyyymmdd.slice(0, 6));

  const merged: DirectionalSnapshot = {
    outbound: mergedOut,
    inbound: mergedIn,
  };

  const pairs = findValidPairs(mergedOut, mergedIn, {
    maxPoints: MAX_POINTS,
    minStayDays: MIN_STAY_DAYS,
    maxStayDays: MAX_STAY_DAYS,
  });

  const currentKeys = new Set(pairs.map(pairKey));
  const previouslyAlerted = await getAlertedPairs();

  const newPairs = pairs.filter((p) => !previouslyAlerted.has(pairKey(p)));
  // Re-arm only pairs whose dates were all actually fetched this run — a pair
  // touching a failed month is invisible, not gone.
  const rearmKeys = [...previouslyAlerted].filter(
    (k) => !currentKeys.has(k) && !k.split('-').some(inFailedMonth),
  );

  if (newPairs.length > 0) {
    await sendTripEmail(newPairs);
    await addAlertedPairs(newPairs.map(pairKey));
    await appendAlerts(
      newPairs.map((p) => ({ ...p, detectedAt: new Date().toISOString() })),
    );
  }
  if (rearmKeys.length > 0) {
    await removeAlertedPairs(rearmKeys);
  }

  const outSingles = findValidSingleLegs(mergedOut, { maxPoints: MAX_POINTS });
  const inSingles = findValidSingleLegs(mergedIn, { maxPoints: MAX_POINTS });
  const currentSingleKeys = new Set<string>([
    ...outSingles.map((d) => singleLegKey('outbound', d)),
    ...inSingles.map((d) => singleLegKey('inbound', d)),
  ]);
  const previouslyAlertedSingles = await getAlertedSingleLegs();
  const newSingleKeys = [...currentSingleKeys].filter(
    (k) => !previouslyAlertedSingles.has(k),
  );
  const rearmSingleKeys = [...previouslyAlertedSingles].filter(
    (k) => !currentSingleKeys.has(k) && !inFailedMonth(k.slice(k.indexOf(':') + 1)),
  );

  const newSingleLegs: SingleLegAlert[] = newSingleKeys.map((k) => {
    const sep = k.indexOf(':');
    const direction = k.slice(0, sep) as LegDirection;
    const date = k.slice(sep + 1);
    const price =
      (direction === 'outbound' ? mergedOut : mergedIn)[date].totalPrice;
    return { direction, date, price };
  });

  if (newSingleLegs.length > 0) {
    await sendSingleLegEmail(newSingleLegs);
    await addAlertedSingleLegs(newSingleKeys);
  }
  if (rearmSingleKeys.length > 0) {
    await removeAlertedSingleLegs(rearmSingleKeys);
  }

  // Keep the previous snapshot's data for failed months so the dashboard
  // doesn't lose them. Done after pair generation: alerts and re-arm only ever
  // see freshly fetched data.
  if (failedMonths.length > 0) {
    const prev = await getDirectionalSnapshot();
    for (const [date, day] of Object.entries(prev.outbound)) {
      if (inFailedMonth(date) && !(date in mergedOut)) mergedOut[date] = day;
    }
    for (const [date, day] of Object.entries(prev.inbound)) {
      if (inFailedMonth(date) && !(date in mergedIn)) mergedIn[date] = day;
    }
  }

  await setDirectionalSnapshot(merged);
  await setMeta({
    lastCheckedAt: new Date().toISOString(),
    lastNewAlerts: newPairs.length,
  });

  return {
    ok: true,
    watchedMonths: WATCH_MONTHS,
    outboundDays: Object.keys(mergedOut).length,
    inboundDays: Object.keys(mergedIn).length,
    validPairs: pairs.length,
    newAlerts: newPairs,
    rearmed: rearmKeys,
    newSingleLegs,
    rearmedSingleLegs: rearmSingleKeys,
    failedMonths,
    durationMs: Date.now() - start,
  };
}
