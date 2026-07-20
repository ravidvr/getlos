// Phase: Berlin.de Cinema parser — ALL films across ALL days
// Strips HTML, parses plain text for cinema + day-labeled showtimes

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

function today(): string { return new Date().toISOString().slice(0, 10); }

function parseGermanDate(raw: string): string {
  const m = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return "";
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&ouml;/g, "ö").replace(/&auml;/g, "ä")
    .replace(/&uuml;/g, "ü").replace(/&szlig;/g, "ß")
    .replace(/&Ouml;/g, "Ö").replace(/&Auml;/g, "Ä").replace(/&Uuml;/g, "Ü")
    .replace(/&eacute;/g, "é").replace(/&agrave;/g, "à")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchFilmIds(): Promise<string[]> {
  const ids = new Set<string>();
  for (let page = 1; page <= 3; page++) {
    const url = page === 1 ? INDEX_URL : `${INDEX_URL}?page=${page}`;
    const resp = await fetch(url, { headers: { "User-Agent": "getlos/1.0" } });
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

async function fetchFilmDetail(filmId: string): Promise<{
  title: string; description: string; releaseDate: string;
  cinemas: Array<{ name: string; times: string[]; dates: string[]; langs: string[] }>;
}> {
  const url = `${BASE}/kino/_bin/filmdetail.php/${filmId}/`;
  const resp = await fetch(url, { headers: { "User-Agent": "getlos/1.0" } });
  if (!resp.ok) return { title: "", description: "", releaseDate: "", cinemas: [] };
  const html = await resp.text();
  const text = stripHtml(html);

  // Film title from <h1>
  const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/);
  const title = titleMatch ? stripHtml(titleMatch[1]) : `Film ${filmId}`;

  // Description
  const descMatch = html.match(/<meta name="description"\s+content="([^"]+)"/);
  const description = descMatch?.[1] || "";

  // Release date
  const releaseMatch = text.match(/ab\s+(?:dem\s+)?(\d{1,2}\.\d{1,2}\.\d{4})/);
  const releaseDate = releaseMatch ? parseGermanDate(releaseMatch[1]) : "";

  // Parse cinema blocks from plain text
  // Pattern: Cinema Name (Bezirk) "Film Title" ... Tag Zeit DAY, DD.MM.YY HH:MM, HH:MM
  const cinemaPattern = /([A-ZÄÖÜ][^()]{2,45})\s*\([^)]+\)\s*"[^"]*"\s*läuft[^:]*:\s*Tag\s*Zeit\s*(.*?)(?=[A-ZÄÖÜ][^()]{2,45}\s*\([^)]+\)\s*"[^"]*"\s*läuft|<!--)/g;
  
  const cinemas: Array<{ name: string; times: string[]; dates: string[]; langs: string[] }> = [];
  let cm;
  while ((cm = cinemaPattern.exec(text)) !== null) {
    // Strip page boilerplate and leaked day/time tokens from the captured name
    // "Kinos wird der Film gezeigt Astra-Filmpalast" → "Astra-Filmpalast"
    // "Tag Zeit Di, 21.07.26 11:15 Kino im Hof" → "Kino im Hof"
    // Day abbrevs require the comma so "Movietown"/"Freiluftkino" stay intact.
    const cinemaName = cm[1]
      .replace(/^.*?(?:Kinos wird der Film gezeigt|Film gezeigt|Tag\s+Zeit)\s*/i, "")
      .replace(/^(?:(?:Mo|Di|Mi|Do|Fr|Sa|So),\s*|\d{1,2}\.\d{1,2}\.\d{2,4}\s*|\d{1,2}:\d{2}\s*|\([A-Za-z]+\)\s*|,\s*)+/, "")
      .trim();
    if (!cinemaName || cinemaName.length < 3) continue;
    const showtimeText = cm[2];

    // Parse day sections within this cinema
    const dayPattern = /(Mo|Di|Mi|Do|Fr|Sa|So),\s*(\d{1,2}\.\d{1,2}\.\d{2})\s*([\d,:\s(OV|OmU|OmenglU|DF)]+?)(?=(?:Mo|Di|Mi|Do|Fr|Sa|So),\s*\d{1,2}\.\d{1,2}\.\d{2}|$)/g;
    let dm;
    while ((dm = dayPattern.exec(showtimeText)) !== null) {
      const dateStr = parseGermanDate(dm[2]);
      if (!dateStr) continue;
      const timesRaw = dm[3];

      // Extract individual times with language tags
      const timePattern = /(\d{1,2}:\d{2})\s*(?:\(([^)]+)\))?/g;
      let tm;
      while ((tm = timePattern.exec(timesRaw)) !== null) {
        let lang = "DE";
        if (tm[2] && /^(OV|OmU|OmenglU|DF)$/i.test(tm[2])) lang = tm[2];
        cinemas.push({
          name: cinemaName,
          times: [tm[1]],
          dates: [dateStr],
          langs: [lang],
        });
      }
    }
  }

  return { title, description, releaseDate, cinemas };
}

