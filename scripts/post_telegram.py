#!/usr/bin/env python3
"""Post the daily getlos cinema digest to Telegram.

Runs daily at 10:00 via LaunchAgent (~/Library/LaunchAgents/com.getlos.telegram.plist),
after the 09:00 data pipeline has refreshed screenings.json.

Setup (one time):
  1. In Telegram, message @BotFather: /newbot → name "getlos" → copy the token.
  2. Put the token in ~/.getlos_telegram.env:
         TELEGRAM_BOT_TOKEN=123456:ABC...
     (optional: TELEGRAM_CHAT_ID=-100123... if you want a channel/group instead)
  3. Message your bot once ("hi") — the script resolves your chat id from that
     message on the first run and persists it to ~/.getlos_telegram.env.

Behaviour:
  - No token → silent no-op.
  - screenings.json not refreshed today → skips (never posts stale numbers).
  - No chat id yet → tries getUpdates once; if nothing found, skips with a hint.
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
ENV_FILE = os.path.expanduser("~/.getlos_telegram.env")
ORIG_LANGS = ("EN", "OV", "OmU", "OmenglU")
API = "https://api.telegram.org/bot"


def load_env():
    env = dict(os.environ)
    try:
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env.setdefault(k.strip(), v.strip())
    except FileNotFoundError:
        pass
    return env


def save_env_line(key, value):
    try:
        lines = open(ENV_FILE).read().splitlines()
    except FileNotFoundError:
        lines = []
    if not any(l.startswith(key + "=") for l in lines):
        lines.append(f"{key}={value}")
        with open(ENV_FILE, "w") as f:
            f.write("\n".join(lines) + "\n")
        os.chmod(ENV_FILE, 0o600)


def get_updates(token):
    with urllib.request.urlopen(f"{API}{token}/getUpdates", timeout=30) as r:
        return json.loads(r.read())


def resolve_chat_id(token):
    """Find the chat id from the first message sent to the bot."""
    try:
        data = get_updates(token)
    except Exception as e:
        print(f"getUpdates failed: {e}")
        return None
    for upd in data.get("result", []):
        msg = upd.get("message") or upd.get("channel_post")
        chat = (msg or {}).get("chat", {})
        if chat.get("id"):
            return str(chat["id"])
    return None


def send_message(token, chat_id, text):
    payload = urllib.parse.urlencode(
        {"chat_id": chat_id, "text": text, "disable_web_page_preview": "false"}
    ).encode()
    req = urllib.request.Request(
        f"{API}{token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def main():
    env = load_env()
    token = env.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        print("TELEGRAM_BOT_TOKEN not set — skipping")
        return

    sj = os.path.join(BASE, "screenings.json")
    mtime = datetime.fromtimestamp(os.path.getmtime(sj), BERLIN).date()
    today = datetime.now(BERLIN).date()
    if mtime != today:
        print(f"screenings.json not refreshed today (mtime {mtime}) — skipping, never post stale numbers")
        return

    with open(sj, encoding="utf-8") as f:
        venues = berlin_only(json.load(f))

    ov_today = [e for v in venues for e in v["events"]
                if e.get("date") == today.isoformat() and (e.get("lang") or "") in ORIG_LANGS]
    ov_venues = {v["name"] for v in venues
                 if any(e.get("date") == today.isoformat() and (e.get("lang") or "") in ORIG_LANGS
                        for e in v["events"])}
    total = sum(len(v["events"]) for v in venues)

    text = (
        f"🎬 Heute in Berlin: {len(ov_today)} Vorstellungen in OV/OmU/EN in {len(ov_venues)} Kinos.\n"
        f"Alle {total} Spielzeiten dieser Woche auf der Karte — kostenlos, ohne Werbung und Tracking:\n"
        f"https://ravidvr.github.io/getlos/\n"
        f"📅 Kino-Kalender: https://ravidvr.github.io/getlos/ical/\n"
        f"☕ https://paypal.me/RaviDronamraju"
    )

    chat_id = env.get("TELEGRAM_CHAT_ID", "").strip()
    if not chat_id:
        chat_id = resolve_chat_id(token)
        if chat_id:
            save_env_line("TELEGRAM_CHAT_ID", chat_id)
            print(f"Resolved chat id {chat_id} and saved to {ENV_FILE}")
        else:
            print("No chat id found — message the bot once ('hi'), then the next run will resolve it")
            return

    out = send_message(token, chat_id, text)
    print("Posted to Telegram:", out.get("ok"))


if __name__ == "__main__":
    main()
