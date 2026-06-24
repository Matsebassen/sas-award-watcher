import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import { runCheck } from '../lib/check';
import type { Fetcher, FetchResult } from '../lib/sas';

// Titles Cloudflare uses on its interstitials. "Just a moment" is the classic
// managed challenge; "security verification" is the newer variant whose body
// reads "Performing security verification".
const CHALLENGE_TITLE =
  /Just a moment|security verification|Attention Required/i;

const CHALLENGE_MARKERS =
  /Just a moment|cf-mitigated|cf_chl_|__cf_chl|Attention Required|challenge-platform|enable JavaScript and cookies|Performing security verification|verifies? you are not a bot/i;

// Interactive (Turnstile) challenges never auto-solve — they need a click on a
// checkbox that lives in a cross-origin iframe behind a closed shadow root, so
// locator clicks can't reach it. Coordinate-click the widget instead: the
// checkbox sits ~28px from the left edge, vertically centered. Best-effort; a
// miss just leaves the challenge to keep polling.
async function clickTurnstile(page: Page): Promise<void> {
  const box =
    (await page
      .locator('iframe[src*="challenges.cloudflare.com"]')
      .first()
      .boundingBox()
      .catch(() => null)) ??
    (await page
      .locator('#challenge-stage')
      .boundingBox()
      .catch(() => null));
  if (!box) return;
  const x = box.x + 28;
  const y = box.y + box.height / 2;
  // Approach in two human-ish moves rather than teleporting onto the box.
  await page.mouse.move(
    x - 100 + Math.random() * 50,
    y - 50 + Math.random() * 30,
    { steps: 8 },
  );
  await page.waitForTimeout(150 + Math.random() * 250);
  await page.mouse.move(x, y, { steps: 5 });
  await page.waitForTimeout(100 + Math.random() * 200);
  await page.mouse.click(x, y);
}

