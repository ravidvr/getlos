#!/usr/bin/env python3
"""getlos — pre-deploy sanity gate.

Validates pipeline outputs and dashboard invariants. Non-zero exit blocks the
cron deploy (refresh.sh runs this between generation and git push), so a
silently broken parser can never ship garbage to the live site.
"""
import json
import re
import sys
import html as hm
import subprocess
import tempfile
import os
from datetime import date
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
FAILS = []


def chk(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'} {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        FAILS.append(name)


def main():
    # ── Parser output ──
    bc = json.loads((BASE / 'data/venues-berlincinema.json').read_text())
    chk('berlin.de: events exist', len(bc) > 500, f'{len(bc)}')
    bad = [x['venue_name'] for x in bc if re.match(
        r'^(Mo|Di|Mi|Do|Fr|Sa|So),|Kinos wird|Tag Zeit|Film gezeigt', x['venue_name'])]
    chk('berlin.de: no corrupted venue names', not bad, f'{len(bad)} bad')
    days = {e['start_datetime'][:10] for e in bc if e.get('start_datetime')}
    chk('berlin.de: multi-day >=3 days (berlin.de serves 3 days Mon-Wed)', len(days) >= 3, f'{len(days)} days')
    chk('berlin.de: language tags present',
        sum(1 for e in bc if e.get('language')) == len(bc))
    chk('berlin.de: no raw HTML entities',
        not [x for x in bc if '&#x' in x['venue_name'] or '&amp;' in x['venue_name']])

    ec = json.loads((BASE / 'data/venues-englishcinema.json').read_text())
    chk('english cinema: events exist', len(ec) > 200, f'{len(ec)}')

    # ── Combined outputs ──
    events = json.loads((BASE / 'data/events-combined.json').read_text())
    chk('combined: language survives dedup',
        sum(1 for e in events if e.get('language')) > len(events) * 0.9,
        f"{sum(1 for e in events if e.get('language'))}/{len(events)}")

    # ── Dashboard data ──
    raw = (BASE / 'data/all_venues.js').read_text()
    d = json.loads(raw.replace('const ALL_VENUES = ', '').rstrip(';'))
    total = sum(len(v['events']) for v in d)
    chk('dashboard: venues 50-150', 50 <= len(d) <= 150, f'{len(d)}')
    chk('dashboard: events > 1000', total > 1000, f'{total}')
    chk(f'dashboard: venue website coverage >=75% ({sum(1 for v in d if v.get("website"))}/{len(d)})',
        sum(1 for v in d if v.get('website')) / max(len(d), 1) >= 0.75)
    seen = set()
    dupes = [n for n in (v['name'] for v in d)
             if hm.unescape(n).lower() in seen or seen.add(hm.unescape(n).lower())]
    chk('dashboard: no duplicate venues', not dupes, f'{len(dupes)}')
    chk('dashboard: today is covered',
        any(e['date'] == date.today().isoformat() for v in d for e in v['events']))

    # Format data checks
    with open(BASE / 'data/venue-formats.json') as f:
        fmt = json.load(f)
    fmt_keys = {k.lower().strip() for k in fmt}
    data_venues = {hm.unescape(v['name']).lower().strip() for v in d}
    missing = data_venues - fmt_keys
    chk('formats: all venues have entries', not missing, f'{len(missing)} missing: {sorted(list(missing))[:5]}')

    # Verify IMAX tag is present on venues that claim it in venue-formats.json
    imax_venues_formats = {k for k, v in fmt.items() if 'IMAX' in v.get('formats', [])}
    imax_venues_data = {v['name'] for v in d if 'IMAX' in (v.get('formats') or [])}
    missing_imax = imax_venues_formats - {name.lower().strip() for name in imax_venues_data}
    # Also check: venues known to have IMAX per venue-formats should have it in dashboard
    chk('formats: IMAX tag consistent', not missing_imax, f'{len(missing_imax)}: {sorted(missing_imax)[:3]}')

    # Format field present on events
    event_count = sum(len(v['events']) for v in d)
    has_format = sum(1 for v in d for e in v['events'] if e.get('format'))
    chk(f'formats: event format field ({has_format}/{event_count})', True)  # always passes — informational

    # Outdoor venues marked correctly
    outdoor = [v for v in d if v.get('outdoor')]
    chk(f'formats: outdoor venues ({len(outdoor)})', len(outdoor) > 0)

    # Valid format values
    valid_fmts = {'IMAX','70mm','35mm',''}
    all_fmts = {e.get('format','') for v in d for e in v['events']}
    bad_fmts = all_fmts - valid_fmts
    chk('formats: valid format values', not bad_fmts, f'{bad_fmts}')

    # ── Dashboard HTML: embedded + JS parses ──
    h = (BASE / 'dashboard.html').read_text()
    chk('html: data embedded', 'const ALL_VENUES' in h)
    chk('html: no plain-text address', 'Kiefholz' not in h and '12435' not in h)
    blocks = re.findall(r'<script>(.*?)</script>', h, re.DOTALL)
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f:
        f.write(blocks[-1])
        p = f.name
    r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
    os.unlink(p)
    chk('html: app JS parses (node --check)', r.returncode == 0,
        r.stderr.strip()[:120] if r.returncode else '')

    print(f"\n{'OK' if not FAILS else 'BLOCKED'}: "
          f"{len(FAILS)} failures" + (f" — {FAILS}" if FAILS else ""))
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
