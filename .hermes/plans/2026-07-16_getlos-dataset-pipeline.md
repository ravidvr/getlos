# Berlin Events Map — Dataset Generation Pipeline

> **For Hermes:** Use this plan to build each script in sequence. Each phase is self-contained — you get a usable output file after every phase.

**Goal:** Generate a clean, deduplicated dataset of ~500+ Berlin venues and ~1000+ events from legal, venue-anchored sources.

**Architecture:** Sequential pipeline of Node.js/TypeScript scripts. Each phase writes an intermediate JSON file. No database until the web app phase — JSON files are the source of truth during dataset construction.

**Tech Stack:** Node.js, TypeScript, node-fetch, node-ical, fast-xml-parser, fuse.js (fuzzy matching)

**Output files:**
- `data/venues-osm.json` — raw OSM venues (Phase 1)
- `data/venues-ics.json` — events from venue ICS feeds (Phase 3)
- `data/venues-ticketmaster.json` — events from Ticketmaster (Phase 4)
- `data/venues-eventbrite.json` — events from Eventbrite (Phase 4)
- `data/venues-bandsintown.json` — events from Bandsintown (Phase 4)
- `data/venues-combined.json` — deduplicated venue master list (Phase 5)
- `data/events-combined.json` — deduplicated event master list (Phase 6)

---

## Phase 1: Project Scaffold

### Task 1.1: Initialize project

**Objective:** Set up the Node.js/TypeScript project structure.

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/` directory

**Steps:**

1. Write `package.json`:
```json
{
  "name": "getlos",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "venues:osm": "npx tsx src/venues-osm.ts",
    "venues:ics": "npx tsx src/venues-ics.ts",
    "venues:eventbrite": "npx tsx src/venues-eventbrite.ts",
    "venues:ticketmaster": "npx tsx src/venues-ticketmaster.ts",
    "venues:bandsintown": "npx tsx src/venues-bandsintown.ts",
    "match:venues": "npx tsx src/venue-matcher.ts",
    "dedup:events": "npx tsx src/event-dedup.ts",
    "pipeline": "npm run venues:osm && npm run venues:ics && npm run venues:eventbrite && npm run venues:ticketmaster && npm run match:venues && npm run dedup:events"
  },
  "dependencies": {
    "fuse.js": "^7.0.0",
    "node-fetch": "^3.3.0",
    "node-ical": "^0.18.0",
    "fast-xml-parser": "^4.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

2. Write `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

3. Write `.gitignore`:
```
node_modules/
dist/
.env
data/
```

4. Run: `npm install`

---

## Phase 2: OSM Venue Foundation

### Task 2.1: Query Overpass API for Berlin venues

**Objective:** Pull all Berlin venues from OpenStreetMap in one HTTP call. No auth, no keys, free.

**Files:**
- Create: `src/venues-osm.ts`

**How Overpass works:** A single POST to `https://overpass-api.de/api/interpreter` with a query body. Returns XML with node elements. The query searches within Berlin's bounding box.

**Complete code:**

```typescript
// src/venues-osm.ts
import { writeFileSync } from "fs";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Berlin bounding box (slightly padded)
const BBOX = { south: 52.35, west: 13.08, north: 52.68, east: 13.75 };

// OSM amenity tags that map to real event venues
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
  website?: string;
  phone?: string;
  capacity?: number;
}

function buildQuery(): string {
  const tags = VENUE_TAGS.map((t) => `node["amenity"="${t}"]`).join("");
  const bbox = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  return `[out:json][timeout:60];(${tags}(${bbox}););out body;`;
}

async function fetchVenues(): Promise<OSMVenue[]> {
  const resp = await fetch(OVERPASS_URL, {
    method: "POST",
    body: `data=${encodeURIComponent(buildQuery())}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
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
    amenity: el.tags.amenity || "unknown",
    street: el.tags["addr:street"],
    housenumber: el.tags["addr:housenumber"],
    postcode: el.tags["addr:postcode"],
    website: el.tags.website || el.tags["contact:website"],
    phone: el.tags.phone || el.tags["contact:phone"],
    capacity: el.tags.capacity ? parseInt(el.tags.capacity) : undefined,
  }));
}

