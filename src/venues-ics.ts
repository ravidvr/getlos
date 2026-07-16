// Phase 3: Parse ICS and RSS feeds from Berlin venue calendars
// Legal: ICS/RSS feeds are explicitly published for programmatic access

import { readFileSync, writeFileSync } from "fs";
import ical from "node-ical";

// Quick compatibility: node-ical ESM exports parseICS on the default
const parseICS = (ical as any).parseICS || ical.sync?.parseICS;
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
  categories: string[];
  event_url: string;
  ticket_url?: string;
  image_url?: string;
  price?: string;
  last_updated: string;
}

async function fetchICS(url: string, venueName: string): Promise<NormalizedEvent[]> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "getlos/0.1.0 (Berlin events map)" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const raw = await resp.text();
  const parsed = parseICS(raw);

  return Object.values(parsed)
    .filter((e: any) => e.type === "VEVENT")
    .map((e: any) => ({
      source: "ics",
      source_id: e.uid || `${url}_${e.start?.toISOString() || Date.now()}`,
      title: e.summary?.trim() || "Untitled Event",
      description: e.description?.trim() || "",
      start_datetime: e.start?.toISOString() || "",
      end_datetime: e.end?.toISOString() || "",
      venue_name: e.location?.trim() || venueName,
      categories: typeof e.categories === "string"
        ? e.categories.split(",").map((c: string) => c.trim().toLowerCase())
        : Array.isArray(e.categories)
          ? e.categories.map((c: string) => String(c).trim().toLowerCase())
          : [],
      event_url: e.url || url,
      ticket_url: e.url || undefined,
      last_updated: e.lastmodified?.toISOString() || new Date().toISOString(),
    }));
}

async function fetchRSS(url: string, venueName: string): Promise<NormalizedEvent[]> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "getlos/0.1.0 (Berlin events map)" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const xml = await resp.text();
  const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: true });
  const doc = parser.parse(xml);

  // Handle both RSS 2.0 and Atom formats
  let items: any[] = [];
  if (doc.rss?.channel?.item) {
    items = Array.isArray(doc.rss.channel.item) ? doc.rss.channel.item : [doc.rss.channel.item];
  } else if (doc.feed?.entry) {
    items = Array.isArray(doc.feed.entry) ? doc.feed.entry : [doc.feed.entry];
  }

  return items.map((item: any) => ({
    source: "rss",
    source_id: item.guid?.["#text"] || item.guid || item.link || `${url}_${Math.random()}`,
    title: item.title?.["#text"] || item.title || "Untitled Event",
    description: item.description?.["#text"] || item.description || item.summary?.["#text"] || item.summary || "",
    start_datetime: "", // RSS rarely has structured dates — needs per-feed parsing later
    end_datetime: "",
    venue_name: venueName,
    categories: Array.isArray(item.category)
      ? item.category.map((c: any) => (typeof c === "string" ? c : c["#text"] || c._).toLowerCase())
      : [],
    event_url: item.link?.["@_href"] || item.link || "",
    last_updated: item.pubDate || item.updated || new Date().toISOString(),
  }));
}

async function main() {
  const feeds: FeedEntry[] = JSON.parse(readFileSync("data/venue-feeds.json", "utf-8"));
  const allEvents: NormalizedEvent[] = [];
  const results: { venue: string; status: "ok" | "fail"; count: number; error?: string }[] = [];

  for (const feed of feeds) {
    try {
      process.stdout.write(`  ${feed.venue_name.padEnd(30)} `);
      let events: NormalizedEvent[];
      if (feed.feed_type === "ics") {
        events = await fetchICS(feed.feed_url, feed.venue_name);
      } else {
        events = await fetchRSS(feed.feed_url, feed.venue_name);
      }
      allEvents.push(...events);
      results.push({ venue: feed.venue_name, status: "ok", count: events.length });
      console.log(`✓ ${events.length} events`);
    } catch (err: any) {
      results.push({ venue: feed.venue_name, status: "fail", count: 0, error: err.message });
      console.log(`✗ ${err.message}`);
    }
  }

  writeFileSync("data/venues-ics.json", JSON.stringify(allEvents, null, 2));

  const ok = results.filter((r) => r.status === "ok");
  const failed = results.filter((r) => r.status === "fail");
  console.log(`\nDone: ${allEvents.length} events from ${ok.length}/${feeds.length} feeds`);
  if (failed.length > 0) {
    console.log(`\nFailed feeds (${failed.length}):`);
    failed.forEach((f) => console.log(`  - ${f.venue}: ${f.error}`));
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
