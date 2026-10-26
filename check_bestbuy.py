#!/usr/bin/env python3
"""Check Best Buy in-store pickup stock for iPhone Duo SKUs near a ZIP code.

Uses Best Buy's official Products API (free key from developer.bestbuy.com).
Writes results to $GITHUB_OUTPUT when running in Actions.
Exit codes: 0 = check ran (or no API key configured), 2 = request/parse failure.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# iPhone Duo 512GB Star White (MK1G4LL/A) at Best Buy, one SKU per carrier.
SKUS = {
    "6525564": "AT&T",
    "6473200": "Verizon",
}
ZIP = os.environ.get("ZIP", "94536")
MAX_MILES = float(os.environ.get("MAX_MILES", "60"))
API_KEY = os.environ.get("BESTBUY_API_KEY", "").strip()


def write_output(**kv):
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a") as f:
        for k, v in kv.items():
            f.write(f"{k}<<EOF\n{v}\nEOF\n")


def stores_with_stock(sku):
    url = f"https://api.bestbuy.com/v1/products/{sku}/stores.json?" + urllib.parse.urlencode(
        {"postalCode": ZIP, "apiKey": API_KEY}
    )
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.load(resp).get("stores", [])


def main():
    if not API_KEY:
        print("BESTBUY_API_KEY secret is not set; skipping. See README for setup.")
        write_output(in_stock="false", stores="")
        return 0

    found = []
    try:
        for i, (sku, carrier) in enumerate(SKUS.items()):
            if i:
                time.sleep(1)  # free keys are limited to a few calls per second
            stores = stores_with_stock(sku)
            print(f"SKU {sku} ({carrier}): {len(stores)} store(s) with pickup stock near {ZIP}")
            for s in stores:
                dist = float(s.get("distance") or "inf")
                print(f"  {dist:6.1f} mi  {s.get('name')} ({s.get('city')})")
                if dist <= MAX_MILES:
                    low = " (low stock)" if s.get("lowStock") else ""
                    found.append(
                        f"- **{s.get('name')}**, {s.get('city')} ({dist:.1f} mi): {carrier}{low}"
                        f" - https://www.bestbuy.com/site/{sku}.p?skuId={sku}"
                    )
    except (urllib.error.URLError, ValueError, KeyError) as e:
        print(f"Stock check failed: {e!r}", file=sys.stderr)
        write_output(in_stock="false", stores="")
        return 2

    print(f"\n{len(found)} store/carrier match(es) within {MAX_MILES:g} mi of {ZIP}.")
    write_output(in_stock=str(bool(found)).lower(), stores="\n".join(found))
    return 0


if __name__ == "__main__":
    sys.exit(main())