async function main() {
  console.log("Querying Overpass API for Berlin venues...");
  const venues = await fetchVenues();
  const path = "data/venues-osm.json";
  writeFileSync(path, JSON.stringify(venues, null, 2));
  console.log(`Done: ${venues.length} venues written to ${path}`);
}

main();
```

**Verification:** Run `npm run venues:osm`
Expected output: `Done: 500-1200 venues written to data/venues-osm.json`

---

## Phase 3: Venue ICS Feed Collection

### Task 3.1: Compile venue calendar URLs

**Objective:** Build a manually curated list of Berlin venue calendar URLs that expose ICS feeds or structured event data.

**Files:**
- Create: `data/venue-feeds.json`

This is a manual curation step. Start with these known sources:

```json
[
  {
    "venue_name": "Volksbühne",
    "venue_osm_match": "Volksbühne",
    "feed_url": "https://www.volksbuehne.berlin/calendar/ics",
    "feed_type": "ics"
  },
  {
    "venue_name": "Deutsche Oper Berlin",
    "venue_osm_match": "Deutsche Oper Berlin",
    "feed_url": "https://www.deutscheoperberlin.de/calendar/ics",
    "feed_type": "ics"
  },
  {
    "venue_name": "Konzerthaus Berlin",
    "venue_osm_match": "Konzerthaus Berlin",
    "feed_url": "https://www.konzerthaus.de/en/calendar/ics",
    "feed_type": "ics"
  },
  {
    "venue_name": "Berliner Philharmoniker",
    "venue_osm_match": "Philharmonie Berlin",
    "feed_url": "https://www.berliner-philharmoniker.de/en/concerts/calendar/ics",
    "feed_type": "ics"
  },
  {
    "venue_name": "Kindl - Zentrum für zeitgenössische Kunst",
    "venue_osm_match": "Kindl",
    "feed_url": "https://www.kindl-berlin.de/calendar/ics",
    "feed_type": "ics"
  },
  {
    "venue_name": "Berghain",
    "venue_osm_match": "Berghain",
    "feed_url": "https://berghain.berlin/en/events/ics",
    "feed_type": "ics"
  },
  {
    "venue_name": "SO36",
    "venue_osm_match": "SO36",
    "feed_url": "https://so36.com/events/ics",
    "feed_type": "ics"
  },
  {
    "venue_name": "Lido Berlin",
    "venue_osm_match": "Lido",
    "feed_url": "https://www.lido-berlin.de/events/ics",
    "feed_type": "ics"
  },
  {
    "venue_name": "Astra Kulturhaus",
    "venue_osm_match": "Astra Kulturhaus",
    "feed_url": "https://www.astra-berlin.de/calendar/ics",
    "feed_type": "ics"
  },
  {
    "venue_name": "Festsaal Kreuzberg",
    "venue_osm_match": "Festsaal Kreuzberg",
    "feed_url": "https://festsaal-kreuzberg.de/calendar/ics",
    "feed_type": "ics"
  },
  {
    "venue_name": "Holzmarkt",
    "venue_osm_match": "Holzmarkt",
    "feed_url": "https://www.holzmarkt.com/events/ics",
    "feed_type": "ics"
  },
  {
    "venue_name": "Kater Blau",
    "venue_osm_match": "Kater Blau",
    "feed_url": "https://katerblau.de/events/ics",
    "feed_type": "ics"
  },
  {
    "venue_name": "Schwuz",
    "venue_osm_match": "Schwuz",
    "feed_url": "https://www.schwuz.de/calendar/ics",
    "feed_type": "ics"
  },
  {
    "venue_name": "GRETCHEN",
    "venue_osm_match": "Gretchen",
    "feed_url": "https://gretchen-club.de/calendar/ics",
    "feed_type": "ics"
  },
  {
    "venue_name": "Visit Berlin Events RSS",
    "venue_osm_match": null,
    "feed_url": "https://www.visitberlin.de/en/events/rss",
    "feed_type": "rss"
  }
]
```

These URLs are educated guesses — each must be verified. The script in Task 3.2 will report which ones fail.

### Task 3.2: ICS/RSS parser script

**Objective:** Fetch all feeds from `venue-feeds.json`, parse ICS and RSS, output normalized events.

**Files:**
- Create: `src/venues-ics.ts`

```typescript
// src/venues-ics.ts
import { readFileSync, writeFileSync } from "fs";
import ical from "node-ical";
import { XMLParser } from "fast-xml-parser";

