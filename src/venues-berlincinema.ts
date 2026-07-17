// Phase: Berlin.de Cinema parser — ALL currently playing films (not just RSS new releases)
// Scrapes main cinema page for film IDs, then fetches each film detail page

import { writeFileSync } from "fs";

const INDEX_URL = "https://www.berlin.de/kino/_bin/index.php";
const BASE = "https://www.berlin.de";

interface CinemaEvent {
  source: string;
  source_id: string;
  title: string;
  description: string;
  start_datetime: string;
  end_datetime: string;
  venue_name: string;
  venue_address: string;
  latitude: number;
  longitude: number;
  categories: string[];
  event_url: string;
  ticket_url: string;
  image_url: string;
  language: string;
  last_updated: string;
}

// Step 1: Get all film IDs from the main listing page
async function fetchFilmIds(): Promise<string[]> {
  const ids = new Set<string>();

  for (let page = 1; page <= 3; page++) {
    const url = page === 1 ? INDEX_URL : `${INDEX_URL}?page=${page}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "getlos/1.0 (Berlin cinema map)" },
    });
    if (!resp.ok) break;
    const html = await resp.text();

    const matches = html.match(/\/kino\/_bin\/filmdetail\.php\/(\d+)\//g) || [];
    for (const m of matches) {
      const id = m.match(/(\d+)/)?.[1];
      if (id) ids.add(id);
    }

    if (page === 1 && ids.size === 0) break; // No films at all
  }

  return [...ids];
}

// Step 2: Fetch film detail page and extract cinemas, showtimes, and language
async function fetchFilmDetail(
  filmId: string
): Promise<{
  title: string;
  description: string;
  cinemas: Array<{ name: string; times: string[]; langs: string[]; link: string }>;
}> {
  const url = `${BASE}/kino/_bin/filmdetail.php/${filmId}/`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "getlos/1.0 (Berlin cinema map)" },
  });
  if (!resp.ok) return { title: "", description: "", cinemas: [] };
  const html = await resp.text();

  // Extract film title from <h1> or <title>
  const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/);
  const title = titleMatch
    ? titleMatch[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim()
    : `Film ${filmId}`;

  // Extract description
  const descMatch = html.match(/<meta name="description"\s+content="([^"]+)"/);
  const description = descMatch?.[1] || "";

  // Find cinema blocks
  const cinemaBlocks =
    html.match(
      /<a[^>]*href="\/kino\/_bin\/kinodetail[^"]*"[^>]*>(.*?)<\/a>[\s\S]*?(?=<a[^>]*href="\/kino\/_bin\/kinodetail|<div class="pager)/g
    ) || [];

  const cinemas: Array<{ name: string; times: string[]; langs: string[]; link: string }> = [];

  for (const block of cinemaBlocks) {
    const nameMatch = block.match(/<a[^>]*>(.*?)<\/a>/);
    if (!nameMatch) continue;
    const name = nameMatch[1].replace(/<[^>]+>/g, "").trim();

    const linkMatch = block.match(/href="(\/kino\/_bin\/kinodetail[^"]*)"/);
    const link = linkMatch ? BASE + linkMatch[1] : "";

    // Extract showtimes with language tags
    const timeLangPairs: Array<{ time: string; lang: string }> = [];
    const rawTimes = block.match(/\b(\d{1,2}:\d{2})\s*(?:\(([^)]+)\))?/g) || [];
    for (const t of rawTimes) {
      const timeMatch = t.match(/(\d{1,2}:\d{2})/);
      if (!timeMatch) continue;
      let lang = "DE";
      if (/\((OV|OmU|OmenglU|DF)\)/i.test(t)) {
        const m = t.match(/\(([^)]+)\)/);
        if (m) lang = m[1];
      }
      timeLangPairs.push({ time: timeMatch[1], lang });
    }

    if (name && timeLangPairs.length > 0) {
      cinemas.push({
        name,
        times: timeLangPairs.map((p) => p.time),
        langs: timeLangPairs.map((p) => p.lang),
        link,
      });
    }
  }

  return { title, description, cinemas };
}

// Normalize cinema names
const CINEMA_NORM: Record<string, string> = {
  "Astra-Filmpalast": "Astra Filmpalast",
  "B-ware! Ladenkino": "b-ware! Ladenkino",
  "CinemaxX Berlin": "CinemaxX Berlin Potsdamer Platz",
  "CineMotion Berlin Hohenschönhausen": "CineMotion Hohenschönhausen",
  "Filmtheater am Friedrichshain": "Filmtheater am Friedrichshain",
  "Kino Union": "Kino Union",
  "UCI Luxe East Side Gallery": "UCI Luxe East Side Gallery",
};

function normalizeCinema(name: string): string {
  return CINEMA_NORM[name] || name;
}

async function main() {
  console.log("Fetching all Berlin films from berlin.de...\n");

  // Step 1: Get all film IDs
  const filmIds = await fetchFilmIds();
  console.log(`  Films found: ${filmIds.length}`);
  if (filmIds.length === 0) {
    console.log("  No films found — writing empty output");
    writeFileSync("data/venues-berlincinema.json", "[]");
    return;
  }

  // Step 2: Fetch each film detail page
  const events: CinemaEvent[] = [];
  const allCinemas = new Set<string>();
  let processed = 0;

  for (const filmId of filmIds) {
    processed++;
    if (processed % 5 === 0) {
      process.stdout.write(`\r  Processing: ${processed}/${filmIds.length}`);
    }

    const { title, description, cinemas } = await fetchFilmDetail(filmId);

    for (const cinema of cinemas) {
      const normalizedName = normalizeCinema(cinema.name);
      allCinemas.add(normalizedName);

      for (let i = 0; i < cinema.times.length; i++) {
        const time = cinema.times[i];
        const lang = cinema.langs[i] || "DE";
        events.push({
          source: "berlincinema",
          source_id: `bc_${filmId}_${normalizedName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${time.replace(":", "")}`,
          title,
          description,
          start_datetime: `2026-07-17T${time}:00+02:00`,
          end_datetime: "",
          venue_name: normalizedName,
          venue_address: `${normalizedName}, Berlin, DE`,
          latitude: 0,
          longitude: 0,
          categories: ["film", "cinema"],
          event_url: `${BASE}/kino/_bin/filmdetail.php/${filmId}/`,
          ticket_url: cinema.link || "",
          image_url: "",
          language: lang,
          last_updated: new Date().toISOString(),
        });
      }
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 300));
  }

  writeFileSync("data/venues-berlincinema.json", JSON.stringify(events, null, 2));

  console.log(`\r  Processed: ${processed}/${filmIds.length} — ${events.length} showtimes`);
  console.log(`  Unique cinemas: ${allCinemas.size}`);
  console.log(`\nDone → data/venues-berlincinema.json`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
