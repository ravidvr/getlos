// Phase: Rausgegangen JSON-LD fetcher
// Fetches Berlin events from rausgegangen.de public pages
// Two-step: (1) get event URLs from city listing, (2) get details from each event page

import { writeFileSync } from "fs";

const RG_BASE = "https://rausgegangen.de";
const RG_BERLIN = `${RG_BASE}/en/berlin/`;

interface RGEvent {
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
  price: string;
  last_updated: string;
}

function extractJsonLd(html: string, targetType: string): any | null {
  const matches = html.match(
    /<script type="application\/ld\+json">(.*?)<\/script>/gs
  );
  if (!matches) return null;
  for (const match of matches) {
    const json = match
      .replace('<script type="application/ld+json">', "")
      .replace("</script>", "");
    try {
      const data = JSON.parse(json);
      if (data["@type"] === targetType) return data;
    } catch {}
  }
  return null;
}

async function fetchEventUrls(pageUrl: string): Promise<string[]> {
  const resp = await fetch(pageUrl, {
    headers: { "User-Agent": "getlos/0.1.0 (Berlin events map)" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();

  const data = extractJsonLd(html, "ItemList");
  if (!data) return [];
  const items = data.itemListElement || [];
  return items.map((item: any) => item.url).filter(Boolean);
}

async function fetchEventDetail(url: string): Promise<RGEvent | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "getlos/0.1.0 (Berlin events map)" },
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    const e = extractJsonLd(html, "Event");
    if (!e) return null;

    const loc = e.location || {};
    const addr = loc.address || {};

    return {
      source: "rausgegangen",
      source_id: url.split("/events/")[1]?.replace(/\/$/, "") || url,
      title: e.name || "Untitled",
      description: (e.description || "").replace(/\\n/g, " ").trim(),
      start_datetime: e.startDate || "",
      end_datetime: e.endDate || "",
      venue_name: loc.name || "Unknown",
      venue_address: addr.streetAddress
        ? `${addr.streetAddress}, ${addr.postalCode || ""} ${addr.addressLocality || "Berlin"}, ${addr.addressCountry || "DE"}`
        : "",
      latitude: 0,
      longitude: 0,
      categories: e.keywords || [],
      event_url: url,
      ticket_url: e.offers?.url || "",
      image_url: Array.isArray(e.image) ? e.image[0] : e.image || "",
      price: e.offers?.price
        ? `${e.offers.price} ${e.offers.priceCurrency || "EUR"}`
        : "",
      last_updated: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function main() {
  console.log("Fetching Rausgegangen Berlin events (JSON-LD)...\n");

  // Step 1: Get event URLs from listing pages
  const allUrls: string[] = [];
  for (let page = 1; page <= 5; page++) {
    const url = page === 1 ? RG_BERLIN : `${RG_BERLIN}page/${page}/`;
    process.stdout.write(`  Listing page ${page}: `);
    try {
      const urls = await fetchEventUrls(url);
      if (urls.length === 0) {
        console.log("no events");
        break;
      }
      allUrls.push(...urls);
      console.log(`${urls.length} URLs`);
    } catch (err: any) {
      console.log(`✗ ${err.message}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n  Total event URLs: ${allUrls.length}`);

  // Step 2: Fetch each event detail page
  const events: RGEvent[] = [];
  let fetched = 0;
  let failed = 0;

  for (const url of allUrls) {
    fetched++;
    if (fetched % 5 === 0) {
      process.stdout.write(`\r  Fetching: ${fetched}/${allUrls.length}`);
    }
    const event = await fetchEventDetail(url);
    if (event) {
      events.push(event);
    } else {
      failed++;
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  writeFileSync("data/venues-rausgegangen.json", JSON.stringify(events, null, 2));

  console.log(`\r  Fetched: ${fetched}/${allUrls.length} — ${events.length} events, ${failed} failed`);
  console.log(`\nDone → data/venues-rausgegangen.json`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