interface FeedEntry {
  venue_name: string;
  venue_osm_match: string | null;
  feed_url: string;
  feed_type: "ics" | "rss";
}

interface NormalizedEvent {
  source: string;
  source_id: string;
  title: string;
  description: string;
  start_datetime: string;
  end_datetime: string;
  venue_name: string;
  latitude?: number;
  longitude?: number;
  ticket_url?: string;
  event_url: string;
  categories: string[];
  last_updated: string;
}

async function fetchICS(url: string, venueName: string): Promise<NormalizedEvent[]> {
  const resp = await fetch(url);
  const raw = await resp.text();
  const events = ical.sync.parseICS(raw);

  return Object.values(events)
    .filter((e): e is ical.VEvent => e.type === "VEVENT")
    .map((e) => ({
      source: "ics",
      source_id: e.uid || `${url}_${e.start?.toISOString()}`,
      title: e.summary || "Untitled Event",
      description: e.description || "",
      start_datetime: e.start?.toISOString() || "",
      end_datetime: e.end?.toISOString() || "",
      venue_name: e.location || venueName,
      ticket_url: e.url || undefined,
      event_url: e.url || url,
      categories: (e.categories || []).map((c: string) => c.toLowerCase()),
      last_updated: e.lastmodified?.toISOString() || new Date().toISOString(),
    }));
}

async function fetchRSS(url: string, venueName: string): Promise<NormalizedEvent[]> {
  const resp = await fetch(url);
  const xml = await resp.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(xml);
  const items = doc.rss?.channel?.item || [];

  return (Array.isArray(items) ? items : [items]).map((item: any) => ({
    source: "rss",
    source_id: item.guid || item.link || `${url}_${Math.random()}`,
    title: item.title || "Untitled Event",
    description: item.description || "",
    start_datetime: "", // RSS rarely has structured dates — manual parsing needed per feed
    end_datetime: "",
    venue_name: venueName,
    event_url: item.link || url,
    categories: [],
    last_updated: item.pubDate || new Date().toISOString(),
  }));
}

async function main() {
  const feeds: FeedEntry[] = JSON.parse(readFileSync("data/venue-feeds.json", "utf-8"));
  const allEvents: NormalizedEvent[] = [];
  const failed: string[] = [];

  for (const feed of feeds) {
    try {
      console.log(`Fetching: ${feed.venue_name} (${feed.feed_url})`);
      let events: NormalizedEvent[];
      if (feed.feed_type === "ics") {
        events = await fetchICS(feed.feed_url, feed.venue_name);
      } else {
        events = await fetchRSS(feed.feed_url, feed.venue_name);
      }
      allEvents.push(...events);
      console.log(`  → ${events.length} events`);
    } catch (err: any) {
      console.log(`  → FAILED: ${err.message}`);
      failed.push(`${feed.venue_name}: ${err.message}`);
    }
  }

  writeFileSync("data/venues-ics.json", JSON.stringify(allEvents, null, 2));
  console.log(`\nDone: ${allEvents.length} total events, ${failed.length} failed feeds`);
  if (failed.length > 0) {
    console.log("Failed feeds:");
    failed.forEach((f) => console.log(`  - ${f}`));
  }
}

main();
```

**Verification:** Run `npm run venues:ics`
Expected: some feeds will fail (URLs are guesses). The successful ones produce events in `data/venues-ics.json`. Update `venue-feeds.json` URLs based on failures.

**Note:** After initial run, you'll manually verify each feed URL. Delete non-working entries from `venue-feeds.json`. This script is designed to be run repeatedly as you curate the feed list.

---

## Phase 4: API Source Fetchers

### Task 4.1: Environment setup

**Objective:** Create `.env` file for API keys. Never commit this.

**Files:**
- Create: `.env.example`

```
# Ticketmaster
TICKETMASTER_API_KEY=

# Eventbrite
EVENTBRITE_API_KEY=

