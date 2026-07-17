#!/bin/bash
# getlos daily data refresh
# Run by cron — regenerates cinema data and deploys

set -e
cd /Users/ruhvee/Documents/antigravityprojects/getlos

echo "=== $(date) ==="

# 1. Run pipeline
echo "Pulling cinema data..."
npx tsx src/venues-berlincinema.ts 2>&1 | tail -3
npx tsx src/venues-englishcinema.ts 2>&1 | tail -3

echo "Processing..."
npx tsx src/venue-matcher.ts 2>&1 | tail -1
npx tsx src/event-dedup.ts 2>&1 | tail -1
npx tsx src/geocoder.ts 2>&1 | tail -1
npx tsx src/venues-final.ts 2>&1

# 2. Regenerate dashboard data with language tags
python3 << 'PYEOF'
import json, re
from pathlib import Path
from datetime import date, timedelta
from collections import Counter

base = Path('/Users/ruhvee/Documents/antigravityprojects/getlos')

with open(base / 'data/venues-berlincinema.json') as f: bc = json.load(f)
with open(base / 'data/venues-englishcinema.json') as f: ec = json.load(f)

lang_map = {}
for e in bc:
    key = (e['title'].lower(), e['venue_name'].lower(), e.get('start_datetime','')[11:16])
    lang_map[key] = e.get('language', 'DE')
for e in ec:
    key = (e['title'].lower(), e['venue_name'].lower(), e.get('start_datetime','')[11:16])
    lang_map[key] = 'EN'

with open(base / 'data/venues-combined.json') as f: venues = json.load(f)

today = date.today()
venue_map = {}
for v in venues:
    if not v.get('latitude') or not v.get('longitude'): continue
    key = v['name'].lower().strip()
    if key not in venue_map:
        venue_map[key] = {'name':v['name'],'lat':v['latitude'],'lng':v['longitude'],
            'amenity':v.get('amenity',''),'address':v.get('address',''),
            'categories':v.get('categories',[])[:3],'events':[]}
    for e in v.get('events',[])[:20]:
        d = e.get('date','')[:10]
        if not d: continue
        try:
            ed = date.fromisoformat(d)
            if ed < today or ed >= today+timedelta(days=7): continue
        except: continue
        time = e['date'][11:16] if len(e.get('date',''))>=16 else ''
        lk = (e['title'].lower(), v['name'].lower(), time)
        lang = lang_map.get(lk, 'DE')
        venue_map[key]['events'].append({'title':e['title'],'date':d,'time':time,
            'ticket':e.get('ticket_url',''),'price':e.get('price',''),'lang':lang})

result = []
for v in venue_map.values():
    seen=set();uniq=[]
    for e in v['events']:
        s=(e['title'],e['date'],e['time'],e['lang'])
        if s not in seen: seen.add(s);uniq.append(e)
    v['events']=uniq
    if uniq: result.append(v)

langs = Counter()
for v in result:
    for e in v['events']: langs[e['lang']]+=1
print(f"Cinema: {len(result)} venues, {sum(len(v['events']) for v in result)} screenings, langs={dict(langs)}")

js = 'const ALL_VENUES = ' + json.dumps(result, ensure_ascii=False) + ';'
(base / 'data/all_venues.js').write_text(js)

# Embed into dashboard
html = (base / 'dashboard.html').read_text()
html = re.sub(r'<script>\s*const ALL_VENUES.*?</script>', f'<script>\n{js}\n</script>', html, flags=re.DOTALL)

# Update the date picker range if needed
dates = sorted(set(e['date'] for v in result for e in v['events']))
if dates:
    min_d = min(dates)
    max_d = max(dates)
    html = re.sub(r'value="\d{4}-\d{2}-\d{2}"', f'value="{min_d}"', html, count=1)
    html = re.sub(r'min="\d{4}-\d{2}-\d{2}"', f'min="{min_d}"', html, count=1)
    html = re.sub(r'max="\d{4}-\d{2}-\d{2}"', f'max="{max_d}"', html, count=1)

(base / 'dashboard.html').write_text(html)
print(f"Dashboard: {len(html)} bytes")
PYEOF

# 3. Deploy if changed
if git diff --quiet dashboard.html; then
    echo "No changes to deploy"
else
    echo "Deploying updates..."
    git add dashboard.html data/
    git commit -m "data: daily cinema refresh $(date +%Y-%m-%d)"
    git push origin main
    echo "Deployed!"
fi

echo "Done."
