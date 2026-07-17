// Phase: Eventbrite JSON-LD fetcher
// Fetches Berlin events from Eventbrite public city page JSON-LD
// Zero API keys needed — parses embedded structured data

import { writeFileSync } from "fs";

const EB_URL = "https://www.eventbrite.com/d/germany--berlin/events/";

interface EBEvent {
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
  category: string;
  event_url: string;
  ticket_url: string;
  image_url: string;
  price: string;
  last_updated: string;
}

async function fetchPage(url: string): Promise<EBEvent[]> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "getlos/0.1.0 (Berlin events map)" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();

  // Extract JSON-LD
  const match = html.match(
    /<script type="application\/ld\+json">(.+?)<\/script>/s
  );
  if (!match) throw new Error("No JSON-LD found");

  const data = JSON.parse(match[1]);
  const items = data.itemListElement || [];

  return items.map((item: any) => {
    const e = item.item;
    const loc = e.location || {};
    const addr = loc.address || {};
    const geo = loc.geo || {};

    return {
      source: "eventbrite",
      source_id: e.url?.split("/").pop() || `eb_${item.position}`,
      title: e.name || "Untitled",
      description: (e.description || "").replace(/\\n/g, " ").trim(),
      start_datetime: e.startDate || "",
      end_datetime: e.endDate || "",
      venue_name: loc.name || "Unknown",
      venue_address: addr.streetAddress
        ? `${addr.streetAddress}, ${addr.postalCode || ""} ${addr.addressLocality || "Berlin"}`
        : "",
      latitude: parseFloat(geo.latitude) || 0,
      longitude: parseFloat(geo.longitude) || 0,
      category: e.eventAttendanceMode?.includes("Online") ? "online" : "in-person",
      event_url: e.url || "",
      ticket_url: e.url || "",
      image_url: e.image || "",
      price: e.offers?.price ? `${e.offers.price} ${e.offers.priceCurrency || ""}` : "",
      last_updated: new Date().toISOString(),
    };
  });
}

async function main() {
  console.log("Fetching Eventbrite Berlin events (JSON-LD)...\n");

  const all: EBEvent[] = [];
  // Eventbrite city pages paginate via ?page=N
  for (let page = 1; page <= 10; page++) {
    const url = page === 1 ? EB_URL : `${EB_URL}?page=${page}`;
    process.stdout.write(`  Page ${page}: `);
    try {
      const events = await fetchPage(url);
      if (events.length === 0) {
        console.log("no events (end of results)");
        break;
      }
      all.push(...events);
      console.log(`${events.length} events`);
      // Rate limit
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err: any) {
      console.log(`✗ ${err.message}`);
      break;
    }
  }

  writeFileSync("data/venues-eventbrite.json", JSON.stringify(all, null, 2));

  const withVenue = all.filter((e) => e.venue_name !== "Unknown").length;
  const withGeo = all.filter((e) => e.latitude !== 0).length;
  console.log(`\nDone: ${all.length} events → data/venues-eventbrite.json`);
  console.log(`  With venue: ${withVenue}`);
  console.log(`  With lat/lng: ${withGeo}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
