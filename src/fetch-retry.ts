// Shared resilient fetch for getlos pipeline scrapers.
//
// berlin.de rate-limits aggressively (HTTP 429 "Calm down", sometimes a raw
// TCP reset that surfaces as undici's "fetch failed"). openair-kino.net and
// englishcinemaberlin.com have flaked mid-run too. One bare fetch failing
// used to abort the whole daily run (Sep 2026 outage: 11 days stale).
//
// This helper retries transient network errors + 429/5xx with exponential
// backoff and jitter, and returns 2xx/3xx/4xx(other) responses immediately
// for the caller to interpret (e.g. 404 = page gone, not worth retrying).
// If retries are exhausted, it THROWS so the scraper exits non-zero and the
// refresh script blocks the deploy instead of shipping partial data.

const RETRIES = 4;
const BASE_DELAY_MS = 2000;

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  retries: number = RETRIES,
  baseDelayMs: number = BASE_DELAY_MS,
): Promise<Response> {
  let lastErr: unknown = new Error("fetch failed before first attempt");
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, init);
      // 429 = rate limit, 5xx = server error — retryable. Everything else
      // (including 4xx like 404) is a definitive answer; return it as-is.
      if (resp.status !== 429 && (resp.status < 500 || resp.status >= 600)) {
        return resp;
      }
      lastErr = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) {
      const wait = baseDelayMs * 2 ** attempt * (1 + Math.random() * 0.5);
      const code = lastErr instanceof Error ? lastErr.message : String(lastErr);
      console.error(
        `  [retry] ${code} on ${url} — waiting ${(wait / 1000).toFixed(1)}s (attempt ${attempt + 1}/${retries})`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
