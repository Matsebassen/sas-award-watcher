const BASE = 'https://www.sas.no/v2/cms-www-api/flights/calendar/prices/';

export type DayPrice = {
  totalPrice: number;
  isStandardAward: boolean;
};

export type CalendarMap = Record<string, DayPrice>;

export type DirectionalSnapshot = {
  outbound: CalendarMap;
  inbound: CalendarMap;
};

export type FetchResult = {
  ok: boolean;
  status: number;
  body: string;
};

export type Fetcher = (url: string) => Promise<FetchResult>;

export function buildMonthUrl(from: string, to: string, yyyymm: string): string {
  return (
    `${BASE}?market=no-no&from=${from}&to=${to}` +
    `&month=${yyyymm},${yyyymm}` +
    `&flow=points&type=adults-children&cepId=&product=All,All`
  );
}

export async function fetchMonth(
  outFrom: string,
  outTo: string,
  yyyymm: string,
  fetcher: Fetcher,
): Promise<DirectionalSnapshot> {
  const url = buildMonthUrl(outFrom, outTo, yyyymm);
  const res = await fetcher(url);
  if (!res.ok) {
    throw new Error(`SAS ${res.status} for ${yyyymm}: ${res.body.slice(0, 200)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw new Error(
      `SAS for ${yyyymm}: response was not JSON: ${res.body.slice(0, 200)}`,
    );
  }
  return extractDirectional(json);
}

function extractDirectional(json: unknown): DirectionalSnapshot {
  if (!json || typeof json !== 'object') {
    return { outbound: {}, inbound: {} };
  }
  const obj = json as Record<string, unknown>;
  return {
    outbound: parseDayMap(obj.outbound),
    inbound: parseDayMap(obj.inbound),
  };
}

function parseDayMap(node: unknown): CalendarMap {
  if (!node || typeof node !== 'object') return {};
  const out: CalendarMap = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (!/^\d{8}$/.test(k)) continue;
    if (!v || typeof v !== 'object') continue;
    const day = v as Record<string, unknown>;
    if (typeof day.totalPrice !== 'number') continue;
    out[k] = {
      totalPrice: day.totalPrice,
      isStandardAward: day.isStandardAward === true,
    };
  }
  return out;
}