# Bandsintown
BANDSINTOWN_APP_ID=
```

Copy to `.env` and fill in keys as you get them approved.

### Task 4.2: Eventbrite fetcher

**Objective:** Pull Berlin venue events from Eventbrite API.

**Files:**
- Create: `src/venues-eventbrite.ts`

```typescript
// src/venues-eventbrite.ts
import { writeFileSync } from "fs";

const EVENTBRITE_KEY = process.env.EVENTBRITE_API_KEY;
const BASE = "https://www.eventbriteapi.com/v3";

interface EBEvent {
  id: string;
  name: { text: string };
  description: { text: string };
  start: { utc: string };
  end: { utc: string };
  venue_id: string;
  url: string;
  category_id: string;
  format_id: string;
  online_event: boolean;
}

async function fetchBerlinEvents(): Promise<EBEvent[]> {
  // Eventbrite location search: Berlin = venue.city "Berlin" + venue.country "DE"
  // We use the events search endpoint with location parameters
  const url = `${BASE}/events/search/?location.address=Berlin&location.within=20km&expand=venue&page_size=100`;
  const headers = { Authorization: `Bearer ${EVENTBRITE_KEY}` };

  let all: EBEvent[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 10) {
    const resp = await fetch(`${url}&page=${page}`, { headers });
    const data = (await resp.json()) as {
      events: EBEvent[];
      pagination: { has_more_items: boolean; page_count: number };
    };
    // Filter: exclude online-only events
    const inPerson = data.events.filter((e) => !e.online_event);
    all = all.concat(inPerson);
    hasMore = data.pagination.has_more_items && page < data.pagination.page_count;
    page++;
  }

  return all;
}

async function main() {
  if (!EVENTBRITE_KEY) {
    console.error("Set EVENTBRITE_API_KEY in .env");
    process.exit(1);
  }
  console.log("Fetching Eventbrite Berlin events...");
  const events = await fetchBerlinEvents();
  writeFileSync("data/venues-eventbrite.json", JSON.stringify(events, null, 2));
  console.log(`Done: ${events.length} events`);
}

main();
```

**Verification:** Requires `EVENTBRITE_API_KEY` in `.env`. Run `EVENTBRITE_API_KEY=xxx npm run venues:eventbrite`.

### Task 4.3: Ticketmaster fetcher

**Objective:** Pull Berlin venue events from Ticketmaster Discovery API.

**Files:**
- Create: `src/venues-ticketmaster.ts`

```typescript
// src/venues-ticketmaster.ts
import { writeFileSync } from "fs";

const TM_KEY = process.env.TICKETMASTER_API_KEY;
const BASE = "https://app.ticketmaster.com/discovery/v2";

async function fetchBerlinEvents(): Promise<any[]> {
  const url = `${BASE}/events.json?apikey=${TM_KEY}&city=Berlin&countryCode=DE&size=200&sort=date,asc&classificationName=music,arts,theatre,sports`;
  const resp = await fetch(url);
  const data = (await resp.json()) as { _embedded?: { events: any[] }; page: any };
  return data._embedded?.events || [];
}

async function main() {
  if (!TM_KEY) {
    console.error("Set TICKETMASTER_API_KEY in .env");
    process.exit(1);
  }
  console.log("Fetching Ticketmaster Berlin events...");
  const events = await fetchBerlinEvents();
  writeFileSync("data/venues-ticketmaster.json", JSON.stringify(events, null, 2));
  console.log(`Done: ${events.length} events`);
}

main();
```

**Verification:** Requires `TICKETMASTER_API_KEY`. Run `TICKETMASTER_API_KEY=xxx npm run venues:ticketmaster`.

### Task 4.4: Bandsintown fetcher

**Objective:** Pull Berlin concerts from Bandsintown API.

**Files:**
- Create: `src/venues-bandsintown.ts`

```typescript
// src/venues-bandsintown.ts
import { writeFileSync } from "fs";

const BIT_APP_ID = process.env.BANDSINTOWN_APP_ID;

async function fetchBerlinEvents(): Promise<any[]> {
  // Bandsintown: search by location
  const url = `https://rest.bandsintown.com/artists/events?app_id=${BIT_APP_ID}&location=Berlin,Germany&radius=20&per_page=100`;
  const resp = await fetch(url);
  return resp.json();
}

