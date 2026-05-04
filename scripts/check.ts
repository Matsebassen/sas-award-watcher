import { chromium, type Browser, type Page } from 'playwright';
import { runCheck } from '../lib/check';
import type { Fetcher, FetchResult } from '../lib/sas';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

// Cloudflare serves a "Just a moment..." JS challenge before the real page;
// domcontentloaded fires on the challenge itself, so wait until the title
// changes before letting the API fetch run (otherwise cf_clearance is unset).
async function warmup(page: Page): Promise<void> {
  await page.goto('https://www.sas.no/', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const title = await page.title().catch(() => '');
    if (title && !/Just a moment/i.test(title)) return;
    await page.waitForTimeout(500);
  }
}

function isCloudflareBlock(r: FetchResult): boolean {
  if (r.ok) return false;
  return (
    r.status === 403 &&
    /Just a moment|cf-mitigated|cf_chl_|Attention Required/i.test(r.body)
  );
}

async function makeFetcher(): Promise<{
  fetcher: Fetcher;
  close: () => Promise<void>;
}> {
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

  await warmup(page);

  const doFetch = (url: string): Promise<FetchResult> =>
    page.evaluate(async (u: string) => {
      const r = await fetch(u, { credentials: 'include' });
      const body = await r.text();
      return { ok: r.ok, status: r.status, body };
    }, url);

  const fetcher: Fetcher = async (url: string) => {
    let result = await doFetch(url);
    if (isCloudflareBlock(result)) {
      await warmup(page);
      result = await doFetch(url);
    }
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
