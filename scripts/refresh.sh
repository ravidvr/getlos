#!/bin/bash
# getlos daily data refresh — run by cron at 9:00 Berlin time
# Pipeline → dashboard regeneration (scripts/generate_dashboard.py) → deploy

set -e
cd /Users/ruhvee/Documents/antigravityprojects/getlos

# Cron environments ship a minimal PATH — make node/npx/git resolvable
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

echo "=== $(date) ==="

echo "Pulling cinema data..."
npx tsx src/venues-berlincinema.ts 2>&1 | tail -3
npx tsx src/venues-englishcinema.ts 2>&1 | tail -3

echo "Processing..."
npx tsx src/venue-matcher.ts 2>&1 | tail -1
npx tsx src/event-dedup.ts 2>&1 | tail -1
npx tsx src/geocoder.ts 2>&1 | tail -1
npx tsx src/venues-final.ts 2>&1 | tail -1

echo "Regenerating dashboard..."
python3 scripts/generate_dashboard.py

echo "Verifying before deploy..."
python3 scripts/verify.py || { echo "VERIFY FAILED — not deploying"; exit 1; }

if git diff --quiet dashboard.html; then
    echo "No changes to deploy"
else
    echo "Deploying..."
    git add dashboard.html data/
    git commit -m "data: daily cinema refresh $(date +%Y-%m-%d)"
    git push origin main
    echo "Deployed!"
fi

echo "Done."
