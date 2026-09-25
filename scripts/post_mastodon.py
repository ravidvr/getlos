#!/usr/bin/env python3
"""Post the daily getlos digest to Mastodon (default: berlin.social).

Setup (one time):
  1. Create an account on https://berlin.social
  2. Preferences → Development → New application → name "getlos", scopes: write:statuses
  3. Copy the access token, then add it to the cron environment, e.g. in the
     LaunchAgent plist or a shell profile read by cron:
         export MASTODON_ACCESS_TOKEN=xxx
  4. Optional: MASTODON_BASE_URL=https://berlin.social (default)

Behaviour:
  - No token set → silent no-op (safe to call from refresh.sh).
  - Posts at most once per day (state file ~/.getlos_mastodon_last).
  - Only counts from the local screenings.json — nothing hardcoded.
"""
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

from getlos_common import berlin_only

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BERLIN = ZoneInfo("Europe/Berlin")
TOKEN = os.environ.get("MASTODON_ACCESS_TOKEN", "").strip()
API = (os.environ.get("MASTODON_BASE_URL", "https://berlin.social")).rstrip("/")
ORIG_LANGS = ("EN", "OV", "OmU", "OmenglU")
STATE = os.path.expanduser("~/.getlos_mastodon_last")


def main():
    if not TOKEN:
        print("MASTODON_ACCESS_TOKEN not set — skipping post")
        return
    today = datetime.now(BERLIN).strftime("%Y-%m-%d")
    try:
        if open(STATE).read().strip() == today:
            print("Already posted today — skipping")
            return
    except FileNotFoundError:
        pass

    with open(os.path.join(BASE, "screenings.json"), encoding="utf-8") as f:
        venues = berlin_only(json.load(f))

    ov_today = [e for v in venues for e in v["events"]
                if e.get("date") == today and (e.get("lang") or "") in ORIG_LANGS]
    ov_venues = {v["name"] for v in venues
                 if any(e.get("date") == today and (e.get("lang") or "") in ORIG_LANGS
                        for e in v["events"])}
    total = sum(len(v["events"]) for v in venues)

    status = (
        f"🎬 Heute in Berlin: {len(ov_today)} Vorstellungen in OV/OmU/EN "
        f"in {len(ov_venues)} Kinos. Alle {total} Spielzeiten dieser Woche auf einer Karte — "
        f"kostenlos, ohne Werbung und Tracking: https://ravidvr.github.io/getlos/ "
        f"☕ https://paypal.me/RaviDronamraju"
    )

    data = urllib.parse.urlencode({"status": status}).encode()
    req = urllib.request.Request(
        f"{API}/api/v1/statuses",
        data=data,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "getlos/1.0 (cinema digest)",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        out = json.loads(r.read())
    print("Posted:", out.get("url"))
    with open(STATE, "w") as f:
        f.write(today)


if __name__ == "__main__":
    main()
