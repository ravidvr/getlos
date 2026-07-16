// Phase 4a: Eventbrite API fetcher for Berlin venue events
// Requires EVENTBRITE_API_KEY in .env
// Free tier: 1000 req/day, 100 events per page

import { writeFileSync } from "fs";

const EVENTBRITE_KEY = process.env.EVENTBRITE_API_KEY;
const BASE = "https://www.eventbriteapi.com/v3";

async function fetchBerlinEvents(): Promise<any[]> {
  // Search: Berlin area, in-person only, all categories
  const url = `${BASE}/events/search/?location.address=Berlin&location.within=20km&expand=venue,category,format&page_size=100`;
  const headers = { Authorization: `Bearer ${EVENTBRITE_KEY}` };

  let all: any[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 20) {
    const resp = await fetch(`${url}&page=${page}`, { headers });
    if (!resp.ok) throw new Error(`Eventbrite HTTP ${resp.status}`);

    const data = (await resp.json()) as {
      events: any[];
      pagination: { has_more_items: boolean; page_count: number };
    };

    // Exclude online-only events
    const inPerson = data.events.filter((e: any) => !e.online_event);
    all = all.concat(inPerson);

    hasMore = data.pagination.has_more_items && page < data.pagination.page_count;
    page++;
    console.log(`  Page ${page - 1}: ${inPerson.length} in-person events`);
  }

  // Normalize to canonical schema
  return all.map((e: any) => ({
    source: "eventbrite",
    source_id: e.id,
    title: e.name?.text || "",
    description: e.description?.text || "",
    start_datetime: e.start?.utc || "",
    end_datetime: e.end?.utc || "",
    venue_name: e.venue?.name || "Unknown",
    venue_address: e.venue?.address?.localized_address_display || "",
    latitude: e.venue?.latitude ? parseFloat(e.venue.latitude) : undefined,
    longitude: e.venue?.longitude ? parseFloat(e.venue.longitude) : undefined,
    category: e.category?.name || "",
    format: e.format?.name || "",
    event_url: e.url || "",
    ticket_url: e.url || "",
    image_url: e.logo?.url || "",
    price: e.is_free ? "Free" : "Paid",
    last_updated: e.changed || new Date().toISOString(),
  }));
}

async function main() {
  if (!EVENTBRITE_KEY) {
    console.error("Set EVENTBRITE_API_KEY in .env");
    console.error("  Get one at: https://www.eventbrite.com/platform/api-keys");
    process.exit(1);
  }
  console.log("Fetching Eventbrite Berlin events...");
  const events = await fetchBerlinEvents();
  writeFileSync("data/venues-eventbrite.json", JSON.stringify(events, null, 2));
  console.log(`\nDone: ${events.length} events → data/venues-eventbrite.json`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
