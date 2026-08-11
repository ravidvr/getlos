// Phase: English Cinema Berlin parser v2
// Parses https://englishcinemaberlin.com/7-day-overview
// Each showtime is a badge element: <a/span title="HH:MM at Cinema Name">

import { writeFileSync } from "fs";

const SOURCE_URL = "https://englishcinemaberlin.com/films";

interface CinemaEvent {
  source: string;
  source_id: string;
  title: string;
  description: string;
  start_datetime: string;
  end_datetime: string;
  venue_name: string;
  venue_address: string;
  format: string;
  latitude: number;
  longitude: number;
  categories: string[];
  event_url: string;
  ticket_url: string;
  image_url: string;
  language: string;
  last_updated: string;
}

function parseDateHeader(dateStr: string): string {
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const match = dateStr.match(/(\d{1,2})\s+(\w{3})/i);
  if (match) {
    const year = new Date().getFullYear().toString();
    return `${year}-${months[match[2].toLowerCase()] || "01"}-${match[1].padStart(2, "0")}`;
  }
  return "";
}

// Format normalization: only IMAX is tracked; everything else is venue-level
function normalizeFormat(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return lower === "imax" ? "IMAX" : "";
}

// Extract {time, cinema, format} tuples from a cell containing badge elements
function parseShowtimes(cellHtml: string): Array<{ time: string; cinema: string; format: string }> {
  const results: Array<{ time: string; cinema: string; format: string }> = [];

  // Each showtime is in a badge: <a> or <span> with title="HH:MM at Cinema Name"
  // and <strong>HH:MM</strong> inside
  const badgeRegex = /<(?:a|span)\s[^>]*?(?:title="(\d{1,2}:\d{2})\s*(?:at\s+)?([^"]*?)"|>.*?<strong[^>]*?>(\d{1,2}:\d{2})<\/strong>\s*(.*?)\s*<\/(?:a|span)>)/gs;

  // Only match <a> badges (showtimes), not <span> badges (format tags)
  const badges = cellHtml.match(/<a\s[^>]*?badge[^>]*?>.*?<\/a>/gs) || [];

  for (const badge of badges) {
    // Extract time from <strong> element
    const timeMatch = badge.match(/<strong[^>]*?>(\d{1,2}:\d{2})<\/strong>/);
    if (!timeMatch) continue;
    const time = timeMatch[1];

    // Extract cinema name from title attribute (has full name)
    const titleMatch = badge.match(/title="[^"]*?(?:at|@)\s+([^"]+)"/);
    let cinema: string;
    if (titleMatch) {
      cinema = titleMatch[1].trim();
    } else {
      // Fallback: text after <strong> element
      const textMatch = badge.match(/<\/strong>\s*(.*?)\s*<\/[as]/);
      cinema = textMatch ? textMatch[1].trim() : "Unknown Cinema";
    }

    // Skip empty/unknown
    if (cinema === "Unknown Cinema" || cinema.length < 2) continue;

    // Detect format badge inside this showtime
    let format = "";
    const formatMatch = badge.match(/<span[^>]*opacity-75[^>]*>([^<]+)<\/span>/);
    if (formatMatch) {
      format = normalizeFormat(formatMatch[1]);
    }

    results.push({ time, cinema, format });
  }

  return results;
}