async function main() {
  if (!BIT_APP_ID) {
    console.error("Set BANDSINTOWN_APP_ID in .env");
    process.exit(1);
  }
  console.log("Fetching Bandsintown Berlin events...");
  const events = await fetchBerlinEvents();
  writeFileSync("data/venues-bandsintown.json", JSON.stringify(events, null, 2));
  console.log(`Done: ${events.length} events`);
}

main();
```

**Verification:** Requires `BANDSINTOWN_APP_ID`. Run `BANDSINTOWN_APP_ID=xxx npm run venues:bandsintown`.

---

## Phase 5: Venue Normalization & Matching

### Task 5.1: Venue matcher script

**Objective:** Take OSM venues as the canonical list, match every event's venue_name to an OSM venue using exact match → alias → fuzzy + distance.

**Files:**
- Create: `src/venue-matcher.ts`
- Create: `data/venue-aliases.json`

```typescript
// src/venue-matcher.ts
import { readFileSync, writeFileSync } from "fs";
import Fuse from "fuse.js";

interface OSMVenue {
  osm_id: number;
  name: string;
  latitude: number;
  longitude: number;
  amenity: string;
  street?: string;
  housenumber?: string;
  website?: string;
}

interface VenueAliases {
  canonical: string;
  aliases: string[];
}

// Load aliases
const aliases: VenueAliases[] = JSON.parse(
  readFileSync("data/venue-aliases.json", "utf-8")
);

// Normalize: lowercase, strip punctuation, collapse whitespace
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveAlias(name: string): string {
  const n = norm(name);
  for (const a of aliases) {
    if (a.aliases.map(norm).includes(n)) return a.canonical;
  }
  return name;
}

function matchVenue(
  eventVenueName: string,
  venues: OSMVenue[]
): OSMVenue | null {
  const resolved = resolveAlias(eventVenueName);
  const n = norm(resolved);

  // Pass 1: exact match
  const exact = venues.find((v) => norm(v.name) === n);
  if (exact) return exact;

  // Pass 2: fuzzy match with Fuse
  const fuse = new Fuse(venues, {
    keys: ["name"],
    threshold: 0.3,
    distance: 100,
  });
  const results = fuse.search(resolved);
  if (results.length > 0) return results[0].item;

  return null;
}

async function main() {
  const venues: OSMVenue[] = JSON.parse(
    readFileSync("data/venues-osm.json", "utf-8")
  );

  // Collect all unique venue names from all event sources
  const sources = ["venues-ics", "venues-eventbrite", "venues-ticketmaster", "venues-bandsintown"];
  const venueNames = new Set<string>();
  const matched: Record<string, OSMVenue | null> = {};

  for (const src of sources) {
    try {
      const events = JSON.parse(readFileSync(`data/${src}.json`, "utf-8"));
      // Extract venue names based on source format (different for each source)
      for (const e of events) {
        const vn = e.venue_name || e._embedded?.venues?.[0]?.name || "Unknown";
        venueNames.add(vn);
      }
    } catch {
      // Source file doesn't exist yet — skip
    }
  }

  // Match each unique venue name
  for (const name of venueNames) {
    matched[name] = matchVenue(name, venues);
  }

  // Output
  const result = {
    total_osr_venues: venues.length,
    unique_event_venue_names: venueNames.size,
    matched: Object.entries(matched)
      .filter(([_, v]) => v !== null)
      .map(([name, v]) => ({ event_name: name, osm_match: v!.name, osm_id: v!.osm_id })),
    unmatched: Object.entries(matched)
      .filter(([_, v]) => v === null)
      .map(([name]) => name),
  };

  writeFileSync("data/venue-matches.json", JSON.stringify(result, null, 2));
  console.log(`Matched: ${result.matched.length}`);
  console.log(`Unmatched: ${result.unmatched.length}`);
  console.log(`Unmatched names: ${result.unmatched.join(", ")}`);
}

