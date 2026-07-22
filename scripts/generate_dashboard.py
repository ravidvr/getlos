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
            key = (hm.unescape(e['title']).lower(), norm(e['venue_name']), e.get('start_datetime', '')[11:16])
            lang_map[key] = e.get('language', 'DE')
    with open(BASE / 'data/venues-englishcinema.json') as f:
        for e in json.load(f):
            key = (hm.unescape(e['title']).lower(), norm(e['venue_name']), e.get('start_datetime', '')[11:16])
            lang_map[key] = 'EN'

    # ── Curated website map ──
    with open(BASE / 'data/venue-websites.json') as f:
        websites = json.load(f)

    # ── Venue format/character data ──
    with open(BASE / 'data/venue-formats.json') as f:
        fmt_data = json.load(f)

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

        # Merge format data or provide safe default
        vf = fmt_data.get(key, {
            "formats": [], "character": "small_cinema",
            "outdoor": False, "screen_size": "unknown",
            "last_verified": "auto"
        })
        venue_map[key]['formats'] = vf.get('formats', [])
        venue_map[key]['character'] = vf.get('character', 'small_cinema')
        venue_map[key]['outdoor'] = vf.get('outdoor', False)

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
            # Prefer the pipeline's own language field; legacy lang_map as fallback
            lang = e.get('language') or lang_map.get((hm.unescape(e['title']).lower(), key, time), 'DE')
            fmt = e.get('format', '')
            venue_map[key]['events'].append({
                'title': hm.unescape(e['title']), 'date': d, 'time': time,
                'ticket': e.get('ticket_url', ''), 'price': e.get('price', ''),
                'lang': lang, 'format': fmt,
            })

    # ── Dedupe events, drop empty venues, sort by date+time ──
    # Also purge events before today — dashboard only needs current+future
    result = []
    for v in venue_map.values():
        seen, uniq = set(), []
        for e in sorted(v['events'], key=lambda x: (x['date'], x['time'])):
            if e['date'] < today.isoformat():
                continue
            sig = (hm.unescape(e['title']), e['date'], e['time'], e['lang'])
            if sig not in seen:
                seen.add(sig)
                uniq.append(e)
        v['events'] = uniq
        if uniq:
            result.append(v)

    # ── Derive screen_size from actual event data ──
    for v in result:
        dates = set(e['date'] for e in v['events'])
        avg_per_day = len(v['events']) / max(len(dates), 1)
        if avg_per_day >= 8: v['screen_size'] = 'large'
        elif avg_per_day >= 3: v['screen_size'] = 'standard'
        elif avg_per_day > 0: v['screen_size'] = 'small'
        else: v['screen_size'] = 'unknown'

    # ── Dashboard output ──
    langs = Counter(e['lang'] for v in result for e in v['events'])
    fmts = Counter(e.get('format','') for v in result for e in v['events'] if e.get('format'))
    total = sum(len(v['events']) for v in result)
    dates = sorted({e['date'] for v in result for e in v['events']})
    with_web = sum(1 for v in result if v['website'])
    print(f"venues={len(result)} events={total} days={len(dates)} "
          f"websites={with_web}/{len(result)} langs={dict(langs)} formats={dict(fmts)}")

    # ── Derive screen_size from actual event data ──
    for v in result:
        dates = set(e['date'] for e in v['events'])
        avg_per_day = len(v['events']) / max(len(dates), 1)
        if avg_per_day >= 8: v['screen_size'] = 'large'
        elif avg_per_day >= 3: v['screen_size'] = 'standard'
        elif avg_per_day > 0: v['screen_size'] = 'small'
        else: v['screen_size'] = 'unknown'

    # ── Write data file ──
    js = 'var ALL_VENUES = ' + json.dumps(result, ensure_ascii=False) + ';'
    (BASE / 'data/all_venues.js').write_text(js)

    # ── Refresh dashboard.html in place ──
    html = (BASE / 'dashboard.html').read_text()
    if dates:
        html = re.sub(r'value="\d{4}-\d{2}-\d{2}"', f'value="{dates[0]}"', html, count=1)
        html = re.sub(r'min="\d{4}-\d{2}-\d{2}"', f'min="{dates[0]}"', html, count=1)
        html = re.sub(r'max="\d{4}-\d{2}-\d{2}"', f'max="{dates[-1]}"', html, count=1)
    stamp = datetime.now().astimezone().isoformat(timespec='minutes')
    html = re.sub(r"const LAST_UPDATED = '[^']*';", f"const LAST_UPDATED = '{stamp}';", html, count=1)
    html = re.sub(r"const LAST_UPDATED = new Date\(\)[^;]*;", f"const LAST_UPDATED = '{stamp}';", html, count=1)
    html = re.sub(r"const COVERAGE = '[^']*';", f"const COVERAGE = '{with_web}/{len(result)} cinemas have websites';", html, count=1)
    # NOTE: const TODAY is intentionally NOT baked — the browser computes the
    # visitor's local date so the page stays correct between cron runs.
    html = re.sub(r'<script>\s*const ALL_VENUES.*?</script>', f'<script>\n{js}\n</script>', html, flags=re.DOTALL)
    (BASE / 'dashboard.html').write_text(html)
    print(f"dashboard.html={len(html)} bytes updated={stamp}")

    # Also write standalone data file for lazy loading
    with open(BASE / 'data/latest.json', 'w') as f:
        json.dump(result, f, ensure_ascii=False)
    print(f"data/latest.json={len(result)} venues, {total} events")


if __name__ == '__main__':
    main()
