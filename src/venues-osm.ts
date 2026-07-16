// Phase 2: Query OpenStreetMap Overpass API for all Berlin venue locations
// Zero auth, zero keys, free. One HTTP call → venues-osm.json

import { writeFileSync } from "fs";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Berlin bounding box (slightly padded to catch edge venues)
const BBOX = { south: 52.35, west: 13.08, north: 52.68, east: 13.75 };

// OSM amenity tags that correspond to real event-hosting venues
const VENUE_TAGS = [
  "bar",
  "nightclub",
  "theatre",
  "cinema",
  "concert_hall",
  "community_centre",
  "conference_centre",
  "arts_centre",
  "music_venue",
  "event_venue",
];

interface OSMVenue {
  osm_id: number;
  name: string;
  latitude: number;
  longitude: number;
  amenity: string;
  street?: string;
  housenumber?: string;
  postcode?: string;
  city?: string;
  website?: string;
  phone?: string;
  capacity?: number;
  wheelchair?: string;
  opening_hours?: string;
}

async function fetchVenuesByType(amenity: string): Promise<OSMVenue[]> {
  const bbox = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  const query = `[out:json][timeout:30];node["amenity"="${amenity}"](${bbox});out body;`;

  const resp = await fetch(OVERPASS_URL, {
    method: "POST",
    body: `data=${query}`,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "getlos/0.1.0 (Berlin events map; contact@getlos.dev)",
    },
  });

  if (!resp.ok) {
    throw new Error(`Overpass ${amenity}: ${resp.status}`);
  }

  const data = (await resp.json()) as {
    elements: Array<{
      id: number;
      lat: number;
      lon: number;
      tags: Record<string, string>;
    }>;
  };

  return data.elements.map((el) => ({
    osm_id: el.id,
    name: el.tags.name || "Unnamed Venue",
    latitude: el.lat,
    longitude: el.lon,
    amenity: el.tags.amenity || amenity,
    street: el.tags["addr:street"] || undefined,
    housenumber: el.tags["addr:housenumber"] || undefined,
    postcode: el.tags["addr:postcode"] || undefined,
    city: el.tags["addr:city"] || undefined,
    website: el.tags.website || el.tags["contact:website"] || undefined,
    phone: el.tags.phone || el.tags["contact:phone"] || undefined,
    capacity: el.tags.capacity ? parseInt(el.tags.capacity, 10) : undefined,
    wheelchair: el.tags.wheelchair || undefined,
    opening_hours: el.tags.opening_hours || undefined,
  }));
}

async function fetchVenues(): Promise<OSMVenue[]> {
  const all: OSMVenue[] = [];

  for (const amenity of VENUE_TAGS) {
    process.stdout.write(`  ${amenity.padEnd(20)} `);
    let venues: OSMVenue[] = [];
    let lastErr = "";

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        venues = await fetchVenuesByType(amenity);
        break;
      } catch (err: any) {
        lastErr = err.message;
        if (attempt < 2) {
          process.stdout.write(".");
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }

    if (venues.length > 0) {
      all.push(...venues);
      console.log(`${venues.length} venues`);
    } else {
      console.log(`✗ ${lastErr || "0 venues"}`);
    }
    // Rate-limit: Overpass fair use is ~1 req/sec
    await new Promise((r) => setTimeout(r, 2000));
  }

  return all;
}

function stats(venues: OSMVenue[]) {
  const byAmenity: Record<string, number> = {};
  const unnamed = venues.filter((v) => v.name === "Unnamed Venue").length;
  for (const v of venues) {
    byAmenity[v.amenity] = (byAmenity[v.amenity] || 0) + 1;
  }
  return { total: venues.length, unnamed, byAmenity };
}

async function main() {
  console.log("Phase 2: OSM Venue Foundation");
  console.log("  Querying Overpass API for Berlin venues...");

  const venues = await fetchVenues();
  const s = stats(venues);

  writeFileSync("data/venues-osm.json", JSON.stringify(venues, null, 2));

  console.log(`\nDone: ${s.total} venues → data/venues-osm.json`);
  console.log(`  Unnamed: ${s.unnamed} (${((s.unnamed / s.total) * 100).toFixed(1)}%)`);
  console.log("  By type:");
  for (const [type, count] of Object.entries(s.byAmenity).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
