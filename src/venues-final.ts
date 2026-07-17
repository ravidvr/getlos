// Phase: Final combined output — venues + events + geocoding
// Merges OSM venues, matched events, and geocoded addresses

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
  description: string;
  start_datetime: string;
  end_datetime: string;
  venue_name: string;
  sources: { source: string; source_id: string; event_url: string }[];
  categories: string[];
  genres: string[];
  artists: string[];
  ticket_url?: string;
  image_url?: string;
  language?: string;
  price?: string;
  last_updated: string;
}

interface MatchResult {
  event_venue_name: string;
  matched: boolean;
  osm_name?: string;
  osm_id?: number;
}

interface GeocodeResult {
  venue_name: string;
  venue_address: string;
  latitude: number;
  longitude: number;
}

interface FinalVenue {
  osm_id: number | null;
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
  events: { id: string; title: string; date: string; ticket_url?: string; price?: string }[];
}

function buildAddress(v: OSMVenue): string {
  const parts: string[] = [];
  if (v.street) {
    parts.push(v.street + (v.housenumber ? ` ${v.housenumber}` : ""));
  }
  parts.push("Berlin");
  if (v.postcode) parts.push(v.postcode);
  return parts.join(", ");
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

  // Load geocoding results
  let geocodes: GeocodeResult[];
  try {
    geocodes = JSON.parse(readFileSync("data/geocode-results.json", "utf-8"));
  } catch {
    geocodes = [];
  }

  // Build match lookup: event venue name → osm_id
  const matchMap = new Map<string, number>();
  for (const m of matches) {
    if (m.matched && m.osm_id) {
      matchMap.set(m.event_venue_name, m.osm_id);
    }
  }

  // Build geocode lookup: venue name → lat/lng
  const geocodeMap = new Map<string, { lat: number; lng: number }>();
  for (const g of geocodes) {
    if (g.latitude !== 0) {
      geocodeMap.set(g.venue_name, { lat: g.latitude, lng: g.longitude });
    }
  }

  // Group events by matched osm_id
  const eventsByOsmId = new Map<number, MergedEvent[]>();
  const unmatchedEvents: MergedEvent[] = [];

  for (const e of events) {
    const osmId = matchMap.get(e.venue_name);
    if (osmId) {
      if (!eventsByOsmId.has(osmId)) eventsByOsmId.set(osmId, []);
      eventsByOsmId.get(osmId)!.push(e);
    } else {
      unmatchedEvents.push(e);
    }
  }

  // Build final venue list (OSM venues with events)
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
      events: sortedEvents.map((e) => ({
        id: e.id,
        title: e.title,
        date: e.start_datetime,
        ticket_url: e.ticket_url,
        language: e.language,
        price: e.price,
      })),
    };
  });

  // Add standalone venues from geocoded unmatched events
  const usedNames = new Set(final.map((v) => v.name.toLowerCase()));
  const standaloneGrouped = new Map<string, MergedEvent[]>(); // venue name → events

  for (const e of unmatchedEvents) {
    const key = e.venue_name.toLowerCase();
    if (!standaloneGrouped.has(key)) standaloneGrouped.set(key, []);
    standaloneGrouped.get(key)!.push(e);
  }

  let standaloneId = 0;
  for (const [name, venueEvents] of standaloneGrouped) {
    if (usedNames.has(name)) continue;
    const geo = geocodeMap.get(venueEvents[0].venue_name);
    const sorted = venueEvents.sort(
      (a, b) => (a.start_datetime || "").localeCompare(b.start_datetime || "")
    );
    const categories = [...new Set(venueEvents.flatMap((e) => e.categories))];

    final.push({
      osm_id: null,
      name: venueEvents[0].venue_name,
      latitude: geo?.lat || 52.5200, // fallback: Berlin center
      longitude: geo?.lng || 13.4050,
      amenity: "event_venue",
      address: "",
      event_count: venueEvents.length,
      next_event: sorted[0]?.start_datetime,
      categories,
      events: sorted.map((e) => ({
        id: e.id,
        title: e.title,
        date: e.start_datetime,
        ticket_url: e.ticket_url,
        language: e.language,
        price: e.price,
      })),
    });
    standaloneId++;
  }

  // Sort by event count descending
  final.sort((a, b) => b.event_count - a.event_count);

  writeFileSync("data/venues-combined.json", JSON.stringify(final, null, 2));

  const withEvents = final.filter((v) => v.event_count > 0);
  const withGeo = final.filter((v) => v.latitude !== 52.5200 || v.osm_id !== null);

  console.log(`Venues total:       ${final.length}`);
  console.log(`Venues w/ events:   ${withEvents.length}`);
  console.log(`Venues w/ OSM geo:  ${final.filter((v) => v.osm_id !== null).length}`);
  console.log(`Venues w/ any geo:  ${withGeo.length}`);
  console.log(`Standalone venues:  ${standaloneId}`);
  console.log(`Events total:       ${events.length}`);
  console.log(`\nOutput → data/venues-combined.json`);
  console.log(`Output → data/events-combined.json`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
