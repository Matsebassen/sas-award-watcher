import Link from 'next/link';
import {
  getDirectionalSnapshot,
  getAlerts,
  getMeta,
} from '@/lib/storage';
import { DEFAULT_ROUTE, ROUTES, type Route } from '@/lib/config';
import type { CalendarMap, DirectionalSnapshot } from '@/lib/sas';
import { findValidPairs } from '@/lib/trip';

export const dynamic = 'force-dynamic';

const EMPTY: DirectionalSnapshot = { outbound: {}, inbound: {} };

function pairsFor(route: Route, snapshot: DirectionalSnapshot) {
  return findValidPairs(snapshot.outbound, snapshot.inbound, {
    maxPoints: route.maxPoints,
    minStayDays: route.minStayDays,
    maxStayDays: route.maxStayDays,
  });
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const requested = (await searchParams).route;
  const route = ROUTES.find((r) => r.key === requested) ?? DEFAULT_ROUTE;

  // Snapshots for every route (the tabs show each trip count); alert history
  // and meta only for the selected one.
  const [snapshots, alerts, meta] = await Promise.all([
    Promise.all(
      ROUTES.map((r) => getDirectionalSnapshot(r.key).catch(() => EMPTY)),
    ),
    getAlerts(route.key).catch(() => []),
    getMeta(route.key).catch(() => null),
  ]);

  const snapshot = snapshots[ROUTES.indexOf(route)];
  const pairs = pairsFor(route, snapshot);

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6 font-sans">
      <header className="border-b border-zinc-200 pb-4">
        <h1 className="text-2xl font-semibold">SAS Award Watcher</h1>
        <nav className="mt-3 flex flex-wrap gap-2">
          {ROUTES.map((r, i) => {
            const active = r.key === route.key;
            return (
              <Link
                key={r.key}
                href={`/?route=${r.key}`}
                aria-current={active ? 'page' : undefined}
                className={`rounded-full border px-3 py-1 text-sm ${
                  active
                    ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                {r.name}{' '}
                <span className={active ? 'text-zinc-300' : 'text-zinc-400'}>
                  {pairsFor(r, snapshots[i]).length}
                </span>
              </Link>
            );
          })}
        </nav>
        <p className="mt-3 text-sm text-zinc-500">
          Watching <strong>{route.outbound.from} ↔ {route.outbound.to}</strong>{' '}
          for round-trips at ≤ {route.maxPoints.toLocaleString()} pts each way,
          with {route.minStayDays}–{route.maxStayDays} day stay.
        </p>
        <p className="mt-1 text-sm">
          Last checked:{' '}
          <span className="font-mono">{meta?.lastCheckedAt ?? 'never'}</span>
          {meta?.lastNewAlerts != null && (
            <>
              {' '}· new on last run: <strong>{meta.lastNewAlerts}</strong>
            </>
          )}
        </p>
      </header>

      <section className="mt-6">
        <h2 className="text-xl font-semibold">
          Bookable trips ({pairs.length})
        </h2>
        {pairs.length === 0 ? (
          <p className="text-sm text-zinc-500 mt-2">
            No bookable round-trips at the moment in the watched window.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm font-mono">
            {pairs.map((p) => (
              <li key={`${p.outDate}-${p.retDate}`}>
                {humanDate(p.outDate)} → {humanDate(p.retDate)}{' '}
                <span className="text-zinc-500">
                  ({p.stayDays}d, {p.outPrice.toLocaleString()}+
                  {p.retPrice.toLocaleString()} pts)
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-8">
        <DirectionBlock
          label={`Outbound (${route.outbound.from} → ${route.outbound.to})`}
          months={route.watchMonths}
          calendar={snapshot.outbound}
          maxPoints={route.maxPoints}
        />
        <DirectionBlock
          label={`Inbound (${route.inbound.from} → ${route.inbound.to})`}
          months={route.watchMonths}
          calendar={snapshot.inbound}
          maxPoints={route.maxPoints}
        />
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Alert history</h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-zinc-500 mt-2">No alerts yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm font-mono">
            {alerts.map((a, i) => (
              <li key={`${a.outDate}-${a.retDate}-${i}`}>
                {a.detectedAt} — {humanDate(a.outDate)} →{' '}
                {humanDate(a.retDate)} ({a.stayDays}d)
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-10 text-xs text-zinc-400">
        Watching {route.watchMonths.length} month
        {route.watchMonths.length === 1 ? '' : 's'}:{' '}
        {route.watchMonths.join(', ')}. Routes are set up in{' '}
        <code>lib/config.ts</code>.
      </footer>
    </main>
  );
}

function DirectionBlock({
  label,
  months,
  calendar,
  maxPoints,
}: {
  label: string;
  months: string[];
  calendar: CalendarMap;
  maxPoints: number;
}) {
  return (
    <div>
      <h3 className="text-base font-semibold mb-2">{label}</h3>
      <div className="space-y-4">
        {months.map((m) => (
          <MonthGrid
            key={m}
            month={m}
            calendar={calendar}
            maxPoints={maxPoints}
          />
        ))}
      </div>
    </div>
  );
}

function MonthGrid({
  month,
  calendar,
  maxPoints,
}: {
  month: string;
  calendar: CalendarMap;
  maxPoints: number;
}) {
  const year = Number.parseInt(month.slice(0, 4), 10);
  const m = Number.parseInt(month.slice(4, 6), 10);
  const daysInMonth = new Date(year, m, 0).getDate();
  const firstDow = new Date(year, m - 1, 1).getDay();

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDow; i++) {
    cells.push(<div key={`b-${i}`} />);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${month}${String(day).padStart(2, '0')}`;
    const entry = calendar[key];
    let cls = 'bg-zinc-100 text-zinc-400';
    if (entry && entry.totalPrice <= maxPoints) {
      cls = 'bg-emerald-200 text-emerald-900';
    } else if (entry) {
      cls = 'bg-amber-50 text-amber-900';
    }
    cells.push(
      <div
        key={key}
        className={`aspect-square rounded p-1 text-[10px] leading-tight ${cls}`}
      >
        <div className="font-semibold">{day}</div>
        {entry && (
          <div className="font-mono">
            {(entry.totalPrice / 1000).toFixed(0)}k
          </div>
        )}
      </div>,
    );
  }

  const monthName = new Date(year, m - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div>
      <h4 className="text-xs font-semibold mb-1">{monthName}</h4>
      <div className="grid grid-cols-7 gap-1 text-center">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <div key={d} className="text-[10px] text-zinc-400">
            {d}
          </div>
        ))}
        {cells}
      </div>
    </div>
  );
}

function humanDate(yyyymmdd: string | undefined): string {
  if (!yyyymmdd || yyyymmdd.length < 8) return '?';
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}
