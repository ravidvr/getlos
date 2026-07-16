// Phase 4c: Bandsintown API fetcher
// Requires BANDSINTOWN_APP_ID in .env
// Get one at: https://www.bandsintown.com/api

import { writeFileSync } from "fs";

const BIT_APP_ID = process.env.BANDSINTOWN_APP_ID;

async function fetchBerlinEvents(): Promise<any[]> {
  const url = `https://rest.bandsintown.com/events?app_id=${BIT_APP_ID}&location=Berlin,Germany&radius=20&per_page=100&date=upcoming`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Bandsintown HTTP ${resp.status}`);
  const data = await resp.json();

  // Bandsintown returns array directly or wrapped
  const events = Array.isArray(data) ? data : data.events || [];

  return events.map((e: any) => ({
    source: "bandsintown",
    source_id: e.id || `${e.artist?.name}_${e.datetime}`,
    title: e.title || `${e.artist?.name || "Unknown"} at ${e.venue?.name || "Unknown"}`,
    description: e.description || "",
    start_datetime: e.datetime || "",
    end_datetime: "",
    venue_name: e.venue?.name || "Unknown",
    venue_address: e.venue?.location || "",
    latitude: e.venue?.latitude ? parseFloat(e.venue.latitude) : undefined,
    longitude: e.venue?.longitude ? parseFloat(e.venue.longitude) : undefined,
    artist: e.artist?.name || "",
    genre: e.artist?.genre || "",
    event_url: e.url || "",
    ticket_url: e.url || "",
    image_url: e.artist?.image_url || "",
    last_updated: new Date().toISOString(),
  }));
}

async function main() {
  if (!BIT_APP_ID) {
    console.error("Set BANDSINTOWN_APP_ID in .env");
    console.error("  Get one at: https://www.bandsintown.com/api");
    process.exit(1);
  }
  console.log("Fetching Bandsintown Berlin events...");
  const events = await fetchBerlinEvents();
  writeFileSync("data/venues-bandsintown.json", JSON.stringify(events, null, 2));
  console.log(`\nDone: ${events.length} events → data/venues-bandsintown.json`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
