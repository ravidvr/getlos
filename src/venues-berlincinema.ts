// Phase: Berlin.de Cinema parser — all languages, all cinemas
// RSS feed → film detail pages → cinema + showtime extraction

import { writeFileSync } from "fs";

const RSS_URL = "https://www.berlin.de/kino/_bin/rss.php";
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

interface FilmEntry {
  title: string;
  link: string;
  description: string;
  image?: string;
}

async function fetchRSS(): Promise<FilmEntry[]> {
  const resp = await fetch(RSS_URL, {
    headers: { "User-Agent": "getlos/1.0 (Berlin events map)" },
  });
  if (!resp.ok) throw new Error(`RSS HTTP ${resp.status}`);
  const xml = await resp.text();

  const films: FilmEntry[] = [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  for (const item of items) {
    const title = item.match(/<title>(.*?)<\/title>/)?.[1]
      ?.replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim() || "";
    const link = item.match(/<link>(.*?)<\/link>/)?.[1]?.trim() || "";
    const desc = item.match(/<description>(.*?)<\/description>/)?.[1]
      ?.replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
      .replace(/&amp;/g, "&")
      .trim() || "";
    const img = item.match(/<enclosure[^>]*url="([^"]+)"/)?.[1] || "";

    if (title && link) {
      films.push({ title, link, description: desc, image: img });
    }
  }

  return films;
}

async function fetchFilmDetail(url: string): Promise<{ cinemas: Array<{ name: string; times: string[]; link: string; langs: string[] }>; description: string }> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "getlos/1.0 (Berlin events map)" },
  });
  if (!resp.ok) return { cinemas: [], description: "" };
  const html = await resp.text();

  // Extract description
  const descMatch = html.match(/<meta name="description"\s+content="([^"]+)"/);
  const description = descMatch?.[1] || "";

  // Find cinema blocks — each cinema has a link and nearby showtimes
  // Pattern: <a href="/kino/_bin/kinodetail...">Cinema Name</a> ... followed by times
  const cinemaBlocks = html.match(
    /<a[^>]*href="\/kino\/_bin\/kinodetail[^"]*"[^>]*>(.*?)<\/a>[\s\S]*?(?=<a[^>]*href="\/kino\/_bin\/kinodetail|<div class="pager)/g
  ) || [];

  const cinemas: Array<{ name: string; times: string[]; link: string }> = [];

  for (const block of cinemaBlocks) {
    const nameMatch = block.match(/<a[^>]*>(.*?)<\/a>/);
    if (!nameMatch) continue;
    const name = nameMatch[1]
      .replace(/<[^>]+>/g, "")
      .trim();

    // If there's a link, get the full URL
    const linkMatch = block.match(/href="(\/kino\/_bin\/kinodetail[^"]*)"/);
    const link = linkMatch ? BASE + linkMatch[1] : "";

    // Extract showtimes with language tags: "HH:MM (OV)" or "HH:MM"
    const timeLangPairs: Array<{ time: string; lang: string }> = [];
    const rawTimes = block.match(/\b(\d{1,2}:\d{2})\s*(?:\(([^)]+)\))?/g) || [];
    for (const t of rawTimes) {
      const timeMatch = t.match(/(\d{1,2}:\d{2})/);
      if (!timeMatch) continue;
      let lang = "DE"; // default: German dubbed
      if (/\((OV|OmU|OmenglU|DF)\)/i.test(t)) {
        const m = t.match(/\(([^)]+)\)/);
        if (m) lang = m[1];
      }
      timeLangPairs.push({ time: timeMatch[1], lang });
    }

    if (name && timeLangPairs.length > 0) {
      cinemas.push({ name, times: timeLangPairs.map(p => p.time), link, langs: timeLangPairs.map(p => p.lang) });
    }
  }

  return { cinemas, description };
}

// Normalize cinema names (abbreviations → full names)
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
  console.log("Fetching Berlin.de cinema RSS...\n");

  const films = await fetchRSS();
  console.log(`  Films in RSS: ${films.length}`);
  if (films.length === 0) {
    console.log("  No films found — writing empty output");
    writeFileSync("data/venues-berlincinema.json", "[]");
    return;
  }

  console.log(`  Sample: ${films.slice(0, 3).map(f => f.title).join(", ")}`);

  const events: CinemaEvent[] = [];
  let processed = 0;
  const allCinemas = new Set<string>();

  for (const film of films) {
    processed++;
    if (processed % 5 === 0) {
      process.stdout.write(`\r  Processing: ${processed}/${films.length}`);
    }

    const { cinemas, description } = await fetchFilmDetail(film.link);

    for (const cinema of cinemas) {
      const normalizedName = normalizeCinema(cinema.name);
      allCinemas.add(normalizedName);

      for (let i = 0; i < cinema.times.length; i++) {
        const time = cinema.times[i];
        const lang = cinema.langs[i] || "DE";
        events.push({
          source: "berlincinema",
          source_id: `bc_${film.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${normalizedName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${time.replace(":", "")}`,
          title: film.title,
          description: description || film.description || "",
          start_datetime: `2026-07-17T${time}:00+02:00`,
          end_datetime: "",
          venue_name: normalizedName,
          venue_address: `${normalizedName}, Berlin, DE`,
          latitude: 0,
          longitude: 0,
          categories: ["film", "cinema"],
          event_url: film.link,
          ticket_url: cinema.link || film.link,
          image_url: film.image || "",
          language: lang,
          last_updated: new Date().toISOString(),
        });
      }
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 300));
  }

  writeFileSync("data/venues-berlincinema.json", JSON.stringify(events, null, 2));

  console.log(`\r  Processed: ${processed}/${films.length} — ${events.length} showtimes`);
  console.log(`  Unique cinemas: ${allCinemas.size}`);
  console.log(`  Cinemas: ${[...allCinemas].sort().slice(0, 15).join(", ")}${allCinemas.size > 15 ? "..." : ""}`);
  console.log(`\nDone → data/venues-berlincinema.json`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
