// Phase: Berlin.de Cinema parser — ALL currently playing films
// Scrapes main cinema page for film IDs, then fetches each film detail page
// Extracts: showtimes, language tags, release dates, film metadata

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
  release_date: string;
  last_updated: string;
}

// Get today's date
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Parse German date "16.07.2026" → "2026-07-16"
function parseGermanDate(raw: string): string {
  const m = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
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
    if (ids.size === 0) break;
  }
  return [...ids];
}

// Step 2: Fetch film detail page
interface FilmDetail {
  title: string;
  description: string;
  releaseDate: string;
  cinemas: Array<{ name: string; times: string[]; langs: string[]; link: string }>;
}

async function fetchFilmDetail(filmId: string): Promise<FilmDetail> {
  const url = `${BASE}/kino/_bin/filmdetail.php/${filmId}/`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "getlos/1.0 (Berlin cinema map)" },
  });
  if (!resp.ok) return { title: "", description: "", releaseDate: "", cinemas: [] };
  const html = await resp.text();

  // Film title
  const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/);
  const title = titleMatch
    ? titleMatch[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim()
    : `Film ${filmId}`;

  // Description
  const descMatch = html.match(/<meta name="description"\s+content="([^"]+)"/);
  const description = descMatch?.[1] || "";

  // Release date: "ab dem 16.07.2026" or "ab 16.07.2026"
  const releaseMatch = html.match(/ab\s+(?:dem\s+)?(\d{1,2}\.\d{1,2}\.\d{4})/);
  const releaseDate = releaseMatch ? parseGermanDate(releaseMatch[1]) : "";

  // Cinema blocks
  const cinemaBlocks =
    html.match(
      /<a[^>]*href="\/kino\/_bin\/kinodetail[^"]*"[^>]*>(.*?)<\/a>[\s\S]*?(?=<a[^>]*href="\/kino\/_bin\/kinodetail|<div class="pager)/g
    ) || [];

  const cinemas: FilmDetail["cinemas"] = [];
  for (const block of cinemaBlocks) {
    const nameMatch = block.match(/<a[^>]*>(.*?)<\/a>/);
    if (!nameMatch) continue;
    const name = nameMatch[1].replace(/<[^>]+>/g, "").trim();
    const linkMatch = block.match(/href="(\/kino\/_bin\/kinodetail[^"]*)"/);
    const link = linkMatch ? BASE + linkMatch[1] : "";

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

  return { title, description, releaseDate, cinemas };
}

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
  const todayStr = today();
  console.log(`Fetching all Berlin films from berlin.de (date: ${todayStr})...\n`);

  const filmIds = await fetchFilmIds();
  console.log(`  Films found: ${filmIds.length}`);
  if (filmIds.length === 0) {
    writeFileSync("data/venues-berlincinema.json", "[]");
    return;
  }

  const events: CinemaEvent[] = [];
  const allCinemas = new Set<string>();
  const now = new Date().toISOString();
  let processed = 0;

  for (const filmId of filmIds) {
    processed++;
    if (processed % 5 === 0) process.stdout.write(`\r  Processing: ${processed}/${filmIds.length}`);

    const { title, description, releaseDate, cinemas } = await fetchFilmDetail(filmId);

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
          start_datetime: `${todayStr}T${time}:00+02:00`,
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
          release_date: releaseDate,
          last_updated: now,
        });
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  writeFileSync("data/venues-berlincinema.json", JSON.stringify(events, null, 2));

  const newReleases = events.filter((e) => e.release_date === todayStr).length;
  console.log(`\r  Processed: ${processed}/${filmIds.length} — ${events.length} showtimes`);
  console.log(`  Cinemas: ${allCinemas.size}`);
  console.log(`  New today: ${newReleases} showtimes`);
  console.log(`\nDone → data/venues-berlincinema.json`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
