import { Resend } from 'resend';
import { ROUTE } from './config';
import type { TripPair } from './trip';

export async function sendTripEmail(pairs: TripPair[]): Promise<void> {
  if (pairs.length === 0) return;

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.RESEND_TO_EMAIL;
  const from =
    process.env.RESEND_FROM_EMAIL || 'SAS Watcher <onboarding@resend.dev>';
  if (!apiKey) throw new Error('RESEND_API_KEY missing');
  if (!to) throw new Error('RESEND_TO_EMAIL missing');

  const resend = new Resend(apiKey);

  const subject =
    `${ROUTE.outbound.from}↔${ROUTE.outbound.to}: ` +
    `${pairs.length} bookable trip${pairs.length === 1 ? '' : 's'} available`;

  // Group by outbound date for a more readable email.
  const byOutbound = new Map<string, TripPair[]>();
  for (const p of pairs) {
    const existing = byOutbound.get(p.outDate) ?? [];
    existing.push(p);
    byOutbound.set(p.outDate, existing);
  }
  const sortedOutbounds = [...byOutbound.keys()].sort();

  const blocks = sortedOutbounds
    .map((outDate) => {
      const items = byOutbound
        .get(outDate)!
        .sort((a, b) => a.retDate.localeCompare(b.retDate));
      const returns = items
        .map((p) => {
          const retHuman = humanDate(p.retDate);
          const link = bookingLink(p.outDate, p.retDate);
          return `<li><a href="${link}">${retHuman}</a> — ${p.stayDays} day stay</li>`;
        })
        .join('');
      return `<p style="margin:16px 0 4px"><strong>Outbound ${humanDate(outDate)}</strong> (returns:)</p><ul style="margin:0">${returns}</ul>`;
    })
    .join('');

  const html =
    `<p>New Eurobonus standard-award round trips for ` +
    `<strong>${ROUTE.outbound.from} ↔ ${ROUTE.outbound.to}</strong> ` +
    `(${pairs[0].outPrice.toLocaleString()} pts each way):</p>` +
    blocks +
    `<p style="color:#888;font-size:12px;margin-top:24px">Sent by your SAS Award Watcher.</p>`;

  const text = sortedOutbounds
    .map((outDate) => {
      const items = byOutbound.get(outDate)!;
      const returns = items
        .map((p) => `${humanDate(p.retDate)} (${p.stayDays}d)`)
        .join(', ');
      return `Outbound ${humanDate(outDate)} → returns: ${returns}`;
    })
    .join('\n');

  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
    text,
  });
  if (error) throw new Error(`Resend error: ${JSON.stringify(error)}`);
}

function humanDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function bookingLink(outYmd: string, retYmd: string): string {
  return (
    `https://www.sas.no/book/flights?` +
    `from=${ROUTE.outbound.from}&to=${ROUTE.outbound.to}` +
    `&outDate=${humanDate(outYmd)}&retDate=${humanDate(retYmd)}` +
    `&pax=adults-1&flow=points`
  );
}
