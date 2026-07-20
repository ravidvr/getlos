// Phase: openair-kino.net scraper — Berlin open-air cinemas
// Discovers cinemas from /category/berlin/, then scrapes each cinema's events
// Extracts meta description (Wo:/Wann:), title, and address from event detail pages

import { writeFileSync } from "fs";

const BASE = "https://openair-kino.net";
const BERLIN_CAT = `${BASE}/category/berlin/`;

interface CinemaEvent {
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
  categories: string[];
  event_url: string;
  ticket_url: string;
  image_url: string;
  language: string;
  release_date: string;
  last_updated: string;
}

// ── German date parsing ────────────────────────────────────────────

const GERMAN_MONTHS: Record<string, string> = {
  Januar: "01", Februar: "02", "März": "03", April: "04",
  Mai: "05", Juni: "06", Juli: "07", August: "08",
  September: "09", Oktober: "10", November: "11", Dezember: "12",
};

function parseGermanDateFromMeta(wanStr: string): { date: string; time: string } | null {
  // Pattern: "Montag, 20. Juli 2026 21:30" or "Dienstag, 21. Juli 2026 21:30"
  // Day names are ignored — we only need day, month, year, time
  const m = wanStr.match(
    /[A-Za-zäöüÄÖÜ]+,\s+(\d{1,2})\.\s+(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+(\d{4})\s+(\d{1,2}:\d{2})/i,
  );
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const monthName = m[2];
  const month = GERMAN_MONTHS[monthName];
  if (!month) return null; // e.g. "März" with entity encoding won't match
  const year = m[3];
  const time = m[4].padStart(5, "0"); // ensure HH:MM
  return { date: `${year}-${month}-${day}`, time };
}

// Fallback: try to match "März" (entity-decoded) or other representations
function parseGermanDateFromMetaLoose(wanStr: string): { date: string; time: string } | null {
  // Strip leading day name, then match: "20. Juli 2026 21:30"
  const stripped = wanStr.replace(/^[A-Za-zäöüÄÖÜ]+,\s*/, "").trim();
  const m = stripped.match(
    /(\d{1,2})\.\s+(Januar|Februar|M[aä]rz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+(\d{4})\s+(\d{1,2}:\d{2})/i,
  );
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const monthRaw = m[2].toLowerCase().replace(/ä/g, "a"); // normalize März/März → Marz for lookup
  // Map back: März or März → "März"
  const monthMap: Record<string, string> = {
    januar: "01", februar: "02", marz: "03", april: "04", mai: "05", juni: "06",
    juli: "07", august: "08", september: "09", oktober: "10", november: "11", dezember: "12",
  };
  const month = monthMap[monthRaw];
  if (!month) return null;
  const year = m[3];
  const time = m[4].padStart(5, "0");
  return { date: `${year}-${month}-${day}`, time };
}

// ── HTML helpers ───────────────────────────────────────────────────

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&ouml;/g, "ö").replace(/&auml;/g, "ä")
    .replace(/&uuml;/g, "ü").replace(/&szlig;/g, "ß")
    .replace(/&Ouml;/g, "Ö").replace(/&Auml;/g, "Ä").replace(/&Uuml;/g, "Ü")
    .replace(/&eacute;/g, "é").replace(/&agrave;/g, "à")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–").replace(/&mdash;/g, "—")
    .replace(/&rsquo;/g, "'").replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, "\"").replace(/&ldquo;/g, "\"")
    .replace(/&hellip;/g, "…");
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

function cleanAddress(raw: string): string {
  // Split into lines, trim each, remove empties, join with ", "
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  let addr = lines.join(", ");
  // Clean up: remove double commas, fix spacing around commas
  addr = addr.replace(/,\s*,/g, ",").replace(/\s*,\s*/g, ", ");
  // Remove trailing comma
  addr = addr.replace(/,\s*$/, "");
  return addr;
}

// ── Scraping functions ─────────────────────────────────────────────

