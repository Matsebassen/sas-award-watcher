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
import { findValidPairs, pairKey, type TripPair } from './trip';
import { sendTripEmail } from './notify';
import {
  setDirectionalSnapshot,
  getAlertedPairs,
  addAlertedPairs,
  removeAlertedPairs,
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
  durationMs: number;
};

export async function runCheck(fetcher: Fetcher): Promise<CheckResult> {
  const start = Date.now();
  const mergedOut: CalendarMap = {};
  const mergedIn: CalendarMap = {};

  for (const yyyymm of WATCH_MONTHS) {
    const data = await fetchMonth(
      ROUTE.outbound.from,
      ROUTE.outbound.to,
      yyyymm,
      fetcher,
    );
    Object.assign(mergedOut, data.outbound);
    Object.assign(mergedIn, data.inbound);
  }

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
  const rearmKeys = [...previouslyAlerted].filter((k) => !currentKeys.has(k));

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
    durationMs: Date.now() - start,
  };
}
