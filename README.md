# getlos — Berlin Cinema Map

Every movie screening in Berlin on one map — all languages, all cinemas, updated daily.

**[→ Open the map](https://ravidvr.github.io/getlos/dashboard.html)**

## Features

- **~85 cinemas** with a week of showtimes (~1,900 screenings), all geolocated
- **Language filters:** DE (dubbed) · EN (original English) · OV/OmU (original with subtitles)
- **Movie search** with local autocomplete — markers turn **green** (upcoming screening) or **red** (already ran); default markers are **yellow**
- **Click a marker** for the full schedule: color-coded times, prices, language tags, distance + walk time, and a link to the cinema's website
- **Date controls:** Today / Tomorrow presets + free date picker
- **Next-screening countdown** when searching ("Next screening in 1d 4h")
- **DE/EN interface toggle**, first-visit explainer, About + Impressum + contact form
- Light theme, mobile responsive, no tracking, no cookies, no API keys

## Data Sources

| Source | What it provides | Refresh |
|--------|-----------------|---------|
| [berlin.de/kino](https://www.berlin.de/kino/) | All currently playing films, ~80 cinemas, 6 days of showtimes, language tags | daily |
| [English Cinema Berlin](https://englishcinemaberlin.com/7-day-overview) | English-language screenings, ~40 cinemas, 7 days | daily |
| [OpenStreetMap](https://www.openstreetmap.org/) | Venue coordinates + websites | static |
| `data/venue-websites.json` | Curated website map for venues OSM misses | manual |

## Architecture

```
src/venues-osm.ts            OSM venue base (456 venues)
src/venues-berlincinema.ts   berlin.de film pages → showtimes + languages + release dates
src/venues-englishcinema.ts  English Cinema Berlin 7-day grid
src/venue-matcher.ts         fuzzy-match event venues to OSM (Fuse.js + aliases)
src/event-dedup.ts           merge duplicates by title+date+venue
src/geocoder.ts              Nominatim geocoding for unmatched venues (cached)
src/venues-final.ts          combine into venues-combined.json / events-combined.json
scripts/generate_dashboard.py  single source of truth: builds data/all_venues.js
                               and embeds it into dashboard.html
scripts/refresh.sh           daily cron entry point (pipeline → generate → git push)
```

Run everything: `npm run pipeline && python3 scripts/generate_dashboard.py`

`dashboard.html` is fully self-contained (~260 KB) — no server, no database.

## Deployment

GitHub Pages, refreshed daily at 9:00 Berlin time by a cron job that re-runs the
pipeline and pushes only when data changed.

## Tech

TypeScript (tsx) · Leaflet · Nominatim · Fuse.js · vanilla JS dashboard

## License

[MIT](LICENSE)