/** Discover all Berlin cinema category URLs from /category/berlin/ */
async function fetchBerlinCinemaUrls(): Promise<string[]> {
  const resp = await fetch(BERLIN_CAT, {
    headers: { "User-Agent": "getlos/1.0" },
  });
  if (!resp.ok) {
    console.error(`  Failed to fetch Berlin category page: ${resp.status}`);
    return [];
  }
  const html = await resp.text();

  // Match cinema category links: /category/berlin/{bezirk}/{cinema-name}/
  // These appear inside the kinoliste <ul class="children"> structure
  const cinemaPattern = /href="(https:\/\/openair-kino\.net\/category\/berlin\/[a-z0-9-]+\/[a-z0-9-]+\/)"/gi;
  const cinemas = new Set<string>();
  let m;
  while ((m = cinemaPattern.exec(html)) !== null) {
    const url = m[1];
    // Skip bezirk-level pages (they have no second-level path segment beyond the bezirk)
    // e.g. /category/berlin/mitte/ is a bezirk, /category/berlin/mitte/sommerkino-am-kulturforum/ is a cinema
    const pathParts = url.replace(/^https:\/\/openair-kino\.net\/category\/berlin\//, "").replace(/\/$/, "").split("/");
    if (pathParts.length === 2) {
      // Has both bezirk and cinema-name → it's a cinema page
      cinemas.add(url);
    }
  }
  return [...cinemas];
}

interface CinemaInfo {
  name: string;
  url: string;
}

interface EventLink {
  url: string;
  postId: string;
}

/** Scrape a cinema category page for event post links */
async function fetchCinemaEvents(cinemaUrl: string): Promise<EventLink[]> {
  const resp = await fetch(cinemaUrl, {
    headers: { "User-Agent": "getlos/1.0" },
  });
  if (!resp.ok) {
    console.error(`  Failed to fetch cinema page ${cinemaUrl}: ${resp.status}`);
    return [];
  }
  const html = await resp.text();

  const events: EventLink[] = [];
  // Pattern: <article id="post-26941" ...> ... <h2 class="entry-title"><a href="URL">Title</a></h2>
  // Extract from the <article> blocks
  const articlePattern = /<article\s+id="post-(\d+)"[^>]*>[\s\S]*?<h2\s+class="entry-title">\s*<a\s+href="([^"]+)"/gi;
  let m;
  while ((m = articlePattern.exec(html)) !== null) {
    events.push({ postId: m[1], url: m[2] });
  }
  return events;
}

interface EventDetail {
  title: string;
  venue: string;
  date: string;
  time: string;
  address: string;
  description: string;
  postId: string;
}