main();
```

**After first run:** Review the `unmatched` list. For each unmatched venue, either:
- Add an alias to `data/venue-aliases.json`
- Add the venue to OSM (it may not exist in OSM yet)
- Accept the gap

```json
// data/venue-aliases.json (starter set)
[
  {
    "canonical": "Columbiahalle",
    "aliases": ["Columbia Hall", "Columbiahalle Berlin", "C-Halle"]
  },
  {
    "canonical": "Berghain",
    "aliases": ["Berghain Panorama Bar", "Berghain Berlin"]
  },
  {
    "canonical": "Mercedes-Benz Arena",
    "aliases": ["Uber Arena", "O2 World", "Mercedes Benz Arena Berlin"]
  },
  {
    "canonical": "Max-Schmeling-Halle",
    "aliases": ["Max Schmeling Halle", "Max-Schmeling Halle Berlin"]
  },
  {
    "canonical": "Waldbühne",
    "aliases": ["Waldbühne Berlin", "Berlin Waldbühne"]
  },
  {
    "canonical": "Tempodrom",
    "aliases": ["Tempodrom Berlin"]
  },
  {
    "canonical": "Verti Music Hall",
    "aliases": ["Verti Music Hall Berlin", "Music Hall Berlin"]
  },
  {
    "canonical": "Festsaal Kreuzberg",
    "aliases": ["Festsaal", "Festsaal Berlin"]
  },
  {
    "canonical": "SO36",
    "aliases": ["SO 36", "SO36 Berlin", "SO36 Club"]
  },
  {
    "canonical": "Lido",
    "aliases": ["Lido Berlin", "Lido Club"]
  },
  {
    "canonical": "Astra Kulturhaus",
    "aliases": ["Astra", "Astra Berlin", "Astra Kulturhaus Berlin"]
  },
  {
    "canonical": "Gretchen",
    "aliases": ["GRETCHEN Berlin", "Gretchen Club"]
  },
  {
    "canonical": "Schwuz",
    "aliases": ["SchwuZ", "Schwuz Berlin", "SchwuZ Berlin"]
  },
  {
    "canonical": "Kater Blau",
    "aliases": ["KaterBlau", "Kater Blau Berlin"]
  },
  {
    "canonical": "Watergate",
    "aliases": ["Watergate Berlin", "Watergate Club"]
  },
  {
    "canonical": "Tresor",
    "aliases": ["Tresor Berlin", "Tresor Club"]
  },
  {
    "canonical": "Ritter Butzke",
    "aliases": ["Ritter Butzke Berlin", "Butzke"]
  },
  {
    "canonical": "Sisyphos",
    "aliases": ["Sisyphos Berlin", "Sisyphos Club"]
  },
  {
    "canonical": "KitKatClub",
    "aliases": ["KitKat", "Kit Kat Club", "KitKat Berlin"]
  },
  {
    "canonical": "about blank",
    "aliases": ["://about blank", "About Blank", "About Blank Berlin"]
  },
  {
    "canonical": "Heimathafen Neukölln",
    "aliases": ["Heimathafen", "Heimathafen Berlin"]
  },
  {
    "canonical": "Kindl",
    "aliases": ["Kindl Berlin", "Kindl - Zentrum für zeitgenössische Kunst"]
  },
  {
    "canonical": "Holzmarkt",
    "aliases": ["Holzmarkt Berlin", "Holzmarkt 25"]
  },
  {
    "canonical": "Zenner",
    "aliases": ["Zenner Berlin", "Zenner Treptow"]
  },
  {
    "canonical": "Volksbühne",
    "aliases": ["Volksbühne Berlin", "Volksbühne am Rosa-Luxemburg-Platz"]
  }
]
```

**Verification:** Run `npm run match:venues`. Review `data/venue-matches.json` unmatched list. Iterate on aliases.

---

## Phase 6: Event Deduplication

### Task 6.1: Event dedup script

**Objective:** Same event on multiple sources → merge into one record, keep all source references.

**Files:**
- Create: `src/event-dedup.ts`

```typescript
// src/event-dedup.ts
import { readFileSync, writeFileSync } from "fs";

interface NormalizedEvent {
  id: string;
  source: string;
  source_id: string;
  title: string;
  start_datetime: string;
  venue_name: string;
  // ... other fields
}

interface MergedEvent {
  id: string;
  title: string;
  start_datetime: string;
  end_datetime: string;
  venue_name: string;
  sources: { source: string; source_id: string; event_url: string }[];
  categories: string[];
  description: string;
  ticket_url?: string;
  image_url?: string;
  last_updated: string;
}

