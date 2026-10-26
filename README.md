# duo-watch

A free GitHub Actions job that checks **Best Buy** in-store pickup stock for the **iPhone Duo 512GB Star White** (MK1G4LL/A) within **60 miles of 94536**, every 10 minutes. It watches both the AT&T SKU (6525564) and the Verizon SKU (6473200).

Apple's own stock API blocks GitHub's servers (HTTP 541). Best Buy publishes an official free API, so this checker uses that.

## One-time setup (works from a phone)

1. Get a free API key at <https://developer.bestbuy.com> (sign up, confirm your email, and copy the key).
2. On github.com, open this repo → **Settings → Secrets and variables → Actions → New repository secret**. Set the name to `BESTBUY_API_KEY` and the value to your key.
3. Optional, for instant phone alerts: install the **ntfy** app, subscribe to a hard-to-guess topic name, and add that name as a second secret called `NTFY_TOPIC`.

Until the key is set, each run skips quietly.

## Alerts

When stock appears, the job opens a GitHub issue assigned to you, which emails you. Close the issue to re-arm the alert. If you set `NTFY_TOPIC`, you also get a push notification.

To run a check by hand: **Actions → Check iPhone Duo stock → Run workflow**.
