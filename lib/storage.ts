import { Redis } from '@upstash/redis';
import type { CalendarMap, DirectionalSnapshot } from './sas';

const redis = Redis.fromEnv();

// Every key is namespaced by the route key, so routes never collide in Upstash.
function keys(routeKey: string) {
  return {
    out: `snapshot:${routeKey}:outbound`,
    in: `snapshot:${routeKey}:inbound`,
    pairs: `alerted:pairs:${routeKey}`,
    singles: `alerted:singles:${routeKey}`,
    alerts: `alerts:${routeKey}`,
    meta: `meta:${routeKey}`,
  };
}

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

export async function getDirectionalSnapshot(
  routeKey: string,
): Promise<DirectionalSnapshot> {
  const k = keys(routeKey);
  const [outbound, inbound] = await Promise.all([
    redis.get<CalendarMap>(k.out),
    redis.get<CalendarMap>(k.in),
  ]);
  return { outbound: outbound ?? {}, inbound: inbound ?? {} };
}

export async function setDirectionalSnapshot(
  routeKey: string,
  snap: DirectionalSnapshot,
): Promise<void> {
  const k = keys(routeKey);
  await Promise.all([
    redis.set(k.out, snap.outbound),
    redis.set(k.in, snap.inbound),
  ]);
}

export async function getAlertedPairs(routeKey: string): Promise<Set<string>> {
  const arr = (await redis.smembers(keys(routeKey).pairs)) ?? [];
  // Upstash auto-coerces numeric-looking strings; force back to string so
  // Set<string>.has() comparisons work.
  return new Set(arr.map((v) => String(v)));
}

export async function addAlertedPairs(
  routeKey: string,
  members: string[],
): Promise<void> {
  if (members.length === 0) return;
  await redis.sadd(keys(routeKey).pairs, ...(members as [string, ...string[]]));
}

export async function removeAlertedPairs(
  routeKey: string,
  members: string[],
): Promise<void> {
  if (members.length === 0) return;
  await redis.srem(keys(routeKey).pairs, ...(members as [string, ...string[]]));
}

export async function getAlertedSingleLegs(
  routeKey: string,
): Promise<Set<string>> {
  const arr = (await redis.smembers(keys(routeKey).singles)) ?? [];
  return new Set(arr.map((v) => String(v)));
}

export async function addAlertedSingleLegs(
  routeKey: string,
  members: string[],
): Promise<void> {
  if (members.length === 0) return;
  await redis.sadd(keys(routeKey).singles, ...(members as [string, ...string[]]));
}

export async function removeAlertedSingleLegs(
  routeKey: string,
  members: string[],
): Promise<void> {
  if (members.length === 0) return;
  await redis.srem(keys(routeKey).singles, ...(members as [string, ...string[]]));
}

export async function appendAlerts(
  routeKey: string,
  items: Alert[],
): Promise<void> {
  if (items.length === 0) return;
  const alertsKey = keys(routeKey).alerts;
  const payload = items.map((i) => JSON.stringify(i)) as [string, ...string[]];
  await redis.lpush(alertsKey, ...payload);
  await redis.ltrim(alertsKey, 0, 99);
}

export async function getAlerts(routeKey: string): Promise<Alert[]> {
  const raw = (await redis.lrange(keys(routeKey).alerts, 0, 99)) ?? [];
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

export async function setMeta(routeKey: string, meta: Meta): Promise<void> {
  await redis.set(keys(routeKey).meta, meta);
}

export async function getMeta(routeKey: string): Promise<Meta | null> {
  return await redis.get<Meta>(keys(routeKey).meta);
}
