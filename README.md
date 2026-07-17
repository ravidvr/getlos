# getlos — Berlin Cinema Map

A comprehensive map of every movie screening in Berlin — all languages, all cinemas, updated daily.

**[→ Open the map](https://ravidvr.github.io/getlos/dashboard.html)**

## Features

- **100 cinemas** across Berlin, all with coordinates
- **~800 screenings** per day from 27+ currently playing films
- **Language filters:** DE (dubbed), EN (original English), OV/OmU (subtitled)
- **Movie search:** type any film name to find where it's playing
- **Date picker:** browse any day's schedule, Today/Tomorrow/Weekend presets
- **Your location:** auto-detected with distance + walk time to every cinema
- **DE/EN toggle:** full bilingual interface (Deutsch/English)
- **Light theme, mobile responsive, no tracking, no cookies**

## Data Sources

| Source | Coverage | Update |
|--------|----------|--------|
| [berlin.de/kino](https://www.berlin.de/kino/) | 27 films, 87 cinemas, all languages | Daily |
| [English Cinema Berlin](https://englishcinemaberlin.com/7-day-overview) | 62 films, 40 cinemas, English only | Daily |
| [OpenStreetMap](https://www.openstreetmap.org/) | Venue coordinates | Static |

## Pipeline

```
npm run pipeline
```

Runs 6 stages: OSM venues → cinema data fetch → venue matching → event dedup → geocoding → final combine.

Outputs:
- `data/venues-combined.json` — all venues with events and coordinates
- `data/events-combined.json` — all events with sources and metadata

The dashboard (`dashboard.html`) is a single self-contained HTML file with embedded data. No server, no API keys, no database.

## Deployment

Deployed via GitHub Pages at [ravidvr.github.io/getlos/](https://ravidvr.github.io/getlos/dashboard.html).

Auto-refreshes daily at 9:00 AM Berlin time via a cron job that runs the full pipeline and pushes to main.

## Tech Stack

- **TypeScript** pipeline with `tsx` runtime
- **Leaflet** for the map
- **Nominatim** (OpenStreetMap) for geocoding
- **Fuse.js** for fuzzy venue matching
- **node-ical** + **fast-xml-parser** for feed parsing

## License

MIT
