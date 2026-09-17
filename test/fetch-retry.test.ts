// Unit tests for the shared fetch retry helper.
//
// Locks in the Sep 2026 outage fix: transient network errors ("fetch failed"
// from undici) and berlin.de's burst 429s must retry with backoff, definitive
// 4xx must not retry, and exhausted retries must THROW so the scraper exits
// non-zero and the deploy gate blocks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithRetry } from "../src/fetch-retry";

const URL_ = "https://example.test/page";
const NO_DELAY = 0; // keep tests fast — prod default is 2000ms

test("returns the response immediately on 200", async (t) => {
  const f = t.mock.method(globalThis, "fetch", async () => new Response("ok", { status: 200 }));
  const r = await fetchWithRetry(URL_, {}, 4, NO_DELAY);
  assert.equal(r.status, 200);
  assert.equal(f.mock.callCount(), 1);
});

test("retries a 429 and succeeds when the limiter cools down", async (t) => {
  let calls = 0;
  const f = t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(calls === 1 ? "calm down" : "ok", { status: calls === 1 ? 429 : 200 });
  });
  const r = await fetchWithRetry(URL_, {}, 4, NO_DELAY);
  assert.equal(r.status, 200);
  assert.equal(calls, 2);
  assert.equal(f.mock.callCount(), 2);
});

test("retries a network error (undici 'fetch failed') and succeeds", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 1) throw new TypeError("fetch failed");
    return new Response("ok", { status: 200 });
  });
  const r = await fetchWithRetry(URL_, {}, 4, NO_DELAY);
  assert.equal(r.status, 200);
  assert.equal(calls, 2);
});

test("retries 5xx server errors", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response("boom", { status: calls <= 2 ? 503 : 200 });
  });
  const r = await fetchWithRetry(URL_, {}, 4, NO_DELAY);
  assert.equal(r.status, 200);
  assert.equal(calls, 3);
});

test("throws after exhausting retries on persistent 429", async (t) => {
  const f = t.mock.method(globalThis, "fetch", async () => new Response("calm down", { status: 429 }));
  await assert.rejects(() => fetchWithRetry(URL_, {}, 2, NO_DELAY), /HTTP 429/);
  assert.equal(f.mock.callCount(), 3); // initial attempt + 2 retries
});

test("throws after exhausting retries on persistent network errors", async (t) => {
  const f = t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(() => fetchWithRetry(URL_, {}, 2, NO_DELAY), /fetch failed/);
  assert.equal(f.mock.callCount(), 3);
});

test("does NOT retry definitive 4xx (e.g. 404 — page gone)", async (t) => {
  const f = t.mock.method(globalThis, "fetch", async () => new Response("nope", { status: 404 }));
  const r = await fetchWithRetry(URL_, {}, 4, NO_DELAY);
  assert.equal(r.status, 404);
  assert.equal(f.mock.callCount(), 1);
});