// Cinema name normalization (abbreviations → full names)
// Keys: abbreviated/badge-text forms + lowercase title-attribute full names.
// With the @ fix (line 59), title attributes like "20:00 @ CinemaxX Berlin"
// now flow through — we need entries for those full names to canonicalize them.
const CINEMA_LOOKUP: Record<string, string> = {
  // --- Abbreviation-style keys (from badge text fallback) ---
  "bware": "b-ware! Ladenkino",
  "Cubix": "CineStar Cubix am Alexanderplatz",
  "CinemaxX": "CinemaxX Berlin Potsdamer Platz",
  "fsk": "fsk Kino am Oranienplatz",
  "HHK": "Hackesche Höfe Kino",
  "KulturBrau": "Kino in der KulturBrauerei",
  "LUX": "Kino LuXe",
  "Movmto": "Moviemento",
  "ODE": "Odeon Berlin",
  "PAS": "Passage Kino",
  "FRP": "Filmrauschpalast",
  "Rollenberg": "Rollberg Kino",
  "ROL": "Rollberg Kino",
  "Sputnik": "Sputnik Kino",
  "Tilsiter": "Tilsiter Lichtspiele",
  "Union": "Kino Union",
  "UCI Easts.": "UCI Luxe East Side Gallery",
  "UCI": "UCI Luxe East Side Gallery",
  "ZHK": "Zeughauskino",
  "Zukunft": "Zukunft am Ostkreuz",
  "CKW": "CineStar Cubix am Alexanderplatz",
  "Babylon": "Babylon Berlin",
  "Intimes": "Intimes Kino",
  "FAF": "Filmrauschpalast",
  "Neukölln": "Passage Kino Neukölln",

  // --- Lowercase full-name keys (from title-attribute extraction) ---
  "b-ware! ladenkino": "b-ware! Ladenkino",
  "cinestar cubix": "CineStar Cubix am Alexanderplatz",
  "cinestar cubix am alexanderplatz": "CineStar Cubix am Alexanderplatz",
  "cinemaxx berlin": "CinemaxX Berlin Potsdamer Platz",
  "cinemaxx berlin potsdamer platz": "CinemaxX Berlin Potsdamer Platz",
  "hackesche höfe kino": "Hackesche Höfe Kino",
  "kino luxe": "Kino LuXe",
  "moviemento": "Moviemento",
  "odeon": "Odeon Berlin",
  "odeon berlin": "Odeon Berlin",
  "passage kino": "Passage Kino",
  "passage": "Passage Kino",
  "filmrauschpalast": "Filmrauschpalast",
  "rollberg kino": "Rollberg Kino",
  "rollberg kinos": "Rollberg Kino",
  "sputnik kino": "Sputnik Kino",
  "tilsiter lichtspiele": "Tilsiter Lichtspiele",
  "kino union": "Kino Union",
  "uci luxe": "UCI Luxe East Side Gallery",
  "uci luxe east side gallery": "UCI Luxe East Side Gallery",
  "zeughauskino": "Zeughauskino",
  "zukunft am ostkreuz": "Zukunft am Ostkreuz",
  "kino zukunft": "Zukunft am Ostkreuz",
  "babylon": "Babylon Berlin",
  "kino intimes": "Intimes Kino",
  "fsk kino am oranienplatz": "fsk Kino am Oranienplatz",

  // --- New cinemas not previously in lookup (Jul 2026) ---
  // CineStar chain
  "cinestar kulturbrauerei": "Kino in der KulturBrauerei",
  "cinestar berlin-tegel": "CineStar Berlin-Tegel",

  // Cineplex chain
  "cineplex alhambra": "Cineplex Alhambra",
  "cineplex neukölln": "Passage Kino Neukölln",
  "cineplex titania": "Cineplex Titania",

  // Babylon (separate from "Babylon Berlin" — different venues)
  "babylon kreuzberg": "Babylon Kreuzberg",
  "babylon mitte": "Babylon Mitte",

  // Delphi
  "delphi lux": "Delphi LUX",
  "delphi-filmpalast": "Delphi-Filmpalast",

  // Independent cinemas
  "acud kino": "Acud Kino",
  "bundesplatz-kino": "Bundesplatz-Kino",
  "casablanca kino": "Casablanca Kino",
  "cinemotion hohenschönhausen": "CineMotion Hohenschönhausen",
  "city kino wedding": "City Kino Wedding",
  "eva lichtspiele": "Eva Lichtspiele",
  "filmtheater am friedrichshain": "Filmtheater am Friedrichshain",
  "kino central": "Kino Central",
  "kino international": "Kino International",
  "lichtblick kino": "Lichtblick Kino",
  "neues off": "Neues Off",
  "yorck kino": "Yorck Kino",
  "filmkunst 66": "filmkunst 66",
};