/** Scrape an event detail page for meta description, title, address */
async function fetchEventDetail(eventUrl: string, postId: string): Promise<EventDetail | null> {
  const resp = await fetch(eventUrl, {
    headers: { "User-Agent": "getlos/1.0" },
  });
  if (!resp.ok) {
    console.error(`  Failed to fetch event ${eventUrl}: ${resp.status}`);
    return null;
  }
  const html = await resp.text();

  // Meta description: " Wo: Sommerkino am Kulturforum | Wann: Montag, 20. Juli 2026 21:30 "
  const metaMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  if (!metaMatch || !metaMatch[1]) {
    // Skip events without meta description
    return null;
  }
  const metaContent = decodeHtmlEntities(metaMatch[1]).trim();
  if (!metaContent) return null;

  // Parse Wo: and Wann: from meta description
  const woMatch = metaContent.match(/Wo:\s*([^|]+?)\s*\|\s*Wann:/i);
  if (!woMatch) return null;
  const venue = woMatch[1].trim();
  const wanStr = metaContent.replace(/^.*Wann:\s*/i, "").trim();
  if (!venue || !wanStr) return null;

  // Parse date/time
  let dateTime = parseGermanDateFromMeta(wanStr);
  if (!dateTime) {
    dateTime = parseGermanDateFromMetaLoose(wanStr);
  }
  if (!dateTime) {
    console.warn(`  Could not parse date from "${wanStr}" for ${eventUrl}`);
    return null;
  }

  // Title from <h1 class="entry-title">
  const titleMatch = html.match(/<h1\s+class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? decodeHtmlEntities(stripHtmlTags(titleMatch[1])) : venue;

  // Address from <div class="kino-adresse">
  const addrMatch = html.match(/<div\s+class="kino-adresse">([\s\S]*?)<\/div>/i);
  let address = "";
  if (addrMatch) {
    const addrText = stripHtmlTags(decodeHtmlEntities(addrMatch[1]));
    address = cleanAddress(addrText);
    // Clean up: remove leading venue name if it matches the venue (first line is sometimes the venue)
    // But we'll keep it as-is since it's the actual postal address
  }
  if (!address) {
    address = `${venue}, Berlin, DE`;
  }

  // Description: use meta content or first meaningful sentence
  const description = metaContent;

  // Get post ID from the article tag if not provided
  let finalPostId = postId;
  if (!finalPostId) {
    const postIdMatch = html.match(/<article\s+id="post-(\d+)"/i);
    if (postIdMatch) finalPostId = postIdMatch[1];
  }

  return { title, venue, date: dateTime.date, time: dateTime.time, address, description, postId: finalPostId };
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const now = new Date().toISOString();
  console.log("openair-kino.net scraper\n");

  // 1. Discover Berlin cinemas
  console.log("Step 1: Discovering Berlin cinemas...");
  const cinemaUrls = await fetchBerlinCinemaUrls();
  console.log(`  Found ${cinemaUrls.length} cinemas\n`);

  if (!cinemaUrls.length) {
    writeFileSync("data/venues-openair.json", "[]");
    console.log("No cinemas found. Done.");
    return;
  }

  // 2. For each cinema, discover events
  const allEvents: { eventUrl: string; postId: string; cinemaUrl: string }[] = [];
  for (const cinemaUrl of cinemaUrls) {
    const cinemaName = cinemaUrl.replace(/^.*\/category\/berlin\/[^/]+\//, "").replace(/\/$/, "");
    const events = await fetchCinemaEvents(cinemaUrl);
    if (events.length > 0) {
      console.log(`  ${cinemaName}: ${events.length} events`);
      for (const ev of events) {
        allEvents.push({ eventUrl: ev.url, postId: ev.postId, cinemaUrl });
      }
    } else {
      console.log(`  ${cinemaName}: no events (skipping)`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n  Total event URLs to scrape: ${allEvents.length}\n`);

  // 3. Scrape each event detail page
  console.log("Step 2: Scraping event details...");
  const cinemaEvents: CinemaEvent[] = [];
  let processed = 0;
  let skipped = 0;

  for (const { eventUrl, postId, cinemaUrl } of allEvents) {
    processed++;
    if (processed % 5 === 0) {
      process.stdout.write(`\r  Processing: ${processed}/${allEvents.length} (${cinemaEvents.length} valid, ${skipped} skipped)`);
    }

    const detail = await fetchEventDetail(eventUrl, postId);
    await new Promise((r) => setTimeout(r, 300));

    if (!detail) {
      skipped++;
      continue;
    }

    // Generate source_id
    const venueSlug = detail.venue
      .replace(/[^a-z0-9]/gi, "_")
      .replace(/_+/g, "_")
      .toLowerCase();
    const sourceId = `oa_${detail.postId}_${venueSlug}_${detail.date}_${detail.time.replace(":", "")}`;

    cinemaEvents.push({
      source: "openair",
      source_id: sourceId,
      title: detail.title,
      description: detail.description,
      start_datetime: `${detail.date}T${detail.time}:00+02:00`,
      end_datetime: "",
      venue_name: detail.venue,
      venue_address: detail.address,
      latitude: 0,
      longitude: 0,
      categories: ["film", "openair", "cinema"],
      event_url: eventUrl,
      ticket_url: "",
      image_url: "",
      language: "DE",
      release_date: "",
      last_updated: now,
    });
  }

  writeFileSync("data/venues-openair.json", JSON.stringify(cinemaEvents, null, 2));

  console.log(`\r  Processed: ${processed}/${allEvents.length} — ${cinemaEvents.length} valid events, ${skipped} skipped\n`);

  const venues = [...new Set(cinemaEvents.map((e) => e.venue_name))].sort();
  const dates = [...new Set(cinemaEvents.map((e) => e.start_datetime.slice(0, 10)))].sort();

  console.log(`  Venues: ${venues.length}`);
  for (const v of venues.slice(0, 10)) {
    const count = cinemaEvents.filter((e) => e.venue_name === v).length;
    console.log(`    ${v}: ${count}`);
  }
  if (venues.length > 10) console.log(`    ... and ${venues.length - 10} more`);

  console.log(`\n  Date range: ${dates[0] || "N/A"} to ${dates[dates.length - 1] || "N/A"}`);
  console.log(`  Total dates: ${dates.length}`);
  console.log(`\nDone → data/venues-openair.json`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
