#!/usr/bin/env python3
"""Generate getlos syndication artifacts from screenings.json:
  - rss.xml            OV/OmU/EN screenings feed (rolling 7-day window)
  - ical/<slug>.ics    per-cinema calendar export
  - ical/index.html    directory of per-cinema calendar links
  - digest.html        weekly "This week in Berlin cinema" digest page

Run AFTER scripts/generate_dashboard.py (reads its screenings.json output).
Every number on these pages is derived from screenings.json — nothing hardcoded.
"""
import hashlib
import html
import json
import os
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from getlos_common import berlin_only

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BERLIN = ZoneInfo("Europe/Berlin")
SITE = "https://ravidvr.github.io/getlos/"
DASH = SITE + "dashboard.html"
COFFEE = "https://paypal.me/RaviDronamraju"
ORIG_LANGS = ("EN", "OV", "OmU", "OmenglU")


def esc(s: str) -> str:
    return html.escape(s or "", quote=False)


def ics_text(s) -> str:
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def slugify(name: str) -> str:
    n = name.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        n = n.replace(a, b)
    n = re.sub(r"[^a-z0-9]+", "-", n).strip("-")
    return n or "kino"


def load():
    with open(os.path.join(BASE, "screenings.json"), encoding="utf-8") as f:
        return json.load(f)


def merge_venues(venues):
    """Merge venues that slugify identically (same cinema, name variants like
    'Delphi Filmpalast' / 'Delphi-Filmpalast'): one calendar, deduped events."""
    by_slug, order = {}, []
    for v in venues:
        s = slugify(v["name"])
        if s in by_slug:
            base = by_slug[s]
            base["events"] = base["events"] + v["events"]
            if not base.get("address") and v.get("address"):
                base["address"] = v["address"]
            if not base.get("website") and v.get("website"):
                base["website"] = v["website"]
        else:
            by_slug[s] = dict(v)
            order.append(s)
    for s in order:
        seen, uniq = set(), []
        for e in by_slug[s]["events"]:
            k = (e.get("date"), e.get("time"), e.get("title"))
            if k not in seen:
                seen.add(k)
                uniq.append(e)
        by_slug[s]["events"] = uniq
    return [by_slug[s] for s in order]


def event_dt(ev):
    return datetime.strptime(f"{ev['date']} {ev.get('time', '00:00')}", "%Y-%m-%d %H:%M").replace(tzinfo=BERLIN)


def event_key(v, ev) -> str:
    raw = f"{v['name']}|{ev.get('date')}|{ev.get('time')}|{ev.get('title')}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()[:16]


def rfc822(dt) -> str:
    return dt.strftime("%a, %d %b %Y %H:%M:%S %z")


# ── RSS ──────────────────────────────────────────────────────────────────
def build_rss(venues):
    rows = []
    for v in venues:
        for e in v["events"]:
            if (e.get("lang") or "") in ORIG_LANGS:
                rows.append((v, e))
    rows.sort(key=lambda x: event_dt(x[1]))
    items = []
    for v, e in rows:
        dt = event_dt(e)
        title = f"{e['title']} ({e['lang']} · {v['name']} · {dt:%a %d.%m %H:%M})"
        desc = f"{e['lang']} screening at {v['name']}"
        if v.get("address"):
            desc += f", {v['address']}"
        if e.get("price"):
            desc += f" · {e['price']}"
        items.append(
            "    <item>\n"
            f"      <title>{esc(title)}</title>\n"
            f"      <link>{esc(v.get('website') or DASH)}</link>\n"
            f"      <guid isPermaLink=\"false\">getlos-{event_key(v, e)}</guid>\n"
            f"      <pubDate>{rfc822(dt)}</pubDate>\n"
            f"      <description>{esc(desc)}</description>\n"
            "    </item>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0">\n'
        "  <channel>\n"
        "    <title>getlos — Berlin cinema in OV/OmU/EN</title>\n"
        f"    <link>{DASH}</link>\n"
        "    <description>Original-language movie screenings in Berlin for the next 7 days, from public data. Free, no ads, no tracking.</description>\n"
        "    <language>de</language>\n"
        f"    <lastBuildDate>{rfc822(datetime.now(BERLIN))}</lastBuildDate>\n"
        + "\n".join(items)
        + "\n  </channel>\n</rss>\n"
    )


