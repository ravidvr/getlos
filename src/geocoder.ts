// Phase: Geocode venue addresses using Nominatim
// Free OpenStreetMap geocoder, no API key needed
// Rate limit: 1 request/second

import { readFileSync, writeFileSync } from "fs";

const NOMINATIM = "https://nominatim.openstreetmap.org";

interface VenueGeocode {
  venue_name: string;
  venue_address: string;
  latitude: number;
  longitude: number;
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const url = `${NOMINATIM}/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "getlos/0.1.0 (Berlin events map; geocoding)" },
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as Array<{ lat: string; lon: string }>;
  if (data.length === 0) return null;
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
  };
}

// Collect all unique venue addresses that need geocoding
async function collectAddresses(sources: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>(); // venue_name → address

  for (const src of sources) {
    try {
      const events = JSON.parse(readFileSync(`data/${src}.json`, "utf-8"));
      for (const e of events) {
        if (e.venue_address && e.latitude === 0 && e.longitude === 0) {
          if (!map.has(e.venue_name) || map.get(e.venue_name)!.length < e.venue_address.length) {
            map.set(e.venue_name, e.venue_address);
          }
        }
      }
    } catch {
      // File doesn't exist, skip
    }
  }
  return map;
}

async function main() {
  console.log("Geocoding venue addresses via Nominatim...\n");

  const sources = [
    "venues-berlincinema",
    "venues-englishcinema",
    "venues-openair",
  ];

  const addresses = await collectAddresses(sources);
  console.log(`Venues needing geocoding: ${addresses.size}`);

  const results: VenueGeocode[] = [];
  let done = 0;
  const cached: Record<string, { lat: number; lng: number }> = {};

  // Try to load existing cache
  try {
    const existing = JSON.parse(readFileSync("data/geocode-cache.json", "utf-8"));
    for (const [name, coords] of Object.entries(existing as Record<string, any>)) {
      cached[name] = { lat: coords.lat, lng: coords.lng };
    }
    console.log(`Cache loaded: ${Object.keys(cached).length} existing entries`);
  } catch {
    // No cache yet
  }

  for (const [venue, address] of addresses) {
    done++;
    process.stdout.write(`\r  ${done}/${addresses.size}: ${venue.substring(0, 30).padEnd(30)}`);

    // Check cache
    if (cached[venue]) {
      results.push({
        venue_name: venue,
        venue_address: address,
        latitude: cached[venue].lat,
        longitude: cached[venue].lng,
      });
      continue;
    }

    // Geocode
    const coords = await geocodeAddress(address);
    if (coords) {
      results.push({
        venue_name: venue,
        venue_address: address,
        latitude: coords.lat,
        longitude: coords.lng,
      });
      cached[venue] = coords;
    } else {
      // Try with "Berlin" appended if not already
      if (!address.toLowerCase().includes("berlin")) {
        const coords2 = await geocodeAddress(`${address}, Berlin, DE`);
        if (coords2) {
          results.push({
            venue_name: venue,
            venue_address: address,
            latitude: coords2.lat,
            longitude: coords2.lng,
          });
          cached[venue] = coords2;
          continue;
        }
      }
      console.log(`  ✗ no result`);
    }

    // Rate limit: 1 req/sec
    await new Promise((r) => setTimeout(r, 1100));
  }

  // Save results
  writeFileSync("data/geocode-results.json", JSON.stringify(results, null, 2));
  // Update cache
  writeFileSync("data/geocode-cache.json", JSON.stringify(cached, null, 2));

  console.log(`\n\nDone: ${results.length} geocoded → data/geocode-results.json`);
  console.log(`  Cache: ${Object.keys(cached).length} entries → data/geocode-cache.json`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
