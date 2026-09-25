"""Shared helpers for getlos syndication scripts (feeds + Telegram/Mastodon posters).

Berlin-only policy: the syndication surfaces (RSS, iCal, digest, posters) only
include venues inside the Berlin bounding box — the same box the dashboard uses
for its in-Berlin user check. The scraper data contains ~12 Brandenburg cinemas
(Neuruppin, Templin, Cottbus, Wust, ...) that are intentionally excluded here
until the pipeline itself gets a venue filter.
"""

# Berlin bounding box (matches dashboard's in-Berlin check)
BERLIN_BBOX = {"lat_min": 52.3, "lat_max": 52.7, "lng_min": 13.0, "lng_max": 13.8}


def is_berlin_venue(v) -> bool:
    lat, lng = v.get("lat"), v.get("lng")
    if lat is None or lng is None:
        return False
    return (
        BERLIN_BBOX["lat_min"] <= lat <= BERLIN_BBOX["lat_max"]
        and BERLIN_BBOX["lng_min"] <= lng <= BERLIN_BBOX["lng_max"]
    )


def berlin_only(venues):
    """Return (berlin_venues) and log excluded non-Berlin venues."""
    out, excluded = [], []
    for v in venues:
        (out if is_berlin_venue(v) else excluded).append(v)
    if excluded:
        print(
            f"[berlin-only] excluded {len(excluded)} non-Berlin venues: "
            + ", ".join(sorted(v["name"] for v in excluded))
        )
    return out