// Cloudflare serves an interstitial before the real page; domcontentloaded
// fires on the challenge itself, so wait until the title changes (or a
// cf_clearance cookie appears) before letting the API fetch run. Interactive
// challenges get up to two checkbox clicks. Returns true once the page looks
// cleared; false if still challenged at the deadline. Absence of cf_clearance
// is NOT a failure — most loads pass with no challenge and never set the
// cookie, so the title check stays primary.
async function warmup(context: BrowserContext, page: Page): Promise<boolean> {
  try {
    await page.goto('https://www.sas.no/', {
      waitUntil: 'domcontentloaded',
      timeout: 35_000,
    });
  } catch {
    return false;
  }
  const deadline = Date.now() + 45_000;
  let clicks = 0;
  while (Date.now() < deadline) {
    const cookies = await context.cookies('https://www.sas.no').catch(() => []);
    if (cookies.some((c) => c.name === 'cf_clearance')) return true;
    const title = await page.title().catch(() => '');
    if (title && !CHALLENGE_TITLE.test(title)) return true;
    if (clicks < 2) {
      // Let the widget render, then try the checkbox; give the clearance
      // roundtrip a few seconds before considering a second click.
      await page.waitForTimeout(2_000);
      await clickTurnstile(page).catch(() => {});
      clicks++;
      await page.waitForTimeout(3_000);
      continue;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

// Parse PROXY_URL into Playwright's proxy shape. Cloudflare blocks the GHA
// runner's datacenter IP; routing the browser through a static *residential*
// proxy gives it a clean IP that clears most challenges on its own. Accepts a
// URL (`http://user:pass@host:port`, also socks5://) or the bare
// `host:port:user:pass` / `host:port` form many residential providers hand out.
function parseProxy(
  raw: string | undefined,
): { server: string; username?: string; password?: string } | undefined {
  const v = (raw ?? '').trim();
  if (!v) return undefined;
  if (/^\w+:\/\//.test(v)) {
    try {
      const u = new URL(v);
      const proxy: { server: string; username?: string; password?: string } = {
        server: `${u.protocol}//${u.host}`,
      };
      if (u.username) proxy.username = decodeURIComponent(u.username);
      if (u.password) proxy.password = decodeURIComponent(u.password);
      return proxy;
    } catch {
      return undefined;
    }
  }
  const p = v.split(':');
  if (p.length === 2) return { server: `http://${p[0]}:${p[1]}` };
  if (p.length === 4)
    return { server: `http://${p[0]}:${p[1]}`, username: p[2], password: p[3] };
  return undefined;
}

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
  // Headful (run under xvfb in CI). Headless Chromium is a primary Cloudflare
  // signal; a real headful Chrome clears managed challenges far more often.
  // Prefer the system Google Chrome (channel) over Playwright's bundled
  // Chromium — the real Chrome binary has a consistent TLS/JS fingerprint and
  // is preinstalled on GHA ubuntu runners. Fall back to bundled Chromium on
  // machines without Chrome.
  const launchOpts = {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  };
  let browser: Browser;
  try {
    browser = await chromium.launch({ ...launchOpts, channel: 'chrome' });
  } catch {
    browser = await chromium.launch(launchOpts);
  }
  // No userAgent override: a spoofed UA contradicts the binary's Sec-CH-UA
  // client hints and navigator.userAgentData, which is a Cloudflare signal.
  const proxy = parseProxy(process.env.PROXY_URL);
  if (proxy) {
    console.error(`[proxy] routing through ${proxy.server}`);
  } else if (process.env.PROXY_URL) {
    console.error('[proxy] PROXY_URL set but unparseable — running direct');
  }
  const context = await browser.newContext({
    locale: 'en-GB',
    viewport: { width: 1280, height: 800 },
    ...(proxy ? { proxy } : {}),
  });
  const page: Page = await context.newPage();

  // The warmup loads the full (asset-heavy) sas.no homepage every run; on a
  // metered residential proxy that bandwidth is the only real cost. Drop the
  // purely-presentational resource types (images/media/fonts) — they're not
  // needed to clear a Cloudflare challenge or to read the JSON API. Scripts,
  // stylesheets, XHR/fetch, and the document itself are left untouched, and
  // anything served from Cloudflare's challenge infrastructure is always
  // allowed so an interactive Turnstile can still render and solve.
  const BLOCKED_TYPES = new Set(['image', 'media', 'font']);
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = req.url();
    if (
      BLOCKED_TYPES.has(req.resourceType()) &&
      !url.includes('challenges.cloudflare.com') &&
      !url.includes('cdn-cgi')
    ) {
      return route.abort();
    }
    return route.continue();
  });

  await warmup(context, page);

  // Shared across all months so a few pathological fetches can't stack past
  // the workflow's 5-min timeout.
  const overallDeadline = Date.now() + 240_000;
  const MAX_ATTEMPTS = 4;

  // Navigate to the API URL instead of fetch()ing it. The SAS endpoint returns
  // application/json, which Chromium renders as text we read back. Crucially, a
  // real navigation lets the browser execute and clear a Cloudflare challenge —
  // an in-page fetch() only ever receives the challenge HTML and can never
  // solve it. When the interstitial is showing, poll until it auto-solves into
  // the JSON or we hit the deadline.
  const CHALLENGE_WAIT_MS = 30_000;
  const readBody = (): Promise<string> =>
    page.evaluate(() => document.body?.innerText ?? '').catch(() => '');

  const doFetch = async (url: string): Promise<FetchResult> => {
    let resp;
    try {
      resp = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 35_000,
      });
    } catch {
      return { ok: false, status: 0, body: '' };
    }
    const status = resp?.status() ?? 0;
    let body = await readBody();
    if (!looksLikeJson(body)) {
      const deadline = Date.now() + CHALLENGE_WAIT_MS;
      let clicked = false;
      while (Date.now() < deadline) {
        await page.waitForTimeout(500);
        body = await readBody();
        if (looksLikeJson(body)) break;
        // A settled, non-empty page that isn't a challenge is a real response
        // (e.g. a SAS error) — stop waiting and let it propagate.
        if (body && !CHALLENGE_MARKERS.test(body)) break;
        if (!clicked && CHALLENGE_MARKERS.test(body)) {
          await page.waitForTimeout(2_000);
          await clickTurnstile(page).catch(() => {});
          clicked = true;
        }
      }
    }
    const ok = looksLikeJson(body);
    return { ok, status: ok ? 200 : status, body };
  };

  // On a final (post-retries) block, capture forensics so the GHA artifact
  // tells us which challenge variant we're facing.
  const dumpBlockDiagnostics = async (): Promise<void> => {
    const title = await page.title().catch(() => '');
    const hasTurnstile = await page
      .locator('iframe[src*="challenges.cloudflare.com"]')
      .count()
      .then((n) => n > 0)
      .catch(() => false);
    console.error(
      `[block] final block — title: ${JSON.stringify(title)}, turnstile iframe: ${hasTurnstile}`,
    );
    await page
      .screenshot({ path: 'cf-block.png', fullPage: false })
      .catch(() => {});
  };

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
    if (isBlocked(result)) {
      await dumpBlockDiagnostics();
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
  let failed = false;
  try {
    const result = await runCheck(fetcher);
    console.log(JSON.stringify(result, null, 2));
    // Partial data is already persisted and alerted; the non-zero exit lets
    // the workflow's fresh-IP retry job re-fetch the missing months (dedup
    // makes the re-run idempotent).
    failed = result.failedMonths.length > 0;
  } finally {
    await close();
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
