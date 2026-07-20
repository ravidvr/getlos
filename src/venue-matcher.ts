// Phase 5: Venue matcher — resolve event venue names to OSM venues
// Strategy: alias table → exact match → Fuse.js fuzzy match

import { readFileSync, writeFileSync } from "fs";
import Fuse from "fuse.js";

interface OSMVenue {
  osm_id: number;
  name: string;
  latitude: number;
  longitude: number;
  amenity: string;
}

interface AliasEntry {
  canonical: string;
  aliases: string[];
}

interface MatchResult {
  event_venue_name: string;
  matched: boolean;
  osm_name?: string;
  osm_id?: number;
  amenity?: string;
  method?: "alias" | "exact" | "fuzzy";
  fuzzy_score?: number;
}

// ── Normalize ──
function norm(s: string): string {
  return s.trim().toLowerCase();
}

// ── Alias resolution ──
function buildAliasMap(aliases: AliasEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of aliases) {
    for (const alias of entry.aliases) {
      map.set(norm(alias), norm(entry.canonical));
    }
  }
  return map;
}

// ── Match one venue name ──
function matchVenue(
  eventName: string,
  venues: OSMVenue[],
  aliasMap: Map<string, string>,
  fuse: Fuse<OSMVenue>
): MatchResult {
  const eventNorm = norm(eventName);

  // Pass 1: alias table
  const aliased = aliasMap.get(eventNorm);
  if (aliased) {
    const exact = venues.find((v) => norm(v.name) === aliased);
    if (exact) {
      return {
        event_venue_name: eventName,
        matched: true,
        osm_name: exact.name,
        osm_id: exact.osm_id,
        amenity: exact.amenity,
        method: "alias",
      };
    }
  }

  // Pass 2: exact match against OSM names
  const exact = venues.find((v) => norm(v.name) === eventNorm);
  if (exact) {
    return {
      event_venue_name: eventName,
      matched: true,
      osm_name: exact.name,
      osm_id: exact.osm_id,
      amenity: exact.amenity,
      method: "exact",
    };
  }

  // Pass 3: fuzzy match
  const results = fuse.search(eventName, { limit: 1 });
  if (results.length > 0 && results[0].score !== undefined) {
    const score = results[0].score;
    // Fuse threshold: 0 = perfect match, 1 = no match. We accept < 0.3
    if (score < 0.3) {
      const v = results[0].item;
      return {
        event_venue_name: eventName,
        matched: true,
        osm_name: v.name,
        osm_id: v.osm_id,
        amenity: v.amenity,
        method: "fuzzy",
        fuzzy_score: score,
      };
    }
  }

  return { event_venue_name: eventName, matched: false };
}

// ── Collect venue names from all event sources ──
function collectVenueNames(sources: string[]): string[] {
  const names = new Set<string>();
  for (const src of sources) {
    try {
      const events = JSON.parse(readFileSync(`data/${src}.json`, "utf-8"));
      for (const e of events) {
        if (e.venue_name && e.venue_name !== "Unknown") {
          names.add(e.venue_name);
        }
      }
    } catch {
      // Source file doesn't exist yet — skip
    }
  }
  return [...names].sort();
}

// ── Stats ──
function printStats(results: MatchResult[]) {
  const matched = results.filter((r) => r.matched);
  const unmatched = results.filter((r) => !r.matched);
  const total = results.length;

  console.log(`\nMatched:   ${matched.length}/${total} (${((matched.length / total) * 100).toFixed(1)}%)`);
  console.log(`Unmatched: ${unmatched.length}/${total} (${((unmatched.length / total) * 100).toFixed(1)}%)`);

  const byMethod: Record<string, number> = {};
  for (const r of matched) {
    byMethod[r.method!] = (byMethod[r.method!] || 0) + 1;
  }
  console.log("  By method:", Object.entries(byMethod).map(([k, v]) => `${k}=${v}`).join(", "));

  if (unmatched.length > 0 && unmatched.length <= 30) {
    console.log(`\nUnmatched names (add to data/venue-aliases.json):`);
    unmatched.forEach((u) => console.log(`  - ${u.event_venue_name}`));
  } else if (unmatched.length > 30) {
    console.log(`\n${unmatched.length} unmatched — showing first 30:`);
    unmatched.slice(0, 30).forEach((u) => console.log(`  - ${u.event_venue_name}`));
    console.log(`  ... and ${unmatched.length - 30} more`);
  }
}

// ── Main ──
async function main() {
  console.log("Phase 5: Venue Matching\n");

  // Load OSM venues
  const venues: OSMVenue[] = JSON.parse(readFileSync("data/venues-osm.json", "utf-8"));
  console.log(`OSM venues loaded: ${venues.length}`);

  // Load aliases
  const aliases: AliasEntry[] = JSON.parse(readFileSync("data/venue-aliases.json", "utf-8"));
  const aliasMap = buildAliasMap(aliases);
  console.log(`Aliases loaded: ${aliases.length} entries → ${aliasMap.size} mappings`);

  // Build Fuse index
  const fuse = new Fuse(venues, {
    keys: ["name"],
    threshold: 0.3,
    distance: 100,
    includeScore: true,
  });

  // Collect venue names from all event sources
  const sources = [
    "venues-berlincinema",
    "venues-englishcinema",
    "venues-openair",
  ];
  const venueNames = collectVenueNames(sources);
  console.log(`Unique event venue names: ${venueNames.length}`);

  // Match
  const results: MatchResult[] = venueNames.map((name) => matchVenue(name, venues, aliasMap, fuse));

  // Write
  writeFileSync("data/venue-matches.json", JSON.stringify(results, null, 2));

  printStats(results);
  console.log(`\nResults → data/venue-matches.json`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
