// Phase: Berlin Metal HTML table parser v2
// Parses https://berlinmetal.lima-city.de/
// Each concert = one table. Cell[0] = "YYYY-MM-DD - YYYY-MM-DD VenueName", Cell[1] = artists

import { writeFileSync } from "fs";

const URL = "https://berlinmetal.lima-city.de/";

interface MetalEvent {
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
  artists: string[];
  event_url: string;
  ticket_url: string;
  last_updated: string;
}

function parseDateAndVenue(raw: string): { start: string; end: string; venue: string } {
  // Format: "2026-07-24 - 2026-07-25Neue Zukunft/Pumptrack"
  // or: "2026-08-16SO36"
  const cleaned = raw.replace(/&ouml;/g, "ö").replace(/&auml;/g, "ä").replace(/&uuml;/g, "ü")
    .replace(/&szlig;/g, "ß").replace(/&Ouml;/g, "Ö").replace(/&Auml;/g, "Ä")
    .replace(/&Uuml;/g, "Ü").replace(/&eacute;/g, "é").replace(/&agrave;/g, "à");

  // Try date range: "YYYY-MM-DD - YYYY-MM-DD VenueName"
  const rangeMatch = cleaned.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})(.+)$/);
  if (rangeMatch) {
    return {
      start: rangeMatch[1],
      end: rangeMatch[2],
      venue: rangeMatch[3].trim(),
    };
  }

  // Try single date: "YYYY-MM-DD VenueName"
  const singleMatch = cleaned.match(/^(\d{4}-\d{2}-\d{2})(.+)$/);
  if (singleMatch) {
    return {
      start: singleMatch[1],
      end: "",
      venue: singleMatch[2].trim(),
    };
  }

  return { start: "", end: "", venue: cleaned };
}

function parseArtists(raw: string): string[] {
  if (!raw || raw.toLowerCase() === "tba") return [];
  return raw
    .split(",")
    .map((a) => {
      let artist = a
        .replace(/&ouml;/g, "ö")
        .replace(/&auml;/g, "ä")
        .replace(/&uuml;/g, "ü")
        .replace(/&szlig;/g, "ß")
        .replace(/&eacute;/g, "é")
        .replace(/&agrave;/g, "à")
        .trim();
      // Remove "CANCELLED!" prefix
      artist = artist.replace(/^CANCELLED!\s*/i, "");
      return artist;
    })
    .filter((a) => a.length > 0);
}

async function main() {
  console.log("Parsing Berlin Metal concerts...\n");

  const resp = await fetch(URL, {
    headers: { "User-Agent": "getlos/0.1.0 (Berlin events map)" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();

  // Each concert is in its own <table>. Extract data rows.
  const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/g) || [];
  const events: MetalEvent[] = [];
  const seenVenues = new Set<string>();

  for (const table of tables) {
    const rows = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
    if (rows.length < 2) continue;

    // Row 1 = data row (row index 1, not 0 which is often just an empty <tr>)
    const dataRow = rows[1] || "";
    const cells = dataRow.match(/<td[^>]*>(.*?)<\/td>/gs) || [];
    if (cells.length < 2) continue;

    const cell0 = cells[0].replace(/<[^>]+>/g, "").trim();
    const cell1 = cells[1].replace(/<[^>]+>/g, "").trim();

    // Skip header/empty rows
    if (!cell0 || /datum|date|festival/i.test(cell0)) continue;

    const { start, end, venue } = parseDateAndVenue(cell0);
    const artists = parseArtists(cell1);

    if (!venue) continue;

    const title = artists.length > 0
      ? artists.slice(0, 3).join(", ") + (artists.length > 3 ? ` +${artists.length - 3} more` : "")
      : cell1 || "Metal Concert";
    seenVenues.add(venue);

    events.push({
      source: "berlinmetal",
      source_id: `bm_${start}_${venue.replace(/\s+/g, "_").toLowerCase()}`,
      title,
      description: cell1,
      start_datetime: start ? `${start}T20:00:00+02:00` : "",
      end_datetime: end ? `${end}T23:59:00+02:00` : "",
      venue_name: venue,
      venue_address: `${venue}, Berlin, DE`,
      latitude: 0,
      longitude: 0,
      artists,
      event_url: URL,
      ticket_url: "",
      last_updated: new Date().toISOString(),
    });
  }

  writeFileSync("data/venues-berlinmetal.json", JSON.stringify(events, null, 2));

  console.log(`Done: ${events.length} metal concerts → data/venues-berlinmetal.json`);
  console.log(`  Unique venues: ${seenVenues.size}`);
  console.log(`  Venues: ${[...seenVenues].join(", ")}`);
  console.log(`  Total artists: ${events.reduce((s, e) => s + e.artists.length, 0)}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
