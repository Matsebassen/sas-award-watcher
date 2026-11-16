import {
  fetchMonth,
  type CalendarMap,
  type DirectionalSnapshot,
  type Fetcher,
} from './sas';
import type { Route } from './config';
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

export async function runCheck(
  fetcher: Fetcher,
  route: Route,
): Promise<CheckResult> {
  const start = Date.now();
  const mergedOut: CalendarMap = {};
  const mergedIn: CalendarMap = {};

  // A blocked month must not fail the whole run (Cloudflare blocks are
  // per-fetch and probabilistic) — but it also must not be read as "all its
  // awards disappeared". Failed months are excluded from re-arm and backfilled
  // into the persisted snapshot below.
  const failedMonths: string[] = [];
  for (const yyyymm of route.watchMonths) {
    try {
      const data = await fetchMonth(
        route.outbound.from,
        route.outbound.to,
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
  if (failedMonths.length === route.watchMonths.length) {
    throw new Error(`all watched months failed: ${failedMonths.join(', ')}`);
  }
  const failedMonthSet = new Set(failedMonths);
  const inFailedMonth = (yyyymmdd: string): boolean =>
    failedMonthSet.has(yyyymmdd.slice(0, 6));

  const merged: DirectionalSnapshot = {
    outbound: mergedOut,
    inbound: mergedIn,
  };

  const pairs = route.watchPairs
    ? findValidPairs(mergedOut, mergedIn, {
        maxPoints: route.maxPoints,
        minStayDays: route.minStayDays,
        maxStayDays: route.maxStayDays,
      })
    : [];

  let newPairs: TripPair[] = [];
  let rearmKeys: string[] = [];
  if (route.watchPairs) {
    const currentKeys = new Set(pairs.map(pairKey));
    const previouslyAlerted = await getAlertedPairs(route.key);

    newPairs = pairs.filter((p) => !previouslyAlerted.has(pairKey(p)));
    // Re-arm only pairs whose dates were all actually fetched this run — a pair
    // touching a failed month is invisible, not gone.
    rearmKeys = [...previouslyAlerted].filter(
      (k) => !currentKeys.has(k) && !k.split('-').some(inFailedMonth),
    );

    if (newPairs.length > 0) {
      await sendTripEmail(route, newPairs);
      await addAlertedPairs(route.key, newPairs.map(pairKey));
      await appendAlerts(
        route.key,
        newPairs.map((p) => ({ ...p, detectedAt: new Date().toISOString() })),
      );
    }
    if (rearmKeys.length > 0) {
      await removeAlertedPairs(route.key, rearmKeys);
    }
  }

  let newSingleLegs: SingleLegAlert[] = [];
  let rearmSingleKeys: string[] = [];
  if (route.watchSingles) {
    const outSingles = findValidSingleLegs(mergedOut, {
      maxPoints: route.maxPoints,
    });
    const inSingles = findValidSingleLegs(mergedIn, {
      maxPoints: route.maxPoints,
    });
    const currentSingleKeys = new Set<string>([
      ...outSingles.map((d) => singleLegKey('outbound', d)),
      ...inSingles.map((d) => singleLegKey('inbound', d)),
    ]);
    const previouslyAlertedSingles = await getAlertedSingleLegs(route.key);
    const newSingleKeys = [...currentSingleKeys].filter(
      (k) => !previouslyAlertedSingles.has(k),
    );
    rearmSingleKeys = [...previouslyAlertedSingles].filter(
      (k) =>
        !currentSingleKeys.has(k) && !inFailedMonth(k.slice(k.indexOf(':') + 1)),
    );

    newSingleLegs = newSingleKeys.map((k) => {
      const sep = k.indexOf(':');
      const direction = k.slice(0, sep) as LegDirection;
      const date = k.slice(sep + 1);
      const price =
        (direction === 'outbound' ? mergedOut : mergedIn)[date].totalPrice;
      return { direction, date, price };
    });

    if (newSingleLegs.length > 0) {
      await sendSingleLegEmail(route, newSingleLegs);
      await addAlertedSingleLegs(route.key, newSingleKeys);
    }
    if (rearmSingleKeys.length > 0) {
      await removeAlertedSingleLegs(route.key, rearmSingleKeys);
    }
  }

  // Keep the previous snapshot's data for failed months so the dashboard
  // doesn't lose them. Done after pair generation: alerts and re-arm only ever
  // see freshly fetched data.
  if (failedMonths.length > 0) {
    const prev = await getDirectionalSnapshot(route.key);
    for (const [date, day] of Object.entries(prev.outbound)) {
      if (inFailedMonth(date) && !(date in mergedOut)) mergedOut[date] = day;
    }
    for (const [date, day] of Object.entries(prev.inbound)) {
      if (inFailedMonth(date) && !(date in mergedIn)) mergedIn[date] = day;
    }
  }

  await setDirectionalSnapshot(route.key, merged);
  await setMeta(route.key, {
    lastCheckedAt: new Date().toISOString(),
    lastNewAlerts: newPairs.length,
  });

  return {
    ok: true,
    watchedMonths: route.watchMonths,
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
