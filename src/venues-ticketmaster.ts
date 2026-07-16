// Phase 4b: Ticketmaster Discovery API fetcher
// Requires TICKETMASTER_API_KEY in .env
// Apply at: https://developer.ticketmaster.com/

import { writeFileSync } from "fs";

const TM_KEY = process.env.TICKETMASTER_API_KEY;
const BASE = "https://app.ticketmaster.com/discovery/v2";

async function fetchBerlinEvents(): Promise<any[]> {
  // Ticketmaster: city + country + classifications
  const params = new URLSearchParams({
    apikey: TM_KEY!,
    city: "Berlin",
    countryCode: "DE",
    size: "200",
    sort: "date,asc",
    classificationName: "music,arts,theatre,sports",
  });
  const url = `${BASE}/events.json?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Ticketmaster HTTP ${resp.status}`);

  const data = (await resp.json()) as {
    _embedded?: { events: any[] };
    page: { totalPages: number; number: number };
  };

  const events = data._embedded?.events || [];

  // Normalize
  return events.map((e: any) => ({
    source: "ticketmaster",
    source_id: e.id,
    title: e.name || "",
    description: e.info || e.pleaseNote || "",
    start_datetime: e.dates?.start?.dateTime || "",
    end_datetime: e.dates?.end?.dateTime || "",
    venue_name: e._embedded?.venues?.[0]?.name || "Unknown",
    venue_address: e._embedded?.venues?.[0]?.address?.line1 || "",
    latitude: e._embedded?.venues?.[0]?.location?.latitude
      ? parseFloat(e._embedded.venues[0].location.latitude)
      : undefined,
    longitude: e._embedded?.venues?.[0]?.location?.longitude
      ? parseFloat(e._embedded.venues[0].location.longitude)
      : undefined,
    category: e.classifications?.[0]?.segment?.name || "",
    genre: e.classifications?.[0]?.genre?.name || "",
    event_url: e.url || "",
    ticket_url: e.url || "",
    image_url: e.images?.[0]?.url || "",
    price: e.priceRanges?.[0]
      ? `${e.priceRanges[0].min}-${e.priceRanges[0].max} ${e.priceRanges[0].currency}`
      : undefined,
    last_updated: new Date().toISOString(),
  }));
}

async function main() {
  if (!TM_KEY) {
    console.error("Set TICKETMASTER_API_KEY in .env");
    console.error("  Apply at: https://developer.ticketmaster.com/");
    process.exit(1);
  }
  console.log("Fetching Ticketmaster Berlin events...");
  const events = await fetchBerlinEvents();
  writeFileSync("data/venues-ticketmaster.json", JSON.stringify(events, null, 2));
  console.log(`\nDone: ${events.length} events → data/venues-ticketmaster.json`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
