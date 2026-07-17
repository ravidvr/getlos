# getlos — Berlin Cinema Map

**Every movie screening in Berlin on one map** — all languages, all cinemas, updated daily.

**[🎬 Open the map →](https://ravidvr.github.io/getlos/dashboard.html)**

No app, no account, no cookies, no tracking. Just a map.

---

## For moviegoers

**Find a film.** Type a movie name into the search box — autocomplete suggests titles as you type. The map instantly shows where it's playing:

- 🟢 **Green pin** — this cinema has an upcoming screening you can still catch
- 🔴 **Red pin** — screenings here already started or ran
- 🟡 **Yellow pin** — default view, every cinema with showtimes

**Check the schedule.** Click any pin: full showtimes with green (upcoming) / red (past) times, ticket prices where available, the language of each screening, and a direct link to the cinema's website for booking. When you've searched a movie, the popup also tells you *"Next screening in 2h 15m"*.

**Filter by language.** Berlin screens films in German (DE), original English (EN), and original versions with subtitles (OV/OmU) — one click filters the whole map.

**Plan ahead.** Today / Tomorrow buttons or the date picker show any day up to a week out.

**Find cinemas near you.** Allow location access and every popup shows distance and walking time. You can also search any address to zoom there.

**Deutsch oder Englisch?** The DE/EN button (top right) switches the entire interface.

## What's on the map

| | |
|---|---|
| Cinemas | ~85 across Berlin, every one geolocated with a website link |
| Screenings | ~1,900 across the next 6 days |
| Languages | DE (dubbed), EN (original), OV/OmU (original w/ subtitles) |
| Refresh | Daily at 09:00 Berlin time, automatically |

## Data sources

All data comes from legal, public sources — facts (titles, times, places) are not copyrightable:

| Source | Provides |
|--------|----------|
| [berlin.de/kino](https://www.berlin.de/kino/) | All currently playing films, ~80 cinemas, 6 days of showtimes with language tags |
| [English Cinema Berlin](https://englishcinemaberlin.com/7-day-overview) | English-language screenings across ~40 cinemas |
| [OpenStreetMap](https://www.openstreetmap.org/) | Venue coordinates and websites |
| `data/venue-websites.json` | Hand-curated website links where OSM has none |

---

## For developers

The whole product is **one self-contained HTML file** (~260 KB, data embedded) built by a TypeScript pipeline and deployed on GitHub Pages. No server, no database, no API keys.

### Pipeline

```
src/venues-osm.ts            OSM venue base (456 Berlin venues)
src/venues-berlincinema.ts   berlin.de film pages → showtimes, languages, release dates
src/venues-englishcinema.ts  English Cinema Berlin 7-day grid
src/venue-matcher.ts         fuzzy venue↔OSM matching (Fuse.js + data/venue-aliases.json)
src/event-dedup.ts           merge duplicates by title+date+venue
src/geocoder.ts              Nominatim geocoding, cached, 1 req/s
src/venues-final.ts          → data/venues-combined.json + events-combined.json
scripts/generate_dashboard.py  builds data/all_venues.js, embeds into dashboard.html
scripts/verify.py            15-check deploy gate (parser corruption, dupes,
                             website coverage, JS syntax) — blocks bad deploys
scripts/refresh.sh           daily cron: pipeline → generate → verify → git push
```

### Run it

```bash
git clone https://github.com/ravidvr/getlos && cd getlos
npm install
npm run pipeline                      # ~3 min (rate-limited fetches)
python3 scripts/generate_dashboard.py
python3 scripts/verify.py             # 15 invariant checks
open dashboard.html
```

Generated JSON stays out of git; the two curated inputs (`data/venue-aliases.json`,
`data/venue-websites.json`) are tracked.

### Stack

TypeScript (tsx) · Leaflet 1.9 · Nominatim · Fuse.js · vanilla JS · GitHub Pages

## Contact & legal

Questions, corrections, a cinema we're missing? [Open an issue](https://github.com/ravidvr/getlos/issues) or use the contact form in the map's ℹ️ About overlay (includes Impressum).

[MIT License](LICENSE)
