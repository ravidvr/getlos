#!/bin/bash
cd /Users/ruhvee/Documents/antigravityprojects/getlos
# Cron environments ship a minimal PATH — make npm/python/git resolvable
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
python3 -c "
import json, urllib.request, sys, re, time
from datetime import date

errors = []

try:
    resp = urllib.request.urlopen(f'https://ravidvr.github.io/getlos/screenings.json?v={int(time.time())}')
    data = json.load(resp)
    venues = len(data)
    events = sum(len(v['events']) for v in data)
    dates = sorted(set(e['date'] for v in data for e in v['events']))
    if venues < 50: errors.append(f'Only {venues} venues')
    if events < 1000: errors.append(f'Only {events} events')
    if len(dates) < 3: errors.append(f'Only {len(dates)} days of data')
    print(f'✓ {venues} venues, {events} events, {len(dates)} days ({dates[0]} to {dates[-1]})')
except Exception as e:
    errors.append(f'screenings.json: {e}')

try:
    resp = urllib.request.urlopen(f'https://ravidvr.github.io/getlos/dashboard.html?v={int(time.time())}')
    html = resp.read().decode()
    if 'ALL_VENUES' not in html:
        errors.append('Dashboard missing ALL_VENUES data')
    else:
        print('✓ Dashboard loads with data')
    # Freshness assertion (Sep 2026): the 09:00 refresh must have deployed
    # TODAY — validating yesterday's site against live thresholds used to
    # give a false green while the dashboard sat stale.
    m = re.search('const LAST_UPDATED = .([0-9T:+-]+).', html)
    if not m:
        errors.append('LAST_UPDATED not found in live dashboard')
    elif m.group(1)[:10] != date.today().isoformat():
        errors.append(f'Live dashboard stale: LAST_UPDATED {m.group(1)} — not today ({date.today().isoformat()})')
    else:
        print(f'✓ Live data is from today (LAST_UPDATED {m.group(1)})')
except Exception as e:
    errors.append(f'dashboard.html: {e}')

import subprocess
result = subprocess.run(['python3', 'scripts/verify.py'], capture_output=True, text=True)
if result.returncode != 0 or 'BLOCKED' in result.stdout or 'BLOCKED' in result.stderr:
    errors.append('verify.py: pipeline checks failed')
else:
    print('✓ verify.py passes')

result = subprocess.run(['npm', 'test'], capture_output=True, text=True)
if result.returncode != 0:
    errors.append('unit tests failed')
else:
    print('✓ unit tests pass')

if errors:
    print(f'\\n❌ VALIDATION FAILED ({len(errors)} issues):')
    for e in errors: print(f'  - {e}')
    sys.exit(1)
else:
    print(f'\\n✅ All checks pass — {date.today().isoformat()}')
"
