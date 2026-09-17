// Regression tests for the openair-kino.net scraper.
//
// Fixture is a REAL capture of the Berlin category page (Sep 2026).
//
// Locks in:
//  1. Cinema discovery parsing from the category page.
//  2. THE SEP 2026 OUTAGE BUG: when discovery fails/returns nothing, main()
//     must THROW and leave data/venues-openair.json untouched — never write [].

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fetchBerlinCinemaUrls, main } from "../src/venues-openair.ts";

const FIX = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);
const CATEGORY_HTML = readFileSync(FIX("openair-category.html"), "utf8");

test("category fixture parses to the expected cinema URLs", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(CATEGORY_HTML, { status: 200 }));
  const urls = await fetchBerlinCinemaUrls();
  assert.equal(urls.length, 39);
  assert.ok(
    urls.includes("https://openair-kino.net/category/berlin/charlottenburg/open-air-kino-im-kranzler-eck/"),
    "known cinema URL present",
  );
  // Every URL must be a full cinema path (bezirk/cinema/), never a bare bezirk page
  for (const u of urls) {
    const parts = u.replace(/^https:\/\/openair-kino\.net\/category\/berlin\//, "").replace(/\/$/, "").split("/");
    assert.equal(parts.length, 2, `not a bezirk-only page: ${u}`);
  }
});

test("NO-WIPE: empty category result throws and leaves data/venues-openair.json untouched", async (t) => {
  const dataPath = "data/venues-openair.json";
  const before = existsSync(dataPath) ? readFileSync(dataPath, "utf8") : null;

  // Simulates the Sep 17, 2026 failure: Step 1 dies / returns no cinemas.
  // The scraper must NOT write [].
  t.mock.method(globalThis, "fetch", async () => new Response("<html>no cinemas here</html>", { status: 200 }));

  await assert.rejects(() => main(), /no Berlin cinemas/);

  const after = existsSync(dataPath) ? readFileSync(dataPath, "utf8") : null;
  assert.equal(after, before, "data file must be byte-identical after failed discovery");
});
