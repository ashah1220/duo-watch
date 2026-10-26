# duo-watch

A GitHub Actions workflow that checks Apple Store pickup stock for the **iPhone Duo 512GB Star White** (part `MK1G4LL/A`) at stores within **60 miles of 94536** (Fremont, CA). 

When stock shows up, the workflow:
1. Opens a GitHub issue assigned to you, so you get an email or GitHub notification. Close the issue to re-arm the alert.
2. Sends a push notification through [ntfy](https://ntfy.sh), if you've set the optional `NTFY_TOPIC` repo secret. Install the ntfy app, subscribe to a hard-to-guess topic name, and add that name as a secret under **Settings → Secrets and variables → Actions**.

To run a check by hand: **Actions → Check iPhone Duo stock → Run workflow**, or run `python check_stock.py` locally. The `PART`, `ZIP` and `MAX_MILES` environment variables override the defaults.

If Apple rejects the request or changes its response format, the job fails (exit code 2). GitHub then emails you about the failed run, so a broken checker doesn't look like "no stock".

## Status: Apple blocks GitHub's servers

On 2026-10-26, Apple's stock API answered requests from GitHub-hosted runners with HTTP 541, which is a bot block. Because of that, the 10-minute schedule is commented out in `.github/workflows/check-stock.yml`. You can still run the workflow by hand. The checker usually works from a home network, and there are two ways to set that up:

- **Local cron (macOS/Linux):** `*/10 * * * * cd ~/duo-watch && python3 check_stock.py >> stock.log 2>&1`
- **Self-hosted runner:** register your own machine as an Actions runner, change `runs-on: ubuntu-latest` to `runs-on: self-hosted`, and uncomment the `schedule:` block. The issue and ntfy alerts then work as described above.
