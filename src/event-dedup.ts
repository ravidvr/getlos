// Phase 6: Event deduplication — same event from multiple sources → one record
// Strategy: group by normalized title + date + venue, merge sources

import { readFileSync, writeFileSync } from "fs";

interface RawEvent {
  source: string;
  source_id: string;
  title: string;
  description: string;
  start_datetime: string;
  end_datetime: string;
  venue_name: string;
  categories?: string[];
  category?: string;
  genre?: string;
  artist?: string;
  event_url: string;
  ticket_url?: string;
  image_url?: string;
  language?: string;
  price?: string;
  last_updated: string;
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

// Normalize for dedup key
function dedupKey(e: RawEvent): string {
  const title = e.title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const date = e.start_datetime?.slice(0, 10) || ""; // YYYY-MM-DD
  const venue = e.venue_name.toLowerCase().trim();
  return `${title}|${date}|${venue}`;
}

async function main() {
  const sources = [
    "venues-berlincinema",
    "venues-englishcinema",
  ];
  const allEvents: RawEvent[] = [];

  for (const src of sources) {
    try {
      const raw = JSON.parse(readFileSync(`data/${src}.json`, "utf-8"));
      const events = Array.isArray(raw) ? raw : [];
      allEvents.push(...events);
      console.log(`  ${src}: ${events.length} events`);
    } catch {
      console.log(`  ${src}: skipped (no data)`);
    }
  }

  if (allEvents.length === 0) {
    console.log("\nNo events to deduplicate. Run API fetchers first.");
    writeFileSync("data/events-combined.json", "[]");
    return;
  }

  // Group by dedup key
  const groups = new Map<string, RawEvent[]>();
  for (const e of allEvents) {
    const key = dedupKey(e);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  // Merge each group
  const merged: MergedEvent[] = [];
  for (const [_, group] of groups) {
    const first = group[0];

    // Collect categories/genres/artists from all sources
    const categories = new Set<string>();
    const genres = new Set<string>();
    const artists = new Set<string>();

    for (const e of group) {
      if (e.categories) e.categories.forEach((c) => categories.add(c.toLowerCase()));
      if (e.category) categories.add(e.category.toLowerCase());
      if (e.genre) genres.add(e.genre.toLowerCase());
      if (e.artist) artists.add(e.artist);
    }

    merged.push({
      id: `evt_${merged.length + 1}`,
      title: first.title,
      description: first.description || "",
      start_datetime: first.start_datetime,
      end_datetime: first.end_datetime || first.start_datetime,
      venue_name: first.venue_name,
      sources: group.map((e) => ({
        source: e.source,
        source_id: e.source_id,
        event_url: e.event_url || "",
      })),
      categories: [...categories],
      genres: [...genres],
      artists: [...artists],
      ticket_url: group.find((e) => e.ticket_url)?.ticket_url,
      image_url: group.find((e) => e.image_url)?.image_url,
      language: group.find((e) => e.language)?.language,
      price: group.find((e) => e.price)?.price,
      last_updated: new Date().toISOString(),
    });
  }

  writeFileSync("data/events-combined.json", JSON.stringify(merged, null, 2));

  const dedupPct = allEvents.length > 0
    ? ((1 - merged.length / allEvents.length) * 100).toFixed(1)
    : "0";
  console.log(`\nRaw events:    ${allEvents.length}`);
  console.log(`Unique events: ${merged.length}`);
  console.log(`Deduped:       ${dedupPct}%`);
  console.log(`\nOutput → data/events-combined.json`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
