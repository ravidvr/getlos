// Regression tests for the berlin.de cinema scraper.
//
// Fixtures are REAL captures of berlin.de pages (Sep 2026) — never edit them
// without re-verifying the assertions against the live parser output.
//
// Locks in:
//  1. Index parsing (film ID extraction) — a layout change yields 0 IDs.
//  2. Film-detail parsing — the fragile cinemaPattern/dayPattern regexes,
//     including the lookahead that must keep the LAST cinema block.
//  3. THE SEP 2026 OUTAGE BUG: on an empty index result, main() must THROW
//     and leave data/venues-berlincinema.json untouched — never write [].

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  parseFilmIdsFromHtml,
  parseGermanDate,
  fetchFilmDetail,
  main,
} from "../src/venues-berlincinema.ts";

const FIX = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);
const INDEX_HTML = readFileSync(FIX("berlinde-index.html"), "utf8");
const FILM_HTML = readFileSync(FIX("berlinde-filmdetail.html"), "utf8");

test("index fixture parses to the expected film IDs", () => {
  const ids = parseFilmIdsFromHtml(INDEX_HTML);
  assert.equal(ids.size, 36);
  assert.ok(ids.has("315264"), "first fixture film ID present");
  assert.ok(ids.has("315041"), "second fixture film ID present");
});

test("index parser returns empty set when layout changes (no filmdetail links)", () => {
  const ids = parseFilmIdsFromHtml("<html><body>no films today</body></html>");
  assert.equal(ids.size, 0);
});

test("parseGermanDate handles 2-digit and 4-digit years", () => {
  assert.equal(parseGermanDate("20.07.26"), "2026-07-20");
  assert.equal(parseGermanDate("17.09.2026"), "2026-09-17");
  assert.equal(parseGermanDate("3.1.26"), "2026-01-03");
  assert.equal(parseGermanDate("no date here"), "");
});

test("film detail fixture parses title, release date, cinemas, showtimes, languages", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(FILM_HTML, { status: 200 }));
  const r = await fetchFilmDetail("315264");

  assert.equal(r.title, "Spider-Man: Brand New Day");
  assert.equal(r.releaseDate, "2026-09-17");

  // The lookahead must keep the LAST cinema block: if the regex regresses
  // (e.g. drops `|$`), the final block disappears and this count falls.
  assert.equal(r.cinemas.length, 520);

  // No garbage names from boilerplate stripping
  assert.equal(r.cinemas.filter((c) => !c.name || c.name.length < 3).length, 0);

  const langs: Record<string, number> = {};
  const dates = new Set<string>();
  for (const c of r.cinemas) {
    c.langs.forEach((l) => (langs[l] = (langs[l] || 0) + 1));
    c.dates.forEach((d) => dates.add(d));
  }
  assert.deepEqual(langs, { DE: 457, OmU: 21, OV: 42 });
  assert.equal(dates.size, 7);
  assert.ok(dates.has("2026-09-17") && dates.has("2026-09-23"), "7-day window covered");

  // Spot-check a known entry: name cleaned of the "Kinos wird der Film gezeigt" prefix
  const astra = r.cinemas.find((c) => c.name === "Astra-Filmpalast");
  assert.ok(astra, "Astra-Filmpalast present");
  assert.deepEqual(astra.times[0], "19:30");
  assert.deepEqual(astra.langs[0], "DE");
});

test("NO-WIPE: empty index result throws and leaves data/venues-berlincinema.json untouched", async (t) => {
  const dataPath = "data/venues-berlincinema.json";
  const before = existsSync(dataPath) ? readFileSync(dataPath, "utf8") : null;

  // Simulates the Sep 16, 2026 failure: page returns 200 but contains no film
  // links (layout change or bot-page). The scraper must NOT write [].
  t.mock.method(globalThis, "fetch", async () => new Response("<html>nothing here</html>", { status: 200 }));

  await assert.rejects(() => main(), /no film IDs/);

  const after = existsSync(dataPath) ? readFileSync(dataPath, "utf8") : null;
  assert.equal(after, before, "data file must be byte-identical after a failed index fetch");
  assert.ok(!before || before.trim().startsWith("["), "sanity: data file existed and is JSON");
});
