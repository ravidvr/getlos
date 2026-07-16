// Phase 7: Final combined venue output
// Merge OSM venues with matched event data → single file for frontend

import { readFileSync, writeFileSync } from "fs";

interface OSMVenue {
  osm_id: number;
  name: string;
  latitude: number;
  longitude: number;
  amenity: string;
  street?: string;
  housenumber?: string;
  postcode?: string;
  website?: string;
  phone?: string;
  capacity?: number;
}

interface MergedEvent {
  id: string;
  title: string;
  start_datetime: string;
  venue_name: string;
  categories: string[];
  genres: string[];
  ticket_url?: string;
}

interface MatchResult {
  event_venue_name: string;
  matched: boolean;
  osm_name?: string;
  osm_id?: number;
}

interface FinalVenue {
  osm_id: number;
  name: string;
  latitude: number;
  longitude: number;
  amenity: string;
  address: string;
  website?: string;
  phone?: string;
  capacity?: number;
  event_count: number;
  next_event?: string;
  categories: string[];
  events: { id: string; title: string; date: string; ticket_url?: string }[];
}

function buildAddress(v: OSMVenue): string {
  const parts = [v.street];
  if (v.housenumber) parts.push(v.housenumber);
  if (parts.length > 0) parts.push(",");
  parts.push("Berlin");
  if (v.postcode) parts.push(v.postcode);
  return parts.filter(Boolean).join(" ").replace(" ,", ",");
}

async function main() {
  // Load OSM venues
  let osmVenues: OSMVenue[];
  try {
    osmVenues = JSON.parse(readFileSync("data/venues-osm.json", "utf-8"));
  } catch {
    console.error("venues-osm.json not found. Run venues:osm first.");
    process.exit(1);
  }

  // Load events
  let events: MergedEvent[];
  try {
    events = JSON.parse(readFileSync("data/events-combined.json", "utf-8"));
  } catch {
    events = [];
  }

  // Load venue matches
  let matches: MatchResult[];
  try {
    matches = JSON.parse(readFileSync("data/venue-matches.json", "utf-8"));
  } catch {
    matches = [];
  }

  // Build match lookup: event venue name → osm_id
  const matchMap = new Map<string, number>();
  for (const m of matches) {
    if (m.matched && m.osm_id) {
      matchMap.set(m.event_venue_name, m.osm_id);
    }
  }

  // Group events by osm_id
  const eventsByOsmId = new Map<number, MergedEvent[]>();
  for (const e of events) {
    const osmId = matchMap.get(e.venue_name);
    if (osmId) {
      if (!eventsByOsmId.has(osmId)) eventsByOsmId.set(osmId, []);
      eventsByOsmId.get(osmId)!.push(e);
    }
  }

  // Build final venue list
  const final: FinalVenue[] = osmVenues.map((v) => {
    const venueEvents = eventsByOsmId.get(v.osm_id) || [];
    const sortedEvents = venueEvents.sort(
      (a, b) => (a.start_datetime || "").localeCompare(b.start_datetime || "")
    );
    const categories = [...new Set(venueEvents.flatMap((e) => e.categories))];

    return {
      osm_id: v.osm_id,
      name: v.name,
      latitude: v.latitude,
      longitude: v.longitude,
      amenity: v.amenity,
      address: buildAddress(v),
      website: v.website,
      phone: v.phone,
      capacity: v.capacity,
      event_count: venueEvents.length,
      next_event: sortedEvents[0]?.start_datetime,
      categories,
      events: sortedEvents.slice(0, 20).map((e) => ({
        id: e.id,
        title: e.title,
        date: e.start_datetime,
        ticket_url: e.ticket_url,
      })),
    };
  });

  writeFileSync("data/venues-combined.json", JSON.stringify(final, null, 2));

  const withEvents = final.filter((v) => v.event_count > 0);
  const totalEvents = events.length;

  console.log(`Venues total:     ${final.length}`);
  console.log(`Venues w/ events: ${withEvents.length} (${((withEvents.length / final.length) * 100).toFixed(1)}%)`);
  console.log(`Events total:     ${totalEvents}`);
  console.log(`\nOutput → data/venues-combined.json`);
  console.log(`Output → data/events-combined.json`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