# ── iCal ─────────────────────────────────────────────────────────────────
def build_ics(v):
    out = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//getlos//Berlin cinema schedule//DE",
        "CALSCALE:GREGORIAN",
        f"X-WR-CALNAME:getlos - {v['name']}",
    ]
    for e in v["events"]:
        dt = event_dt(e)
        uid = f"getlos-{event_key(v, e)}@ravidvr.github.io"
        summary = ics_text(f"{e['title']} ({e.get('lang', '')})".rstrip())
        loc = f"{v['name']}, {v.get('address', '')}".rstrip(", ")
        out += [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
            f"DTSTART;TZID=Europe/Berlin:{dt.strftime('%Y%m%dT%H%M%S')}",
            f"SUMMARY:{summary}",
            f"LOCATION:{ics_text(loc)}",
        ]
        if v.get("website"):
            out.append(f"URL:{v['website']}")
        if e.get("price"):
            out.append(f"DESCRIPTION:{ics_text(e['price'])}")
        out.append("END:VEVENT")
    out.append("END:VCALENDAR")
    return "\r\n".join(out) + "\r\n"


# ── Shared page chrome ───────────────────────────────────────────────────
PAGE_CSS = """
:root{--bg:#f8f9fa;--surface:#fff;--surface2:#e9ecef;--text:#212529;--text-dim:#6c757d;--accent:#e63946;--accent2:#0077b6;--border:#dee2e6;--radius:8px}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.header{background:var(--surface);padding:10px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
.header h1{font-size:20px;font-weight:600}
.header h1 .logo{color:var(--accent)}
.header a{color:var(--accent2);text-decoration:none;font-size:13px}
.header a:hover{text-decoration:underline}
main{max-width:760px;margin:0 auto;padding:24px 16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-bottom:16px}
.card h2{font-size:15px;margin-bottom:12px}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.stat{background:var(--surface2);border-radius:var(--radius);padding:6px 12px;font-size:12px}
.stat b{font-size:14px}
ul{list-style:none}
li{padding:6px 0;border-bottom:1px solid var(--border);font-size:13px}
li:last-child{border-bottom:none}
li a{color:var(--accent2);text-decoration:none}
li a:hover{text-decoration:underline}
.dim{color:var(--text-dim);font-size:12px}
.foot{text-align:center;color:var(--text-dim);font-size:12px;padding:0 16px 32px;line-height:1.7}
.foot a{color:var(--accent2)}
"""


def page(title, body_html):
    return (
        "<!DOCTYPE html>\n<html lang=\"en\"><head>\n"
        "<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
        f"<title>{esc(title)}</title>\n"
        f"<style>{PAGE_CSS}</style>\n"
        "</head><body>\n"
        f"<div class=\"header\"><h1><span class=\"logo\">getlos</span> {esc(title.split(' — ', 1)[-1])}</h1>"
        f"<a href=\"{DASH}\">← Back to the map</a></div>\n"
        f"<main>{body_html}</main>\n"
        f"<div class=\"foot\">Free · no ads · no tracking · data from public sources, updated daily.<br>"
        f"Like getlos? <a href=\"{COFFEE}\">Buy me a coffee</a> ☕</div>\n"
        "</body></html>\n"
    )


# ── iCal index ───────────────────────────────────────────────────────────
def build_ical_index(venues):
    rows = []
    for v in sorted(venues, key=lambda x: x["name"].lower()):
        n = len(v["events"])
        rows.append(
            f"<li><a href=\"{slugify(v['name'])}.ics\">📅 {esc(v['name'])}</a>"
            f" <span class=\"dim\">({n} screenings this week)</span></li>"
        )
    body = (
        "<div class=\"card\"><h2>Add your cinema to your calendar</h2>"
        "<p class=\"dim\">One .ics file per cinema, covering the current 7-day window. "
        "Subscribe to the file or import it — new screenings appear whenever the data refreshes (daily). "
        "iCloud/Google Calendar/Outlook all support importing .ics links.</p></div>"
        f"<div class=\"card\"><ul>{''.join(rows)}</ul></div>"
    )
    return page("getlos — Cinema calendars", body)


