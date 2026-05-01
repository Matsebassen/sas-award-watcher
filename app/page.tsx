import {
  getDirectionalSnapshot,
  getAlerts,
  getMeta,
} from '@/lib/storage';
import {
  ROUTE,
  MAX_POINTS,
  MIN_STAY_DAYS,
  MAX_STAY_DAYS,
  WATCH_MONTHS,
} from '@/lib/config';
import type { CalendarMap, DirectionalSnapshot } from '@/lib/sas';
import { findValidPairs } from '@/lib/trip';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [snapshot, alerts, meta] = await Promise.all([
    getDirectionalSnapshot().catch(
      () => ({ outbound: {}, inbound: {} }) as DirectionalSnapshot,
    ),
    getAlerts().catch(() => []),
    getMeta().catch(() => null),
  ]);

  const pairs = findValidPairs(snapshot.outbound, snapshot.inbound, {
    maxPoints: MAX_POINTS,
    minStayDays: MIN_STAY_DAYS,
    maxStayDays: MAX_STAY_DAYS,
  });

  return (
    <main className="mx-auto max-w-5xl p-6 font-sans">
      <header className="border-b border-zinc-200 pb-4">
        <h1 className="text-2xl font-semibold">SAS Award Watcher</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Watching <strong>{ROUTE.outbound.from} ↔ {ROUTE.outbound.to}</strong>{' '}
          for round-trips at ≤ {MAX_POINTS.toLocaleString()} pts each way, with{' '}
          {MIN_STAY_DAYS}–{MAX_STAY_DAYS} day stay.
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
          label={`Outbound (${ROUTE.outbound.from} → ${ROUTE.outbound.to})`}
          months={WATCH_MONTHS}
          calendar={snapshot.outbound}
        />
        <DirectionBlock
          label={`Inbound (${ROUTE.inbound.from} → ${ROUTE.inbound.to})`}
          months={WATCH_MONTHS}
          calendar={snapshot.inbound}
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
        Watching {WATCH_MONTHS.length} months: {WATCH_MONTHS.join(', ')}.
        Configure via env <code>WATCH_MONTHS</code>,{' '}
        <code>MIN_STAY_DAYS</code>, <code>MAX_STAY_DAYS</code>.
      </footer>
    </main>
  );
}

function DirectionBlock({
  label,
  months,
  calendar,
}: {
  label: string;
  months: string[];
  calendar: CalendarMap;
}) {
  return (
    <div>
      <h3 className="text-base font-semibold mb-2">{label}</h3>
      <div className="space-y-4">
        {months.map((m) => (
          <MonthGrid key={m} month={m} calendar={calendar} />
        ))}
      </div>
    </div>
  );
}

function MonthGrid({
  month,
  calendar,
}: {
  month: string;
  calendar: CalendarMap;
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
    if (entry?.isStandardAward && entry.totalPrice <= MAX_POINTS) {
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
