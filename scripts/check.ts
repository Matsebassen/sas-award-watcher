import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import { runCheck } from '../lib/check';
import type { Fetcher, FetchResult } from '../lib/sas';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

// Cloudflare serves a "Just a moment..." JS challenge before the real page;
// domcontentloaded fires on the challenge itself, so wait until the title
// changes (or a cf_clearance cookie appears) before letting the API fetch run.
// Returns true once the page looks cleared; false if still challenged at the
// deadline. Absence of cf_clearance is NOT a failure — most loads pass with no
// challenge and never set the cookie, so the title check stays primary.
async function warmup(context: BrowserContext, page: Page): Promise<boolean> {
  try {
    await page.goto('https://www.sas.no/', {
      waitUntil: 'domcontentloaded',
      timeout: 35_000,
    });
  } catch {
    return false;
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const cookies = await context.cookies('https://www.sas.no').catch(() => []);
    if (cookies.some((c) => c.name === 'cf_clearance')) return true;
    const title = await page.title().catch(() => '');
    if (title && !/Just a moment/i.test(title)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

const CHALLENGE_MARKERS =
  /Just a moment|cf-mitigated|cf_chl_|__cf_chl|Attention Required|challenge-platform|enable JavaScript and cookies/i;

function looksLikeJson(body: string): boolean {
  const t = body.trim();
  if (t[0] !== '{' && t[0] !== '[') return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

// A retryable block: the body is a Cloudflare challenge (at ANY status — CF
// serves it as 403/503/429 and sometimes 200), or a non-ok response whose body
// isn't JSON (transient 502/520 etc.). A non-ok response that IS valid JSON is
// a real SAS error and should propagate to fetchMonth, not be retried.
function isBlocked(r: FetchResult): boolean {
  if (CHALLENGE_MARKERS.test(r.body)) return true;
  if (!r.ok && !looksLikeJson(r.body)) return true;
  return false;
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

  await warmup(context, page);

  // Shared across all months so a few pathological fetches can't stack past the
  // workflow's 5-min timeout. Budget the fetch work to 180s, leaving room for
  // npm ci / browser install in the job.
  const overallDeadline = Date.now() + 180_000;
  const MAX_ATTEMPTS = 4;

  const doFetch = (url: string): Promise<FetchResult> =>
    page.evaluate(async (u: string) => {
      const r = await fetch(u, { credentials: 'include' });
      const body = await r.text();
      return { ok: r.ok, status: r.status, body };
    }, url);

  const fetcher: Fetcher = async (url: string) => {
    let result = await doFetch(url);
    let attempt = 1;
    while (isBlocked(result) && attempt < MAX_ATTEMPTS) {
      if (Date.now() >= overallDeadline) break;
      const cleared = await warmup(context, page);
      const wait =
        Math.min(2000 * 2 ** (attempt - 1), 15_000) +
        Math.floor(Math.random() * 1000);
      if (Date.now() + wait >= overallDeadline) break;
      console.error(
        `[retry] blocked (status ${result.status}, warmup ${
          cleared ? 'ok' : 'unconfirmed'
        }), attempt ${attempt + 1}/${MAX_ATTEMPTS} after ${wait}ms — ${url}\n` +
          `        body: ${result.body.slice(0, 80).replace(/\s+/g, ' ')}`,
      );
      await page.waitForTimeout(wait);
      result = await doFetch(url);
      attempt++;
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
