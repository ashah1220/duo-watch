#!/usr/bin/env python3
"""Check Apple Store pickup availability for an iPhone part near a ZIP code.

Prints a summary and writes results to $GITHUB_OUTPUT when running in Actions.
Exit codes: 0 = check ran (in stock or not), 2 = request/parse failure.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

PART = os.environ.get("PART", "MK1G4LL/A")  # iPhone Duo 512GB Star White (US)
ZIP = os.environ.get("ZIP", "94536")
MAX_MILES = float(os.environ.get("MAX_MILES", "60"))
PRODUCT_URL = "https://www.apple.com/shop/buy-iphone/iphone-duo/7.6-inch-display-512gb-star-white-unlocked"

URL = "https://www.apple.com/shop/fulfillment-messages?" + urllib.parse.urlencode(
    {"pl": "true", "mts.0": "regular", "parts.0": PART, "searchNearby": "true", "location": ZIP}
)


def fetch():
    req = urllib.request.Request(
        URL,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.0 Safari/605.1.15",
            "Accept": "application/json",
            "Referer": PRODUCT_URL,
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def miles(store):
    for key in ("storedistance", "storeDistanceVoText"):
        try:
            return float(str(store.get(key, "")).split()[0].replace(",", ""))
        except (ValueError, IndexError):
            continue
    return float("inf")


def write_output(**kv):
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a") as f:
        for k, v in kv.items():
            f.write(f"{k}<<EOF\n{v}\nEOF\n")


def main():
    try:
        stores = fetch()["body"]["content"]["pickupMessage"]["stores"]
    except Exception as e:  # HTTP errors, Apple bot blocking, schema changes
        print(f"Stock check failed: {e!r}", file=sys.stderr)
        write_output(in_stock="false", error=repr(e))
        return 2

    found = []
    for s in stores:
        dist = miles(s)
        avail = s.get("partsAvailability", {}).get(PART, {})
        status = avail.get("pickupDisplay", "unknown")
        quote = avail.get("pickupSearchQuote", "")
        print(f"{dist:6.1f} mi  {s.get('storeName')} ({s.get('city')}): {status} - {quote}")
        if dist <= MAX_MILES and status == "available":
            found.append(f"- **{s.get('storeName')}** ({s.get('city')}, {dist:.1f} mi): {quote}")

    summary = "\n".join(found)
    print(f"\n{len(found)} store(s) within {MAX_MILES:g} mi of {ZIP} have {PART} available.")
    write_output(in_stock=str(bool(found)).lower(), stores=summary, error="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
