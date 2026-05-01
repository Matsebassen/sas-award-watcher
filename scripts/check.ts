import { chromium, type Browser, type Page } from 'playwright';
import { runCheck } from '../lib/check';
import type { Fetcher } from '../lib/sas';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

async function makeFetcher(): Promise<{ fetcher: Fetcher; close: () => Promise<void> }> {
  const browser: Browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: UA,
    locale: 'en-GB',
    viewport: { width: 1280, height: 800 },
  });
  const page: Page = await context.newPage();

  await page.goto('https://www.sas.no/', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  const fetcher: Fetcher = async (url: string) => {
    const result = await page.evaluate(async (u: string) => {
      const r = await fetch(u, { credentials: 'include' });
      const body = await r.text();
      return { ok: r.ok, status: r.status, body };
    }, url);
    return result;
  };

  return {
    fetcher,
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}

async function main(): Promise<void> {
  const { fetcher, close } = await makeFetcher();
  try {
    const result = await runCheck(fetcher);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