# ── Weekly digest ────────────────────────────────────────────────────────
def build_digest(venues):
    events = [e for v in venues for e in v["events"]]
    dates = sorted({e["date"] for e in events})
    today = datetime.now(BERLIN).strftime("%Y-%m-%d")
    langs = {}
    for e in events:
        l = e.get("lang") or "?"
        langs[l] = langs.get(l, 0) + 1
    per_day = {d: sum(1 for e in events if e["date"] == d) for d in dates}
    openair = [v["name"] for v in venues if v.get("outdoor") or "openair" in (v.get("categories") or [])]
    imax = [v["name"] for v in venues if "IMAX" in (v.get("formats") or [])]
    today_ov = sorted(
        [e for v in venues for e in v["events"] if e.get("date") == today and (e.get("lang") or "") in ORIG_LANGS],
        key=lambda e: e.get("time", "99:99"),
    )[:12]

    stats = "".join(
        f"<div class=\"stat\"><b>{n}</b> {esc(lbl)}</div>"
        for n, lbl in (
            (len(venues), "cinemas"),
            (len(events), "screenings"),
            (len(dates), "days covered"),
            (langs.get("DE", 0), "in German"),
            (sum(langs.get(l, 0) for l in ORIG_LANGS), "in OV/OmU/EN"),
        )
    )
    day_rows = "".join(
        f"<li><b>{datetime.strptime(d, '%Y-%m-%d'):%A %d.%m}</b> — {per_day[d]} screenings</li>" for d in dates
    )
    ov_rows = "".join(
        f"<li>{esc(e['title'])} <span class=\"dim\">({e.get('lang')} · {e.get('time', '')})</span></li>"
        for e in today_ov
    )
    extra = ""
    if openair:
        extra += f"<div class=\"card\"><h2>🎑 Open-air venues this week ({len(openair)})</h2><p class=\"dim\">{esc(', '.join(sorted(openair)))}</p></div>"
    if imax:
        extra += f"<div class=\"card\"><h2>🎥 IMAX venues ({len(imax)})</h2><p class=\"dim\">{esc(', '.join(sorted(imax)))}</p></div>"

    body = (
        f"<div class=\"card\"><h2>This week in Berlin cinema · {dates[0]} → {dates[-1]}</h2>"
        f"<div class=\"stats\">{stats}</div>"
        f"<ul>{day_rows}</ul>"
        f"<p class=\"dim\" style=\"margin-top:12px\">Generated {datetime.now(BERLIN):%Y-%m-%d %H:%M} from public data.</p></div>"
        + extra
        + (f"<div class=\"card\"><h2>Today in original version</h2><ul>{ov_rows}</ul>"
           f"<p class=\"dim\" style=\"margin-top:8px\">First {len(today_ov)} of the day — the map has them all.</p></div>"
           if today_ov else "")
    )
    return page("getlos — This week in Berlin cinema", body)


def main():
    venues = berlin_only(merge_venues(load()))
    ical_dir = os.path.join(BASE, "ical")
    os.makedirs(ical_dir, exist_ok=True)
    with open(os.path.join(BASE, "rss.xml"), "w", encoding="utf-8") as f:
        f.write(build_rss(venues))
    for v in venues:
        with open(os.path.join(ical_dir, f"{slugify(v['name'])}.ics"), "w", encoding="utf-8", newline="") as f:
            f.write(build_ics(v))
    # Remove stale .ics files for venues no longer included (e.g. non-Berlin)
    keep = {f"{slugify(v['name'])}.ics" for v in venues}
    for f in os.listdir(ical_dir):
        if f.endswith(".ics") and f not in keep:
            os.remove(os.path.join(ical_dir, f))
    with open(os.path.join(ical_dir, "index.html"), "w", encoding="utf-8") as f:
        f.write(build_ical_index(venues))
    with open(os.path.join(BASE, "digest.html"), "w", encoding="utf-8") as f:
        f.write(build_digest(venues))
    orig = sum(1 for v in venues for e in v["events"] if (e.get("lang") or "") in ORIG_LANGS)
    print(f"feeds: {len(venues)} venues, {orig} OV/OmU/EN items → rss.xml, {len(venues)} .ics files, digest.html")


if __name__ == "__main__":
    main()
