# duo-watch

Watches **Apple Store pickup stock** for the **iPhone Duo 256GB or 512GB** in **Star White** or **Night Sky** (MK1E4LL/A, MK1F4LL/A, MK1G4LL/A, MK1H4LL/A) within **100 miles of 94536**, and alerts your phone when any of them shows up. The alert names the model and opens its buy page.

It checks two sources at the same time:

- **Apple directly:** every 2 minutes it asks Apple's pickup endpoint (the one "Check availability" on the buy page uses). Apple answers with the 12 or so stores nearest the ZIP asked about, so the watcher rotates through 94536 → Vacaville (95688) → 94536 → Salinas (93901), which together cover every store within 100 miles. Your closest 12 stores get checked every 4 minutes and the rest every 8. From 9:50 to 10:30 AM Pacific, when most stock appears, it checks every minute instead, only for the stores within 50 miles (`FAST_WINDOW`, `FAST_MILES`). When Apple's store is down (HTTP 503) it checks every minute, alerts when the store is back, and then checks every minute within 50 miles for an hour, since stock often comes back with the store. If Apple says to slow down, it pauses 30 minutes, then checks a minute less often and skips the fast window.
- **[Duo Stock](https://duo-checker.on-forge.com):** this site checks every US Apple Store every 20 minutes (6:30 AM to 9:30 PM Eastern), which covers the whole 100 miles. The watcher works out when each check will publish and polls every 20 seconds around that time, so it sees new results within seconds.

Duo Stock is currently turned off in the GitHub workflow (`DUO_STOCK: "0"`), so only Apple is checked there; set it back to `"1"` to turn it on.

## Where it runs: GitHub (no computer needed)

The **Watch Duo Stock** workflow (in the Actions tab) runs the watcher around the clock on GitHub's servers. When the phone is in stock within 100 miles it:

- opens a GitHub issue assigned to you, so the **GitHub app** on your phone notifies you, and
- if the repository secret `NTFY_TOPIC` is set (Settings → Secrets and variables → Actions), also sends an urgent ntfy push to that topic, and
- if the secret `BARK_URL` is set to the URL the **Bark** iPhone app shows (`https://api.day.app/<key>`), sends a Bark critical alert, which sounds even when the phone is on silent, and
- if the secrets `GMAIL_USER`, `GMAIL_APP_PASSWORD` (a Gmail app password) and `SMS_TO` (your carrier's email-to-text address, e.g. `5105551234@tmomail.net`) are set, emails a text to your phone.

You get a "Duo watcher needs a look" alert instead if Duo Stock stops answering, if its data is over an hour old between 8 AM and 8 PM Eastern, or if Apple's check fails 6 times in a row.

To check that alerts reach your phone, open Actions → Watch Duo Stock → Run workflow and tick "Send a test alert". To stop it, open the workflow's "..." menu and choose Disable workflow.

## Running it on a Mac instead (optional)

Only useful if Apple starts refusing GitHub's servers. Apple limits how often one internet connection can ask (reportedly about 20 times an hour), and when it refuses, it refuses **every device on that Wi-Fi**, including your phone when you try to buy. If that happens, buy on cellular.

1. Install **Node.js** from <https://nodejs.org>.
2. In **Terminal**, paste this and press Return (use your own ntfy topic):

   ```
   mkdir -p ~/duo-watch && cd ~/duo-watch && curl -fsSL -o watch.js https://raw.githubusercontent.com/ashah1220/duo-watch/claude/iphone-duo-stock-checker-2bjkdu/watch.js && NTFY_TOPIC=your-topic caffeinate -i node watch.js
   ```

- Terminal prints one line per Apple check and per Duo Stock check.
- `caffeinate` keeps the Mac awake while it runs, but closing the lid still sleeps it. Keep it plugged in.
- To stop it, click the Terminal window and press **Ctrl+C**.
- `APPLE_EVERY_MINUTES=4` checks Apple less often; `APPLE=0` turns the Apple check off.
