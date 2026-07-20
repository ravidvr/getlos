// Phase: English Cinema Berlin parser v2
// Parses https://englishcinemaberlin.com/7-day-overview
// Each showtime is a badge element: <a/span title="HH:MM at Cinema Name">

import { writeFileSync } from "fs";

const URL = "https://englishcinemaberlin.com/7-day-overview";

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

// Extract {time, cinema} pairs from a cell containing badge elements
function parseShowtimes(cellHtml: string): Array<{ time: string; cinema: string }> {
  const results: Array<{ time: string; cinema: string }> = [];

  // Each showtime is in a badge: <a> or <span> with title="HH:MM at Cinema Name"
  // and <strong>HH:MM</strong> inside
  const badgeRegex = /<(?:a|span)\s[^>]*?(?:title="(\d{1,2}:\d{2})\s*(?:at\s+)?([^"]*?)"|>.*?<strong[^>]*?>(\d{1,2}:\d{2})<\/strong>\s*(.*?)\s*<\/(?:a|span)>)/gs;

  // Simpler approach: extract all badges, then parse each
  const badges = cellHtml.match(/<(?:a|span)\s[^>]*?badge[^>]*?>.*?<\/(?:a|span)>/gs) || [];

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

    results.push({ time, cinema });
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

  const resp = await fetch(URL, {
    headers: { "User-Agent": "getlos/0.1.0 (Berlin events map)" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();

  // Parse header for dates
  const headerMatch = html.match(/<thead[^>]*>(.*?)<\/thead>/s);
  const dates: string[] = [];
  if (headerMatch) {
    const ths = headerMatch[1].match(/<th[^>]*>(.*?)<\/th>/gs) || [];
    for (const th of ths) {
      const text = th.replace(/<[^>]+>/g, "").trim();
      if (/\d{1,2}\s+\w{3}/i.test(text) || /\w{3},\s*\d{1,2}\s+\w{3}/i.test(text)) {
        dates.push(parseDateHeader(text));
      } else {
        dates.push("");
      }
    }
  }
  console.log(`  Dates: ${dates.filter(Boolean).length}`);

  // Parse body rows
  const bodyMatch = html.match(/<tbody[^>]*>(.*?)<\/tbody>/s);
  if (!bodyMatch) {
    console.log("No tbody found");
    writeFileSync("data/venues-englishcinema.json", "[]");
    return;
  }

  const rows = bodyMatch[1].match(/<tr[^>]*>(.*?)<\/tr>/gs) || [];
  const events: CinemaEvent[] = [];
  const seenMovies = new Set<string>();
  const cinemasSeen = new Set<string>();

  for (const rowHtml of rows) {
    const cells = rowHtml.match(/<td[^>]*>(.*?)<\/td>/gs) || [];
    if (cells.length < 2) continue;

    const movieCell = (cells[0] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!movieCell || movieCell === "Movie/Date") continue;
    seenMovies.add(movieCell);

    // Cells 1+ are showtimes per day
    for (let i = 1; i < cells.length && i - 1 < dates.length; i++) {
      const date = dates[i - 1];
      if (!date) continue;

      const showtimes = parseShowtimes(cells[i]);
      for (const { time, cinema } of showtimes) {
        const normalized = normalizeCinema(cinema);
        cinemasSeen.add(normalized);

        events.push({
          source: "englishcinema",
          source_id: `ec_${movieCell.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${date}_${time.replace(":", "")}_${normalized.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`,
          title: movieCell,
          description: `${movieCell} — English screening at ${normalized}`,
          start_datetime: `${date}T${time}:00+02:00`,
          end_datetime: "",
          venue_name: normalized,
          venue_address: `${normalized}, Berlin, DE`,
          latitude: 0,
          longitude: 0,
          categories: ["film", "cinema", "english"],
          event_url: URL,
          ticket_url: "",
          image_url: "",
          language: "EN",
          last_updated: new Date().toISOString(),
        });
      }
    }
  }

  writeFileSync("data/venues-englishcinema.json", JSON.stringify(events, null, 2));

  console.log(`Done: ${events.length} screenings → data/venues-englishcinema.json`);
  console.log(`  Unique movies: ${seenMovies.size}`);
  console.log(`  Cinemas: ${cinemasSeen.size}`);
  console.log(`  Venues: ${[...cinemasSeen].sort().join(", ")}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
