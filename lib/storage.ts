import { Redis } from '@upstash/redis';
import { ROUTE_KEY } from './config';
import type { CalendarMap, DirectionalSnapshot } from './sas';

const redis = Redis.fromEnv();

const SNAPSHOT_OUT_KEY = `snapshot:${ROUTE_KEY}:outbound`;
const SNAPSHOT_IN_KEY = `snapshot:${ROUTE_KEY}:inbound`;
const ALERTED_PAIRS_KEY = `alerted:pairs:${ROUTE_KEY}`;
const ALERTED_SINGLES_KEY = `alerted:singles:${ROUTE_KEY}`;
const ALERTS_KEY = `alerts:${ROUTE_KEY}`;
const META_KEY = `meta:${ROUTE_KEY}`;

export type Alert = {
  outDate: string;
  retDate: string;
  outPrice: number;
  retPrice: number;
  stayDays: number;
  detectedAt: string;
};

export type Meta = {
  lastCheckedAt: string;
  lastNewAlerts: number;
  lastError?: string;
};

export async function getDirectionalSnapshot(): Promise<DirectionalSnapshot> {
  const [outbound, inbound] = await Promise.all([
    redis.get<CalendarMap>(SNAPSHOT_OUT_KEY),
    redis.get<CalendarMap>(SNAPSHOT_IN_KEY),
  ]);
  return { outbound: outbound ?? {}, inbound: inbound ?? {} };
}

export async function setDirectionalSnapshot(
  snap: DirectionalSnapshot,
): Promise<void> {
  await Promise.all([
    redis.set(SNAPSHOT_OUT_KEY, snap.outbound),
    redis.set(SNAPSHOT_IN_KEY, snap.inbound),
  ]);
}

export async function getAlertedPairs(): Promise<Set<string>> {
  const arr = (await redis.smembers(ALERTED_PAIRS_KEY)) ?? [];
  // Upstash auto-coerces numeric-looking strings; force back to string so
  // Set<string>.has() comparisons work.
  return new Set(arr.map((v) => String(v)));
}

export async function addAlertedPairs(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await redis.sadd(ALERTED_PAIRS_KEY, ...(keys as [string, ...string[]]));
}

export async function removeAlertedPairs(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await redis.srem(ALERTED_PAIRS_KEY, ...(keys as [string, ...string[]]));
}

export async function getAlertedSingleLegs(): Promise<Set<string>> {
  const arr = (await redis.smembers(ALERTED_SINGLES_KEY)) ?? [];
  return new Set(arr.map((v) => String(v)));
}

export async function addAlertedSingleLegs(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await redis.sadd(ALERTED_SINGLES_KEY, ...(keys as [string, ...string[]]));
}

export async function removeAlertedSingleLegs(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await redis.srem(ALERTED_SINGLES_KEY, ...(keys as [string, ...string[]]));
}

export async function appendAlerts(items: Alert[]): Promise<void> {
  if (items.length === 0) return;
  const payload = items.map((i) => JSON.stringify(i)) as [string, ...string[]];
  await redis.lpush(ALERTS_KEY, ...payload);
  await redis.ltrim(ALERTS_KEY, 0, 99);
}

export async function getAlerts(): Promise<Alert[]> {
  const raw = (await redis.lrange(ALERTS_KEY, 0, 99)) ?? [];
  const out: Alert[] = [];
  for (const s of raw) {
    let parsed: unknown;
    try {
      parsed = typeof s === 'string' ? JSON.parse(s) : s;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const o = parsed as Record<string, unknown>;
    // Drop pre-refactor records that tracked single dates (had `date`, not `outDate`).
    if (typeof o.outDate !== 'string' || typeof o.retDate !== 'string') continue;
    out.push(parsed as Alert);
  }
  return out;
}

export async function setMeta(meta: Meta): Promise<void> {
  await redis.set(META_KEY, meta);
}

export async function getMeta(): Promise<Meta | null> {
  return await redis.get<Meta>(META_KEY);
}