function normalizeCinema(raw: string): string {
  const trimmed = raw
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&ouml;/g, "ö").replace(/&auml;/g, "ä")
    .replace(/&uuml;/g, "ü").replace(/&szlig;/g, "ß").trim();
  const lower = trimmed.toLowerCase();
  return CINEMA_LOOKUP[trimmed] || CINEMA_LOOKUP[lower] || trimmed;
}

async function main() {
  console.log("Parsing English Cinema Berlin schedule...\n");

  const resp = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "getlos/0.1.0 (Berlin events map)" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();

  // The former 7-day table now redirects to /films. The index exposes film
  // links; each film page publishes every upcoming screening as JSON-LD.
  // JSON-LD is a substantially more stable contract than presentation markup.
  const filmLinks = [...html.matchAll(/<a\s+class="film-card"[^>]*href="([^"]+)"/g)]
    .map((match) => new URL(match[1], SOURCE_URL).href);
  const uniqueLinks = [...new Set(filmLinks)];
  if (!uniqueLinks.length) {
    throw new Error("English Cinema index contains no film links");
  }
  console.log(`  Film pages: ${uniqueLinks.length}`);

  const events: CinemaEvent[] = [];
  const cinemasSeen = new Set<string>();
  const moviesSeen = new Set<string>();
  const seen = new Set<string>();
  const now = new Date();
  const concurrency = 6;

  for (let offset = 0; offset < uniqueLinks.length; offset += concurrency) {
    const batch = uniqueLinks.slice(offset, offset + concurrency);
    const pages = await Promise.all(batch.map(async (filmUrl) => {
      const response = await fetch(filmUrl, { headers: { "User-Agent": "getlos/0.1.0 (Berlin events map)" } });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${filmUrl}`);
      return { filmUrl, html: await response.text() };
    }));

    for (const page of pages) {
      const blocks = [...page.html.matchAll(/<script[^>]*type="application\/ld(?:&#x2B;|\+)json"[^>]*>([\s\S]*?)<\/script>/gi)]
        .map((match) => match[1]);
      for (const block of blocks) {
        let json: unknown;
        try {
          json = JSON.parse(block);
        } catch {
          continue;
        }
        const records = Array.isArray(json) ? json : [json];
        for (const record of records as Array<Record<string, any>>) {
          if (record["@type"] !== "ScreeningEvent" || !record.startDate || !record.location?.name) continue;
          if (new Date(record.startDate) < now) continue;
          const title = record.workPresented?.name || record.name?.replace(/\s+at\s+.*$/, "");
          if (!title) continue;
          const cinema = normalizeCinema(record.location.name);
          const ticketUrl = record.offers?.url ? new URL(record.offers.url, SOURCE_URL).href : "";
          const sourceId = ticketUrl || `${title}_${record.startDate}_${cinema}`;
          if (seen.has(sourceId)) continue;
          seen.add(sourceId);
          cinemasSeen.add(cinema);
          moviesSeen.add(title);
          events.push({
            source: "englishcinema",
            source_id: `ec_${sourceId.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`,
            title,
            description: `${title} — English screening at ${cinema}`,
            start_datetime: record.startDate,
            end_datetime: record.endDate || "",
            venue_name: cinema,
            venue_address: record.location.address?.streetAddress
              ? `${record.location.address.streetAddress}, Berlin, DE`
              : `${cinema}, Berlin, DE`,
            format: "",
            latitude: 0,
            longitude: 0,
            categories: ["film", "cinema", "english"],
            event_url: page.filmUrl,
            ticket_url: ticketUrl,
            image_url: record.image || "",
            language: "EN",
            last_updated: new Date().toISOString(),
          });
        }
      }
    }
  }

  writeFileSync("data/venues-englishcinema.json", JSON.stringify(events, null, 2));
  console.log(`Done: ${events.length} screenings → data/venues-englishcinema.json`);
  console.log(`  Unique movies: ${moviesSeen.size}`);
  console.log(`  Cinemas: ${cinemasSeen.size}`);
  console.log(`  Venues: ${[...cinemasSeen].sort().join(", ")}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
