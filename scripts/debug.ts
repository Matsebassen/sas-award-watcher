import { chromium } from 'playwright';
import { buildMonthUrl } from '../lib/sas';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

async function main(): Promise<void> {
  const months = process.argv.slice(2);
  if (months.length === 0) {
    console.error('Usage: tsx scripts/debug.ts YYYYMM [YYYYMM ...]');
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({ userAgent: UA, locale: 'en-GB' });
  const page = await context.newPage();
  await page.goto('https://www.sas.no/', { waitUntil: 'domcontentloaded' });

  for (const month of months) {
    const url = buildMonthUrl('SVG', 'SEL', month);
    const result = await page.evaluate(async (u: string) => {
      const r = await fetch(u, { credentials: 'include' });
      return { status: r.status, body: await r.text() };
    }, url);

    console.log(`\n=== ${month} (HTTP ${result.status}) ===`);
    let json: { outbound?: Record<string, { totalPrice: number; isStandardAward?: boolean }>; inbound?: Record<string, { totalPrice: number; isStandardAward?: boolean }> };
    try {
      json = JSON.parse(result.body);
    } catch {
      console.log(result.body.slice(0, 500));
      continue;
    }
    for (const dir of ['outbound', 'inbound'] as const) {
      const map = json[dir] ?? {};
      const standardAwards = Object.entries(map)
        .filter(([, v]) => v.isStandardAward === true)
        .map(([d, v]) => `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)} (${v.totalPrice})`);
      console.log(`  ${dir}: ${Object.keys(map).length} priced days, ${standardAwards.length} standard awards`);
      if (standardAwards.length > 0) {
        console.log(`    → ${standardAwards.join(', ')}`);
      }
    }
  }

  await context.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
