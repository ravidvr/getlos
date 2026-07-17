#!/usr/bin/env python3
"""getlos — single source of truth for dashboard data generation.

Reads:  data/venues-combined.json   (pipeline output)
        data/venues-berlincinema.json, data/venues-englishcinema.json (language lookup)
        data/venue-websites.json    (curated website map — OSM + manual)
Writes: data/all_venues.js          (embedded dataset)
        dashboard.html              (data + date picker + timestamps refreshed in place)

Run after the pipeline. Called by scripts/refresh.sh (daily cron) or by hand.
"""
import json
import re
import html as hm
from datetime import date, datetime, timedelta
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
WINDOW_DAYS = 7


def norm(name: str) -> str:
    """Entity-decoded, lowercased venue key."""
    return hm.unescape(name).lower().strip()


def main() -> None:
    today = date.today()

    # ── Language lookup from source files (dedup drops the field) ──
    lang_map = {}
    with open(BASE / 'data/venues-berlincinema.json') as f:
        for e in json.load(f):
            key = (e['title'].lower(), norm(e['venue_name']), e.get('start_datetime', '')[11:16])
            lang_map[key] = e.get('language', 'DE')
    with open(BASE / 'data/venues-englishcinema.json') as f:
        for e in json.load(f):
            key = (e['title'].lower(), norm(e['venue_name']), e.get('start_datetime', '')[11:16])
            lang_map[key] = 'EN'

    # ── Curated website map ──
    with open(BASE / 'data/venue-websites.json') as f:
        websites = json.load(f)

    # ── Venues + events (entity-decoded keys merge duplicate venues) ──
    with open(BASE / 'data/venues-combined.json') as f:
        venues = json.load(f)

    venue_map = {}
    for v in venues:
        if not v.get('latitude') or not v.get('longitude'):
            continue
        key = norm(v['name'])
        if key not in venue_map:
            venue_map[key] = {
                'name': hm.unescape(v['name']),
                'lat': v['latitude'], 'lng': v['longitude'],
                'amenity': v.get('amenity', ''),
                'address': v.get('address', ''),
                'website': v.get('website', '') or websites.get(key, ''),
                'categories': v.get('categories', [])[:3],
                'events': [],
            }
        elif not venue_map[key]['website'] and v.get('website'):
            venue_map[key]['website'] = v['website']

        for e in v.get('events', []):  # NO per-venue cap
            d = e.get('date', '')[:10]
            if not d:
                continue
            try:
                ed = date.fromisoformat(d)
            except ValueError:
                continue
            if ed < today or ed >= today + timedelta(days=WINDOW_DAYS):
                continue
            time = e['date'][11:16] if len(e.get('date', '')) >= 16 else ''
            lang = lang_map.get((e['title'].lower(), key, time), 'DE')
            venue_map[key]['events'].append({
                'title': e['title'], 'date': d, 'time': time,
                'ticket': e.get('ticket_url', ''), 'price': e.get('price', ''),
                'lang': lang,
            })

    # ── Dedupe events, drop empty venues, sort by date+time ──
    result = []
    for v in venue_map.values():
        seen, uniq = set(), []
        for e in sorted(v['events'], key=lambda x: (x['date'], x['time'])):
            sig = (e['title'], e['date'], e['time'], e['lang'])
            if sig not in seen:
                seen.add(sig)
                uniq.append(e)
        v['events'] = uniq
        if uniq:
            result.append(v)

    # ── Stats ──
    langs = Counter(e['lang'] for v in result for e in v['events'])
    total = sum(len(v['events']) for v in result)
    dates = sorted({e['date'] for v in result for e in v['events']})
    with_web = sum(1 for v in result if v['website'])
    print(f"venues={len(result)} events={total} days={len(dates)} "
          f"websites={with_web}/{len(result)} langs={dict(langs)}")

    # ── Write data file ──
    js = 'const ALL_VENUES = ' + json.dumps(result, ensure_ascii=False) + ';'
    (BASE / 'data/all_venues.js').write_text(js)

    # ── Refresh dashboard.html in place ──
    html = (BASE / 'dashboard.html').read_text()
    if dates:
        html = re.sub(r'value="\d{4}-\d{2}-\d{2}"', f'value="{dates[0]}"', html, count=1)
        html = re.sub(r'min="\d{4}-\d{2}-\d{2}"', f'min="{dates[0]}"', html, count=1)
        html = re.sub(r'max="\d{4}-\d{2}-\d{2}"', f'max="{dates[-1]}"', html, count=1)
    html = re.sub(r"const TODAY = '[^']*';", f"const TODAY = '{today.isoformat()}';", html, count=1)
    html = re.sub(r"const TODAY = new Date\(\)[^;]*;", f"const TODAY = '{today.isoformat()}';", html, count=1)
    stamp = datetime.now().astimezone().isoformat(timespec='minutes')
    html = re.sub(r"const LAST_UPDATED = '[^']*';", f"const LAST_UPDATED = '{stamp}';", html, count=1)
    html = re.sub(r"const LAST_UPDATED = new Date\(\)[^;]*;", f"const LAST_UPDATED = '{stamp}';", html, count=1)
    html = re.sub(r'<script>\s*const ALL_VENUES.*?</script>', f'<script>\n{js}\n</script>', html, flags=re.DOTALL)
    (BASE / 'dashboard.html').write_text(html)
    print(f"dashboard.html={len(html)} bytes updated={stamp}")


if __name__ == '__main__':
    main()