const CINEMA_NORM: Record<string, string> = {
  "Astra-Filmpalast": "Astra Filmpalast",
  "B-ware! Ladenkino": "b-ware! Ladenkino",
  "CinemaxX Berlin": "CinemaxX Berlin Potsdamer Platz",
  "CineMotion Berlin Hohenschönhausen": "CineMotion Hohenschönhausen",
  "Kino Union": "Kino Union",
};

function normalizeCinema(name: string): string { return CINEMA_NORM[name] || name; }

async function main() {
  const todayStr = today();
  console.log(`Fetching all Berlin films (date: ${todayStr})...\n`);

  const filmIds = await fetchFilmIds();
  console.log(`  Films found: ${filmIds.length}`);
  if (!filmIds.length) { writeFileSync("data/venues-berlincinema.json", "[]"); return; }

  const events: CinemaEvent[] = [];
  const allCinemas = new Set<string>();
  const now = new Date().toISOString();
  let processed = 0;

  for (const filmId of filmIds) {
    processed++;
    if (processed % 5 === 0) process.stdout.write(`\r  Processing: ${processed}/${filmIds.length}`);
    
    const { title, description, releaseDate, cinemas } = await fetchFilmDetail(filmId);
    
    // Group per-cinema entries back together (they're flattened per-showtime)
    // Actually they're already properly structured — just use directly
    for (const cinema of cinemas) {
      const normalizedName = normalizeCinema(cinema.name);
      allCinemas.add(normalizedName);
      
      events.push({
        source: "berlincinema",
        source_id: `bc_${filmId}_${normalizedName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${cinema.dates[0]}_${cinema.times[0].replace(":", "")}`,
        title, description,
        start_datetime: `${cinema.dates[0]}T${cinema.times[0]}:00+02:00`,
        end_datetime: "",
        venue_name: normalizedName,
        venue_address: `${normalizedName}, Berlin, DE`,
        latitude: 0, longitude: 0,
        categories: ["film", "cinema"],
        event_url: `${BASE}/kino/_bin/filmdetail.php/${filmId}/`,
        ticket_url: "",
        image_url: "",
        language: cinema.langs[0],
        release_date: releaseDate,
        last_updated: now,
      });
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  // Deduplicate by source_id (cinemaPattern can produce overlapping matches)
  const seen = new Set<string>();
  const deduped: CinemaEvent[] = [];
  for (const e of events) {
    if (!seen.has(e.source_id)) {
      seen.add(e.source_id);
      deduped.push(e);
    }
  }

  writeFileSync("data/venues-berlincinema.json", JSON.stringify(deduped, null, 2));

  const dates = [...new Set(deduped.map(e => e.start_datetime.slice(0, 10)))].sort();
  console.log(`\r  Processed: ${processed}/${filmIds.length} — ${deduped.length} showtimes across ${dates.length} days (${events.length - deduped.length} dupes removed)`);
  console.log(`  Cinemas: ${allCinemas.size}`);
  console.log(`  Date range: ${dates[0]} to ${dates[dates.length-1]}`);
  console.log(`\nDone → data/venues-berlincinema.json`);
}

main().catch((err) => { console.error("Fatal:", err.message); process.exit(1); });