function dedupKey(e: NormalizedEvent): string {
  // Normalize: lowercase title, remove punctuation, same date, same venue
  const t = e.title.toLowerCase().replace(/[^\w\s]/g, "").trim();
  const d = e.start_datetime?.slice(0, 10); // YYYY-MM-DD
  const v = e.venue_name.toLowerCase().trim();
  return `${t}|${d}|${v}`;
}

async function main() {
  const sources = ["venues-ics", "venues-eventbrite", "venues-ticketmaster", "venues-bandsintown"];
  const allEvents: NormalizedEvent[] = [];

  for (const src of sources) {
    try {
      const raw = JSON.parse(readFileSync(`data/${src}.json`, "utf-8"));
      // Normalize each source's format into NormalizedEvent
      // (format-specific parsing needed — simplified here)
      allEvents.push(...raw);
    } catch {
      // skip missing sources
    }
  }

  // Group by dedup key
  const groups = new Map<string, NormalizedEvent[]>();
  for (const e of allEvents) {
    const key = dedupKey(e);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  // Merge each group
  const merged: MergedEvent[] = [];
  for (const [_, group] of groups) {
    const first = group[0];
    merged.push({
      id: `evt_${merged.length}`,
      title: first.title,
      start_datetime: first.start_datetime,
      end_datetime: first.end_datetime || first.start_datetime,
      venue_name: first.venue_name,
      sources: group.map((e) => ({
        source: e.source,
        source_id: e.source_id,
        event_url: e.event_url || "",
      })),
      categories: [...new Set(group.flatMap((e) => e.categories || []))],
      description: first.description || "",
      ticket_url: first.ticket_url,
      image_url: first.image_url,
      last_updated: new Date().toISOString(),
    });
  }

  writeFileSync("data/events-combined.json", JSON.stringify(merged, null, 2));
  console.log(`Input: ${allEvents.length} raw events`);
  console.log(`Output: ${merged.length} unique events`);
  console.log(`Dedup ratio: ${((1 - merged.length / allEvents.length) * 100).toFixed(1)}%`);
}

main();
```

**Verification:** Run `npm run dedup:events`. Review dedup ratio — should be 10-30% for multi-source events.

---

## Phase 7: Combined Venue Output

### Task 7.1: Final venue master

**Objective:** Merge OSM venues with matched event data to produce the final venue list with upcoming event counts.

**Files:**
- Create: `src/venues-final.ts`

This script loads `venues-osm.json` + `venue-matches.json` + `events-combined.json` and produces `data/venues-combined.json` where each venue has its event count and next event date.

---

## Validation Checklist

After each phase:

- [ ] **Phase 2:** `venues-osm.json` has 500+ entries with osm_id, name, lat, lon
- [ ] **Phase 3:** `venues-ics.json` has events even if only from 3-5 venues (feeds fail often — that's expected)
- [ ] **Phase 4:** Each API source produces its JSON file
- [ ] **Phase 5:** `venue-matches.json` shows >70% match rate; unmatched list is small (<50) and reviewable
- [ ] **Phase 6:** `events-combined.json` has fewer events than sum of inputs; dedup is working
- [ ] **Phase 7:** `venues-combined.json` is the single file the frontend loads

## Risks & Assumptions

1. **ICS URLs are guesses** — expect 70% failure rate on first run. Each must be manually verified by visiting the venue website.
2. **Ticketmaster API approval** — can take 1-2 weeks, may be rejected. Plan B: rely on Eventbrite + ICS + Bandsintown.
3. **Rate limits** — Overpass has a ~1 req/sec fair use policy. Our single query is well within limits.
4. **Venue name chaos** — no two sources will agree on "Berghain" vs "Berghain Panorama Bar" vs "Berghain Berlin". The alias table is the fix. Expect to grow it to ~100 entries over time.

## Quick Start (what to do first)

```bash
cd getlos
npm install
npm run venues:osm
# → Inspect data/venues-osm.json — this is your foundation
# → Then apply for Ticketmaster + Eventbrite keys
# → While waiting, run venues:ics and fix broken URLs
```
