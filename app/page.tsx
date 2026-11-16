import Link from "next/link";
import { getDirectionalSnapshot, getAlerts, getMeta } from "@/lib/storage";
import { DEFAULT_ROUTE, ROUTES, type Route } from "@/lib/config";
import type { CalendarMap, DirectionalSnapshot } from "@/lib/sas";
import { signOut } from "@/lib/auth";
import { bookingLink } from "@/lib/notify";
import { findValidPairs, pairKey, type TripPair } from "@/lib/trip";

export const dynamic = "force-dynamic";

const EMPTY: DirectionalSnapshot = { outbound: {}, inbound: {} };
// A trip counts as "New" for this long after its alert email went out.
const NEW_FOR_MS = 24 * 60 * 60 * 1000;
// The alert log keeps 100 entries; the page shows the newest ones.
const SHOWN_ALERTS = 10;
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function pairsFor(route: Route, snapshot: DirectionalSnapshot): TripPair[] {
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

  // Snapshots for every route (each trip card shows its count); alert history
  // and meta only for the selected one.
  const [snapshots, alerts, meta] = await Promise.all([
    Promise.all(
      ROUTES.map((r) => getDirectionalSnapshot(r.key).catch(() => EMPTY)),
    ),
    getAlerts(route.key).catch(() => []),
    getMeta(route.key).catch(() => null),
  ]);

  // Server component rendered fresh on every request (force-dynamic), so
  // reading the clock here is fine.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const snapshot = snapshots[ROUTES.indexOf(route)];
  const pairs = pairsFor(route, snapshot);

  const newKeys = new Set(
    alerts
      .filter((a) => now - Date.parse(a.detectedAt) < NEW_FOR_MS)
      .map(pairKey),
  );

  // Group by outbound date, like the alert email.
  const groups = new Map<string, TripPair[]>();
  for (const p of pairs) {
    groups.set(p.outDate, [...(groups.get(p.outDate) ?? []), p]);
  }

  const withinLimit = (cal: CalendarMap) =>
    Object.values(cal).filter((d) => d.totalPrice <= route.maxPoints).length;
  const oneWayDates =
    withinLimit(snapshot.outbound) + withinLimit(snapshot.inbound);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-5 pt-7 pb-14">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-navy text-white">
            <PlaneIcon />
          </div>
          <div className="font-display text-xl font-bold tracking-tight">
            SAS Award Watcher
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-2 text-sm text-soft">
            <span aria-hidden="true" className="size-2 rounded-full bg-brand" />
            <span>
              {meta?.lastCheckedAt
                ? `Checked ${timeAgo(meta.lastCheckedAt, now)}`
                : "Not checked yet"}{" "}
              · runs every hour
            </span>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="min-h-9 cursor-pointer rounded-full px-3.5 py-2 text-sm text-soft hover:bg-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-sm font-semibold tracking-wider text-soft uppercase">
            Your trips
          </h2>
          <span className="text-sm text-muted">
            Pick a trip to see its dates
          </span>
        </div>
        <nav className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-4">
          {ROUTES.map((r, i) => {
            const active = r.key === route.key;
            const count = pairsFor(r, snapshots[i]).length;
            const metaCls = active ? "text-pale" : "text-muted";
            return (
              <Link
                key={r.key}
                href={`/?route=${r.key}`}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-42 flex-col justify-between gap-7 rounded-2xl border-2 p-5 ${
                  active
                    ? "border-navy bg-navy text-white shadow-lg shadow-navy/25"
                    : "border-line-strong bg-white hover:border-brand"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-sm font-semibold tracking-wider ${metaCls}`}
                  >
                    {r.outbound.from} → {r.outbound.to}
                  </span>
                  {active && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-navy">
                      <CheckIcon />
                      Showing
                    </span>
                  )}
                </div>
                <div className="flex items-end justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-display text-4xl leading-none font-bold tracking-tight">
                      {r.name}
                    </span>
                    <span className={`text-sm ${metaCls}`}>
                      {monthRange(r.watchMonths)}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <span className="font-display text-5xl leading-none font-bold">
                      {count}
                    </span>
                    <span className={`text-sm ${metaCls}`}>
                      bookable {count === 1 ? "trip" : "trips"}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-display text-3xl font-bold tracking-tight">
            {pairs.length} bookable {pairs.length === 1 ? "trip" : "trips"} to{" "}
            {route.name}
          </h1>
          <span className="text-sm text-muted">
            Up to {points(route.maxPoints)} pts each way · {route.minStayDays}–
            {route.maxStayDays} day stay
          </span>
        </div>

        {pairs.length === 0 ? (
          <div className="flex flex-col gap-1.5 rounded-2xl border border-dashed border-line-strong bg-white px-6 py-7">
            <span className="font-display text-xl font-semibold">
              No round trips right now
            </span>
            <span className="text-muted">
              {oneWayDates > 0
                ? `${oneWayDates} one-way ${oneWayDates === 1 ? "date is" : "dates are"} within your points limit, but no pair gives a ${route.minStayDays}–${route.maxStayDays} day stay.`
                : "No dates are within your points limit yet."}{" "}
              You get an email when one opens.
            </span>
          </div>
        ) : (
          <>
            <div className="divide-y divide-cell overflow-hidden rounded-2xl border border-line bg-white">
              {[...groups.entries()].map(([outDate, items]) => (
                <div key={outDate} className="flex flex-wrap gap-5 px-5 py-4">
                  <div className="flex basis-48 flex-col gap-0.5">
                    <Label>Fly out</Label>
                    <span className="font-display text-xl font-semibold">
                      {niceDate(outDate)}
                    </span>
                    <span className="text-sm text-muted">
                      {points(items[0].outPrice)} pts
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 basis-80 flex-col gap-2">
                    <Label>Fly home</Label>
                    <div className="flex flex-wrap gap-2">
                      {items.map((p) => (
                        <a
                          key={p.retDate}
                          href={bookingLink(route, p.outDate, p.retDate)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-11 items-center gap-2.5 rounded-xl border border-line-strong bg-ground px-3.5 py-2 text-sm hover:border-brand"
                        >
                          <span className="font-semibold">
                            {niceDate(p.retDate)}
                          </span>
                          <span className="text-muted">
                            {p.stayDays} days · {points(p.retPrice)} pts
                          </span>
                          {newKeys.has(pairKey(p)) && (
                            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">
                              New
                            </span>
                          )}
                          <ArrowIcon />
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <span className="text-sm text-muted">
              Each date opens the booking on sas.no.
            </span>
          </>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-bold">Calendar</h2>
          <div className="flex flex-wrap gap-4 text-sm text-soft">
            <Legend className="bg-brand">Within your points limit</Legend>
            <Legend className="bg-cell">Too many points</Legend>
            <Legend className="border border-dashed border-muted">
              No seats or not open yet
            </Legend>
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-4">
          <DirectionBlock
            title="Fly out"
            leg={route.outbound}
            months={route.watchMonths}
            calendar={snapshot.outbound}
            maxPoints={route.maxPoints}
          />
          <DirectionBlock
            title="Fly home"
            leg={route.inbound}
            months={route.watchMonths}
            calendar={snapshot.inbound}
            maxPoints={route.maxPoints}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-2xl font-bold">Emails sent</h2>
        {alerts.length === 0 ? (
          <span className="text-muted">No emails sent for this trip yet.</span>
        ) : (
          <div className="divide-y divide-cell rounded-2xl border border-line bg-white">
            {alerts.slice(0, SHOWN_ALERTS).map((a, i) => (
              <div
                key={`${a.outDate}-${a.retDate}-${i}`}
                className="flex flex-wrap items-center gap-3 px-5 py-3.5"
              >
                <span className="basis-40 text-sm text-muted">
                  {dateTime(a.detectedAt)}
                </span>
                <span className="flex-1 basis-56 font-medium">
                  {niceDate(a.outDate)} → {niceDate(a.retDate)}
                </span>
                <span className="text-sm text-muted">{a.stayDays} days</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-semibold tracking-wider text-muted uppercase">
      {children}
    </span>
  );
}

function Legend({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`size-3.5 rounded ${className}`} />
      {children}
    </span>
  );
}

function DirectionBlock({
  title,
  leg,
  months,
  calendar,
  maxPoints,
}: {
  title: string;
  leg: { from: string; to: string };
  months: string[];
  calendar: CalendarMap;
  maxPoints: number;
}) {
  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-line bg-white p-5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-lg font-semibold">{title}</span>
        <span className="text-sm text-muted">
          {leg.from} → {leg.to}
        </span>
      </div>
      {months.map((m) => (
        <MonthGrid
          key={m}
          month={m}
          calendar={calendar}
          maxPoints={maxPoints}
        />
      ))}
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
  const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();
  // Weeks start on Monday.
  const lead = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < lead; i++) {
    cells.push(<div key={`b-${i}`} />);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${month}${String(day).padStart(2, "0")}`;
    const entry = calendar[key];
    let cls = "border border-dashed border-line-strong text-muted";
    if (entry && entry.totalPrice <= maxPoints) {
      cls = "bg-brand text-white";
    } else if (entry) {
      cls = "bg-cell text-soft";
    }
    cells.push(
      <div
        key={key}
        className={`flex min-h-11 flex-col items-center justify-center rounded-lg ${cls}`}
      >
        <span className="text-sm leading-tight font-semibold">{day}</span>
        {entry && (
          <span className="text-[11px] leading-tight">
            {Math.round(entry.totalPrice / 1000)}k
          </span>
        )}
      </div>,
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">{monthName(month)}</span>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d) => (
          <span key={d} className="pb-0.5 text-xs text-muted">
            {d}
          </span>
        ))}
        {cells}
      </div>
    </div>
  );
}

function toDate(yyyymmdd: string): Date {
  return new Date(
    Date.UTC(
      Number.parseInt(yyyymmdd.slice(0, 4), 10),
      Number.parseInt(yyyymmdd.slice(4, 6), 10) - 1,
      Number.parseInt(yyyymmdd.slice(6, 8), 10),
    ),
  );
}

// "Thu 7 Oct"
function niceDate(yyyymmdd: string | undefined): string {
  if (!yyyymmdd || yyyymmdd.length < 8) return "?";
  return toDate(yyyymmdd).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function monthName(yyyymm: string, withYear = true): string {
  return toDate(`${yyyymm}01`).toLocaleDateString("en-GB", {
    month: "long",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  });
}

// "October 2027" or "March – May 2027"
function monthRange(months: string[]): string {
  if (months.length === 0) return "";
  const sorted = [...months].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === last) return monthName(first);
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  return `${monthName(first, !sameYear)} – ${monthName(last)}`;
}

function points(n: number): string {
  return n.toLocaleString("en-US");
}

function dateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  });
}

function timeAgo(iso: string, now: number): string {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (Number.isNaN(mins)) return iso;
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} ${mins === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function PlaneIcon() {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      className="text-brand"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}
